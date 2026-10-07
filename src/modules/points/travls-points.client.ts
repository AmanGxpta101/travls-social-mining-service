import { createHmac } from "node:crypto";
import { Logger } from "@nestjs/common";
import { env } from "../../env";

export interface PointsWrite {
  /** Signed: positive adds, negative removes. */
  amount: number;
  reason: string;
  /** Stable per change; sent as Travls' `uniqueId`. Our sync retries with the same one. */
  idempotencyKey: string;
}

/** Who a Travls access token belongs to, and their points at that moment. */
export interface TravlsSession {
  userId: string;
  balance: number;
}

/**
 * Travls' own points balance (profile-service), which social mining adds to
 * and removes from (scenario 1). Their contract:
 *
 *   GET  {TRAVLS_API_URL}/v1/travls-point              x-access-token: <user's Travls JWT>
 *        -> data.user._id, data.breakdown.travlsPoint
 *   POST {TRAVLS_API_URL}/v1/travls-point/transaction  x-signature: hex HMAC-SHA256 of the body
 *        { userId, uniqueId, amount, reason, rewardType: "social-mining", type: "credit" | "debit" }
 *        -> data.balance.travlsPoint   (balance after the write)
 *
 * There is no server-side balance read: the GET only answers for the user
 * holding the token, so balances are read when a Travls token is checked
 * (linking) and otherwise taken from each write's response.
 *
 * `travlsPoint` is the balance a transaction moves; `total_travls_point` also
 * counts airdrop points, which we never touch, so before/after use the former.
 */
export interface TravlsPointsClient {
  /** Returns Travls' balance after the write. */
  applyChange(userId: string, change: PointsWrite): Promise<number>;
  /** Resolves a Travls access token, or throws if Travls rejects it. */
  verifySession(accessToken: string): Promise<TravlsSession>;
}

const TIMEOUT_MS = 10_000;

/** Travls answered with an error status (as opposed to not answering at all). */
export class TravlsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  success?: boolean;
  message?: string;
  errors?: unknown;
  data?: T;
}

/** One call to Travls as it went over the wire, for the API log (TravlsApiCall). */
export interface TravlsCallRecord {
  method: string;
  path: string;
  userId: string | null;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
}

export type TravlsCallRecorder = (call: TravlsCallRecord) => void;

/** Enough of a token to tell two apart in the log, not enough to use. */
function maskToken(token: string) {
  return token.length > 24 ? `${token.slice(0, 12)}…${token.slice(-6)} (${token.length} chars)` : "…";
}

/** Hex HMAC-SHA256 over the exact body string sent — Travls recomputes it from the parsed body. */
export function signTravlsPointPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

class HttpTravlsPointsClient implements TravlsPointsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly signatureSecret: string,
    private readonly record: TravlsCallRecorder,
  ) {}

  /** `userId` is who the call is about, if known before the answer; `userIdFrom` reads it from the answer. */
  private async call<T>(
    path: string,
    init: { method?: string; headers: Record<string, string>; body?: string },
    who: { userId?: string; userIdFrom?: (data: T) => unknown },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", ...init.headers };
    const started = Date.now();
    const entry: TravlsCallRecord = {
      method: init.method ?? "GET",
      path,
      userId: who.userId ?? null,
      requestHeaders: {
        ...headers,
        ...(headers["x-access-token"] && { "x-access-token": maskToken(headers["x-access-token"]) }),
      },
      requestBody: init.body ?? null,
      status: null,
      responseBody: null,
      error: null,
      durationMs: 0,
    };
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (err) {
      this.record({ ...entry, error: (err as Error).message, durationMs: Date.now() - started });
      throw err;
    }
    let parsed: Envelope<T> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Envelope<T>) : {};
    } catch {
      // Not JSON — recorded raw below, and treated as a failure.
    }
    // Travls sends `data: null` on errors.
    const answeredFor = parsed?.data != null ? who.userIdFrom?.(parsed.data) : undefined;
    this.record({
      ...entry,
      userId: typeof answeredFor === "string" ? answeredFor : entry.userId,
      status: res.status,
      responseBody: text,
      durationMs: Date.now() - started,
    });

    if (!res.ok) throw new TravlsApiError(res.status, `Travls points API ${res.status}: ${text.slice(0, 200)}`);
    if (!parsed) throw new Error(`Travls points API returned non-JSON: ${text.slice(0, 200)}`);
    const body = parsed;
    if (body.success === false || body.data == null) {
      throw new Error(`Travls points API: ${body.message ?? "no data"} ${JSON.stringify(body.errors ?? "")}`.trim());
    }
    return body.data;
  }

  async applyChange(userId: string, change: PointsWrite) {
    if (!change.amount) throw new Error("Travls points API: refusing a zero-point transaction");
    // Built once and sent as-is, so the signed bytes are the bytes they parse.
    const body = JSON.stringify({
      userId,
      uniqueId: change.idempotencyKey,
      amount: Math.abs(change.amount),
      reason: change.reason,
      rewardType: "social-mining",
      type: change.amount > 0 ? "credit" : "debit",
    });
    const data = await this.call<{ balance?: { travlsPoint?: unknown } }>("/v1/travls-point/transaction", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "x-signature": signTravlsPointPayload(body, this.signatureSecret) },
    }, { userId });
    const after = data.balance?.travlsPoint;
    if (typeof after !== "number") throw new Error("Travls points API returned no balance");
    return after;
  }

  async verifySession(accessToken: string) {
    const data = await this.call<{ user?: { _id?: unknown }; breakdown?: { travlsPoint?: unknown } }>(
      "/v1/travls-point",
      { method: "GET", headers: { "x-access-token": accessToken } },
      { userIdFrom: (d) => d.user?._id },
    );
    const userId = data.user?._id;
    const balance = data.breakdown?.travlsPoint;
    if (typeof userId !== "string" || typeof balance !== "number") {
      throw new Error("Travls points API returned no user or balance");
    }
    return { userId, balance };
  }
}

/** Null when TRAVLS_API_URL is unset: social mining then runs standalone only (Travls sync can't be turned on). */
export function createTravlsPointsClient(record: TravlsCallRecorder): TravlsPointsClient | null {
  const { apiUrl, signatureSecret } = env.travls;
  if (apiUrl) {
    if (!signatureSecret) throw new Error("TRAVLS_API_URL is set but TRAVLS_POINT_SIGNATURE_SECRET is not");
    return new HttpTravlsPointsClient(apiUrl.replace(/\/$/, ""), signatureSecret, record);
  }
  new Logger("TravlsPoints").warn("TRAVLS_API_URL is not set — standalone only, Travls sync can't be turned on");
  return null;
}

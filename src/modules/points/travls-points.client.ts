import { Logger } from "@nestjs/common";
import { env } from "../../env";

export interface PointsWrite {
  /** Signed: positive adds, negative removes. */
  amount: number;
  reason: string;
  /** Stable per change. Travls must treat a repeat as a no-op — our sync retries. */
  idempotencyKey: string;
}

/**
 * Travls' own points balance, which social mining adds to and removes from
 * (scenario 1). Travls has no API spec yet, so the live client targets an
 * assumed contract — change it here once theirs exists:
 *
 *   GET  {LEDGER_API_URL}/users/{userId}/points  -> { balance: number }
 *   POST {LEDGER_API_URL}/users/{userId}/points  { amount, reason, idempotencyKey, source: "social_mining" }
 *                                                -> { balance: number }   (balance after the write)
 *
 * Authorization: Bearer {LEDGER_API_KEY}. A delta, not "set balance to X", so
 * points Travls awards for other things (registration, spend) can't be
 * overwritten by a stale read on our side.
 */
export interface TravlsPointsClient {
  readonly mode: "live" | "simulated";
  getBalance(userId: string): Promise<number>;
  /** Returns Travls' balance after the write, or null if they didn't say. */
  applyChange(userId: string, change: PointsWrite): Promise<number | null>;
}

const TIMEOUT_MS = 10_000;

class HttpTravlsPointsClient implements TravlsPointsClient {
  readonly mode = "live" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async call(path: string, init?: RequestInit): Promise<{ balance?: unknown }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}`, ...init?.headers },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Travls points API ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  async getBalance(userId: string) {
    const body = await this.call(`/users/${encodeURIComponent(userId)}/points`);
    if (typeof body.balance !== "number") throw new Error("Travls points API returned no balance");
    return body.balance;
  }

  async applyChange(userId: string, change: PointsWrite) {
    const body = await this.call(`/users/${encodeURIComponent(userId)}/points`, {
      method: "POST",
      body: JSON.stringify({ ...change, source: "social_mining" }),
    });
    return typeof body.balance === "number" ? body.balance : null;
  }
}

/**
 * Stands in for Travls while LEDGER_API_URL is unset, so the flow works end to
 * end locally. In memory: a restart resets it, and it starts each user from
 * the balance we last copied (see PointsService) so our copy doesn't
 * immediately look wrong.
 */
export class SimulatedTravlsPointsClient implements TravlsPointsClient {
  readonly mode = "simulated" as const;
  private readonly balances = new Map<string, number>();
  private readonly applied = new Set<string>();

  seed(userId: string, balance: number) {
    if (!this.balances.has(userId)) this.balances.set(userId, balance);
  }

  async getBalance(userId: string) {
    return this.balances.get(userId) ?? 0;
  }

  async applyChange(userId: string, change: PointsWrite) {
    const balance = await this.getBalance(userId);
    if (this.applied.has(change.idempotencyKey)) return balance;
    this.applied.add(change.idempotencyKey);
    this.balances.set(userId, balance + change.amount);
    return balance + change.amount;
  }
}

export function createTravlsPointsClient(): TravlsPointsClient {
  if (env.ledger.apiUrl) return new HttpTravlsPointsClient(env.ledger.apiUrl.replace(/\/$/, ""), env.ledger.apiKey);
  new Logger("TravlsPoints").warn("LEDGER_API_URL is not set — Travls points are SIMULATED in memory");
  return new SimulatedTravlsPointsClient();
}

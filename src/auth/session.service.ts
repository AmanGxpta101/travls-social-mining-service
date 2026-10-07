import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../env";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PREFIX = "sm1";

/**
 * Our own session: signing in with X proves who the user is, and the
 * callback hands back a token naming their userId, signed with
 * SESSION_SECRET and good for 30 days. Travls tokens are never sessions here —
 * they're only presented to link a user (see ConnectService.linkTravls).
 *
 * Format: `sm1.<base64url userId>.<expiry ms>.<hex HMAC of the part before it>`.
 */
@Injectable()
export class SessionService {
  issue(userId: string): string {
    const body = `${PREFIX}.${Buffer.from(userId).toString("base64url")}.${Date.now() + TTL_MS}`;
    return `${body}.${sign(body)}`;
  }

  /** The userId a session token names; throws Unauthorized if it's forged, malformed or expired. */
  resolve(token: string): string {
    const [prefix, user, exp, sig, ...rest] = token.split(".");
    if (prefix !== PREFIX || !user || !exp || !sig || rest.length) throw invalid();
    const expected = Buffer.from(sign(`${prefix}.${user}.${exp}`));
    const provided = Buffer.from(sig);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw invalid();
    if (!(Number(exp) > Date.now())) throw new UnauthorizedException("session expired, sign in with X again");
    return Buffer.from(user, "base64url").toString();
  }
}

function sign(body: string) {
  return createHmac("sha256", env.sessionSecret).update(body).digest("hex");
}

function invalid() {
  return new UnauthorizedException("invalid session, sign in with X again");
}

export function bearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
}

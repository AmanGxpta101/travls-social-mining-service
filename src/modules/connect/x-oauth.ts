import { createHash, randomBytes } from "node:crypto";
import { env } from "../../env";
import { recordXApiCall } from "../cost-meter/service";
import { throwOnXApiError } from "../../x-api-error";

// Decision on record: direct API posting, so `tweet.write` is required —
// the Share module posts on the user's behalf rather than relying on the OS
// share sheet + a pasted link back.
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

// Per docs.x.com (fetched 2026-09-23): x.com for the authorize redirect,
// api.x.com for everything else. twitter.com/api.twitter.com are the old domains.
const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";

export function generatePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(params: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.x.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${env.x.clientId}:${env.x.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.verifier,
    }),
  });
  if (!res.ok) {
    await throwOnXApiError(res, "connect_token_exchange");
  }
  return res.json() as Promise<TokenResponse>;
}

/**
 * `offline.access` was requested specifically so we'd get a refresh_token —
 * use it. Per docs.x.com's refresh example, client_id goes in the body even
 * though we're a confidential client authenticating via the Basic header.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${env.x.clientId}:${env.x.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.x.clientId,
    }),
  });
  if (!res.ok) {
    await throwOnXApiError(res, "connect_token_refresh");
  }
  return res.json() as Promise<TokenResponse>;
}

export async function fetchXUser(accessToken: string): Promise<{ id: string; username: string }> {
  recordXApiCall("user_lookup");
  const res = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    await throwOnXApiError(res, "user_lookup");
  }
  const body = (await res.json()) as { data: { id: string; username: string } };
  return body.data;
}

/**
 * Posts on the user's behalf. Requires `tweet.write` — see decision on record.
 * Cost note (docs.x.com pricing, fetched 2026-09-23): $0.015/post normally,
 * but $0.20/post if the text contains a URL — our static copy does, so budget
 * for the $0.20 rate, not $0.015 (see plan §7.5 Cost Meter).
 */
export async function postTweet(accessToken: string, text: string): Promise<{ id: string }> {
  recordXApiCall("share_post");
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    await throwOnXApiError(res, "share_post");
  }
  const body = (await res.json()) as { data: { id: string } };
  return body.data;
}

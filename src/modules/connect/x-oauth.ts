import { createHash, randomBytes } from "node:crypto";
import { env } from "../../env";
import { recordXApiCall } from "../cost-meter/service";
import { throwOnXApiError } from "../../x-api-error";

// Decision on record: direct API posting, so `tweet.write` is required —
// the Share module posts on the user's behalf rather than relying on the OS
// share sheet + a pasted link back. `media.write` added so the share post can
// carry the promo image, not just text (docs.x.com scopes list, fetched
// 2026-09-23). Note: anyone who connected before this change authorized under
// the old scope set — their stored token won't have media.write until they
// disconnect and reconnect.
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];

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
 * for the $0.20 rate, not $0.015 (see plan §7.5 Cost Meter). Attaching media
 * doesn't change this rate per docs.x.com — only a URL in the text does.
 */
export async function postTweet(
  accessToken: string,
  text: string,
  mediaIds?: string[],
): Promise<{ id: string }> {
  recordXApiCall("share_post");
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      ...(mediaIds?.length ? { media: { media_ids: mediaIds } } : {}),
    }),
  });
  if (!res.ok) {
    await throwOnXApiError(res, "share_post");
  }
  const body = (await res.json()) as { data: { id: string } };
  return body.data;
}

const MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload";
// Docs.x.com caps a segment at 5MB; stay comfortably under that.
const APPEND_CHUNK_BYTES = 4 * 1024 * 1024;

async function initializeMediaUpload(params: {
  accessToken: string;
  mediaType: string;
  totalBytes: number;
  mediaCategory: string;
}): Promise<string> {
  const res = await fetch(`${MEDIA_UPLOAD_URL}/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media_type: params.mediaType,
      total_bytes: params.totalBytes,
      media_category: params.mediaCategory,
    }),
  });
  if (!res.ok) {
    await throwOnXApiError(res, "media_upload_initialize");
  }
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

async function appendMediaChunk(params: {
  accessToken: string;
  mediaId: string;
  segmentIndex: number;
  chunk: Buffer;
}): Promise<void> {
  const form = new FormData();
  form.set("segment_index", String(params.segmentIndex));
  form.set("media", new Blob([new Uint8Array(params.chunk)]));

  const res = await fetch(`${MEDIA_UPLOAD_URL}/${params.mediaId}/append`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}` },
    body: form,
  });
  if (!res.ok) {
    await throwOnXApiError(res, "media_upload_append");
  }
}

async function finalizeMediaUpload(params: { accessToken: string; mediaId: string }): Promise<void> {
  const res = await fetch(`${MEDIA_UPLOAD_URL}/${params.mediaId}/finalize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) {
    await throwOnXApiError(res, "media_upload_finalize");
  }
}

/**
 * Chunked upload per docs.x.com (fetched 2026-09-23): INIT -> APPEND -> FINALIZE.
 * Static images finalize synchronously (no processing_info state to wait on),
 * so this doesn't implement the STATUS-polling step the docs describe for
 * video/GIF — add that if this ever needs to carry more than a still image.
 */
export async function uploadMedia(params: {
  accessToken: string;
  buffer: Buffer;
  mimeType: string;
  category: "tweet_image" | "tweet_gif" | "tweet_video";
}): Promise<string> {
  recordXApiCall("media_upload");
  const mediaId = await initializeMediaUpload({
    accessToken: params.accessToken,
    mediaType: params.mimeType,
    totalBytes: params.buffer.length,
    mediaCategory: params.category,
  });

  let segmentIndex = 0;
  for (let offset = 0; offset < params.buffer.length; offset += APPEND_CHUNK_BYTES) {
    await appendMediaChunk({
      accessToken: params.accessToken,
      mediaId,
      segmentIndex,
      chunk: params.buffer.subarray(offset, offset + APPEND_CHUNK_BYTES),
    });
    segmentIndex++;
  }

  await finalizeMediaUpload({ accessToken: params.accessToken, mediaId });
  return mediaId;
}

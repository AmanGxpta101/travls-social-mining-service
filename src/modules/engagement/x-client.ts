import { HttpException, HttpStatus } from "@nestjs/common";
import { env } from "../../env";
import { recordXApiCall } from "../cost-meter/service";
import { throwOnXApiError } from "../../x-api-error";

export interface PublicMetrics {
  like_count: number;
  retweet_count: number;
  quote_count: number;
  reply_count: number;
  bookmark_count: number;
  impression_count: number;
}

export type TweetLookupResult =
  | { status: "ok"; metrics: PublicMetrics }
  | { status: "deleted" };

export interface TweetForVerification {
  authorId: string;
  text: string;
  /** Expanded (pre-t.co) URLs — `text` only carries the t.co short links. */
  expandedUrls: string[];
  metrics: PublicMetrics;
}

interface TweetLookupBody {
  data?: {
    author_id: string;
    text: string;
    public_metrics: PublicMetrics;
    entities?: { urls?: { expanded_url?: string }[] };
  };
  errors?: unknown[];
}

/**
 * Per docs.x.com (fetched 2026-09-23): tweet lookup only requires an app-only
 * Bearer Token, not user context — so this never depends on any individual
 * user's OAuth connection staying alive. Cost note: these are third-party
 * reads ($0.005/resource), not the cheaper "Owned Read" rate, since the posts
 * belong to connected users, not the app's own account.
 */
async function lookupTweet(
  tweetId: string,
  purpose: "engagement_fetch" | "share_verify",
): Promise<TweetLookupBody["data"] | null> {
  if (!env.x.bearerToken) {
    throw new HttpException("X_BEARER_TOKEN is not configured", HttpStatus.INTERNAL_SERVER_ERROR);
  }
  recordXApiCall(purpose);
  const url = new URL(`https://api.x.com/2/tweets/${tweetId}`);
  url.searchParams.set("tweet.fields", "public_metrics,author_id,entities");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.x.bearerToken}` } });

  if (res.status === 404) return null;
  if (!res.ok) {
    await throwOnXApiError(res, purpose);
  }

  const body = (await res.json()) as TweetLookupBody;

  // Confirmed live 2026-09-23: X returns HTTP 200 with an `errors` array and
  // no `data` for a deleted/inaccessible post — not a 404 status, despite the
  // error's own `title` being "Not Found Error". The status check above
  // doesn't catch this shape, so detect it here instead of crashing on
  // `body.data.public_metrics`.
  return body.data ?? null;
}

export async function fetchTweetMetrics(tweetId: string): Promise<TweetLookupResult> {
  const data = await lookupTweet(tweetId, "engagement_fetch");
  // Per plan §7.3: deleted post -> freeze last-known metrics, never drop the row.
  if (!data) return { status: "deleted" };
  return { status: "ok", metrics: data.public_metrics };
}

/** Community-tier paste-back verification; returns null if the post doesn't exist or isn't visible. */
export async function fetchTweetForVerification(tweetId: string): Promise<TweetForVerification | null> {
  const data = await lookupTweet(tweetId, "share_verify");
  if (!data) return null;
  return {
    authorId: data.author_id,
    text: data.text,
    expandedUrls: (data.entities?.urls ?? []).flatMap((u) => (u.expanded_url ? [u.expanded_url] : [])),
    metrics: data.public_metrics,
  };
}

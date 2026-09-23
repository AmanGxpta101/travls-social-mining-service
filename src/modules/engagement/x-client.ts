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

/**
 * Per docs.x.com (fetched 2026-09-23): public_metrics only requires an
 * app-only Bearer Token, not user context — so this never depends on any
 * individual user's OAuth connection staying alive. Cost note: these are
 * third-party reads ($0.005/resource), not the cheaper "Owned Read" rate,
 * since the posts belong to connected users, not the app's own account.
 */
export async function fetchTweetMetrics(tweetId: string): Promise<TweetLookupResult> {
  if (!env.x.bearerToken) {
    throw new HttpException("X_BEARER_TOKEN is not configured", HttpStatus.INTERNAL_SERVER_ERROR);
  }
  recordXApiCall("engagement_fetch");
  const url = new URL(`https://api.x.com/2/tweets/${tweetId}`);
  url.searchParams.set("tweet.fields", "public_metrics");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.x.bearerToken}` } });

  if (res.status === 404) {
    // Per plan §7.3: deleted post -> freeze last-known metrics, never drop the row.
    return { status: "deleted" };
  }
  if (!res.ok) {
    await throwOnXApiError(res, "engagement_fetch");
  }

  const body = (await res.json()) as { data?: { public_metrics: PublicMetrics }; errors?: unknown[] };

  // Confirmed live 2026-09-23: X returns HTTP 200 with an `errors` array and
  // no `data` for a deleted/inaccessible post — not a 404 status, despite the
  // error's own `title` being "Not Found Error". The status check above
  // doesn't catch this shape, so detect it here instead of crashing on
  // `body.data.public_metrics`.
  if (!body.data) {
    return { status: "deleted" };
  }

  return { status: "ok", metrics: body.data.public_metrics };
}

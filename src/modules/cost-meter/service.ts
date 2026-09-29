// Per plan §6/§7.5: wire into whatever observability the org already has
// (Sentry/Datadog) rather than building a bespoke dashboard. This just emits a
// structured log line per X API call; point a log-based metric/alert at
// `event: "x_api_call"` and alert on rate/cost vs. the growth-team's budget.
//
// Cost estimates per docs.x.com pricing (fetched 2026-09-23, pay-per-usage,
// no named tiers): posting with a URL is $0.20/post (our static copy has a
// URL — NOT the $0.015 base rate), engagement reads are $0.005/resource
// (third-party rate, since these are connected users' posts, not the app's
// own — doesn't qualify for the cheaper $0.001 "Owned Read" rate). User
// lookup and media upload costs weren't confirmed in the docs fetched
// (2026-09-23 pricing page lists no media upload rate), left unpriced below.
const APPROX_USD_COST: Record<string, number | undefined> = {
  share_post: 0.2,
  engagement_fetch: 0.005,
  // Community-tier paste-back verification: same tweet lookup, same rate.
  share_verify: 0.005,
  user_lookup: undefined,
  media_upload: undefined,
};

let callsThisProcess = 0;

export function recordXApiCall(
  purpose: "user_lookup" | "engagement_fetch" | "share_verify" | "share_post" | "media_upload",
) {
  callsThisProcess += 1;
  console.log(
    JSON.stringify({
      event: "x_api_call",
      purpose,
      approxUsd: APPROX_USD_COST[purpose] ?? null,
      processTotal: callsThisProcess,
      at: new Date().toISOString(),
    }),
  );
}

/**
 * The one rule for "does this submission count": it has a post, and ops
 * hasn't invalidated it. "deleted" still counts — earned before the post went
 * away (plan §7.3). Used by the user-facing challenge list and the ops user
 * profiles, so both always agree on a user's points.
 */
export const COUNTS_AS_DONE = ["confirmed", "deleted"] as const;

interface ShareLike {
  copyVariant: string;
  externalPostId: string | null;
  postStatus: string;
  sharedAt: Date;
}

export function countsAsDone(share: ShareLike): boolean {
  return Boolean(share.externalPostId) && (COUNTS_AS_DONE as readonly string[]).includes(share.postStatus);
}

/**
 * challengeId -> the submission that completed it. One completion per
 * challenge per user; if several somehow count, the earliest wins. Shares
 * whose copyVariant isn't a challenge (pre-challenge "v1_static" posts) are
 * ignored.
 */
export function completedChallenges<S extends ShareLike>(shares: S[], challengeIds: Set<string>): Map<string, S> {
  const byTask = new Map<string, S>();
  for (const share of [...shares].sort((a, b) => a.sharedAt.getTime() - b.sharedAt.getTime())) {
    if (!challengeIds.has(share.copyVariant)) continue;
    if (countsAsDone(share) && !byTask.has(share.copyVariant)) byTask.set(share.copyVariant, share);
  }
  return byTask;
}

/** Earned points for completed challenges plus ops adjustments (stored negative). */
export function pointsFor(
  completed: Map<string, unknown>,
  taskPoints: Map<string, number>,
  adjustments: { amount: number }[],
) {
  let earned = 0;
  for (const taskId of completed.keys()) earned += taskPoints.get(taskId) ?? 0;
  const adjusted = adjustments.reduce((sum, a) => sum + a.amount, 0);
  return { earned, deducted: -adjusted, total: earned + adjusted };
}

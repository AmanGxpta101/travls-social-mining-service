/**
 * Challenges live in the share_task table; ops create, archive and schedule
 * them from the dashboard. Nothing is seeded — a fresh database has none.
 *
 * `{link}` (optional) is replaced with the user's per-share ref link, for KOL
 * direct posts and community paste-back posts alike: community verification
 * looks for its code, and for everyone it attributes sign-ups. A challenge's
 * id is stored on the share as its `copyVariant`.
 *
 * `points` is what the challenge is advertised as earning. Ops can take points
 * back (points_adjustment); paying out is still manual (plan §7.4, §8.6).
 */
export function renderTaskCopy(task: { template: string }, link: string): string {
  return task.template.replace("{link}", link);
}

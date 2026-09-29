/**
 * Challenges now live in the share_task table so ops can add and retire them
 * from the dashboard. These four are the originals, seeded on startup if
 * missing (never overwritten, so ops edits stick).
 *
 * `{link}` is replaced per flow: the plain landing URL for KOL direct posts,
 * and the user's per-share ref link for community paste-back posts (which
 * verification requires to be present). A challenge's id is stored on the
 * share as its `copyVariant`.
 *
 * `points` is what the challenge is advertised as earning. Ops can take points
 * back (points_adjustment); paying out is still manual (plan §7.4, §8.6).
 */
export interface ShareTaskSeed {
  id: string;
  title: string;
  description: string;
  template: string;
  points: number;
}

export const DEFAULT_TASKS: ShareTaskSeed[] = [
  {
    id: "announce_join",
    title: "Announce you joined Travls",
    description: "Let your followers know you're on Travls.",
    template:
      "I just downloaded Travls — the fastest way to fund, spend, and track your travel money. Get yours: {link}",
    points: 100,
  },
  {
    id: "dream_trip",
    title: "Share your dream trip",
    description: "Tell people where you're headed next — and how you'll pay for it.",
    template:
      "Next stop on my list: somewhere new. Planning it all with Travls so my travel money is sorted before I land ✈️ {link}",
    points: 150,
  },
  {
    id: "card_flex",
    title: "Show off your Travls card",
    description: "Talk up the card you'll be spending abroad with.",
    template:
      "Got my Travls card — one card for spending anywhere I travel, no FX headaches. Get yours: {link}",
    points: 200,
  },
  {
    id: "tag_travel_buddies",
    title: "Tag your travel crew",
    description: "Bring the friends you travel with — add their handles when you post.",
    template: "Who's coming on the next trip? Sorting our travel money with Travls this time 👇 {link}",
    points: 250,
  },
];

export function renderTaskCopy(task: { template: string }, link: string): string {
  return task.template.replace("{link}", link);
}

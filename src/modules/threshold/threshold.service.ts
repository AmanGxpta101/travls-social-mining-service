import { Injectable, OnModuleInit } from "@nestjs/common";
import type { ShareTier } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

interface MetricSnapshot {
  likes: number;
  retweets: number;
  quoteCount: number;
  replies: number;
  bookmarkCount: number;
  impressionCount: number;
}

const METRIC_FIELD: Record<string, keyof MetricSnapshot> = {
  likes: "likes",
  retweets: "retweets",
  quote_count: "quoteCount",
  replies: "replies",
  bookmark_count: "bookmarkCount",
  impression_count: "impressionCount",
};

/**
 * Only retweets and likes are confirmed from the source recording — the third
 * metric was inaudible (open question #2 in the plan, needs Ankit/Zeeshan).
 * Worth floating `impression_count` (views) as a candidate when you ask them —
 * it's a natural third growth metric and X's API now exposes it for free
 * alongside the other public_metrics fields.
 * Seeded here so Phase 0 has something to run against; add the third metric
 * as another active row once confirmed, no code change needed.
 *
 * Thresholds are per tier (kol = direct-post, community = paste-back) so ops
 * can hold community shares to a different bar. Both start at the same values;
 * tune the community rows in the DB once there's real data.
 */
const DEFAULT_THRESHOLDS: { metric: string; tier: ShareTier; minValue: number }[] = [
  { metric: "retweets", tier: "kol", minValue: 5 },
  { metric: "likes", tier: "kol", minValue: 25 },
  { metric: "retweets", tier: "community", minValue: 5 },
  { metric: "likes", tier: "community", minValue: 25 },
];

@Injectable()
export class ThresholdService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    for (const t of DEFAULT_THRESHOLDS) {
      await this.prisma.rewardThreshold.upsert({
        where: { metric_tier: { metric: t.metric, tier: t.tier } },
        create: { metric: t.metric, tier: t.tier, minValue: t.minValue, active: true },
        update: {},
      });
    }
  }

  async evaluate(snapshot: MetricSnapshot, tier: ShareTier) {
    const thresholds = await this.prisma.rewardThreshold.findMany({ where: { active: true, tier } });
    const thresholdsMet: string[] = [];
    let allMet = thresholds.length > 0;

    for (const t of thresholds) {
      const field = METRIC_FIELD[t.metric];
      const value = field ? snapshot[field] : undefined;
      const met = value !== undefined && value >= t.minValue;
      if (met) thresholdsMet.push(t.metric);
      else allMet = false;
    }

    return { eligible: allMet, thresholdsMet };
  }
}

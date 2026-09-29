import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ThresholdService } from "../threshold/threshold.service";

@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly thresholdService: ThresholdService,
  ) {}

  /**
   * Open question (plan §8.5): track latest share, best share, or all? Not
   * answered yet, so Phase 0 defaults to "eligible if any confirmed share meets
   * the thresholds" — the least surprising behavior until anti-farming policy
   * is decided in Phase 1.
   */
  async getRewardStatus(userId: string) {
    const shares = await this.prisma.socialShare.findMany({
      where: { userId, postStatus: { in: ["confirmed", "deleted"] } },
      include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } },
    });

    const metThresholds = new Set<string>();
    let eligible = false;

    for (const share of shares) {
      const snapshot = share.snapshots[0];
      if (!snapshot) continue;
      const result = await this.thresholdService.evaluate(snapshot, share.tier);
      if (result.eligible) eligible = true;
      for (const m of result.thresholdsMet) metThresholds.add(m);
    }

    return { eligible, thresholdsMet: [...metThresholds] };
  }
}

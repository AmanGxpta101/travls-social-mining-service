import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ThresholdService } from "../threshold/threshold.service";
import { EngagementService } from "../engagement/engagement.service";

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly thresholdService: ThresholdService,
    private readonly engagementService: EngagementService,
  ) {}

  /**
   * Ops-triggered fetch (plan §7.3) — the piece the dashboard was missing.
   * Engagement is on-demand only, and the only other trigger is a user
   * revisiting the SDK-integrated app within its own 5-day cache window
   * (getEngagement), which won't refresh anything for shares nobody's
   * looking at. This bypasses that cache entirely so ops can force a live
   * check before crediting.
   */
  refreshShareEngagement(shareId: string) {
    return this.engagementService.refreshEngagementForShare(shareId);
  }

  /**
   * Full activity feed for ops monitoring (every share, not just payout-ready
   * ones) — distinct from listEligibleUsers(), which is filtered to the
   * "who do I pay" queue. This is "what's everyone sharing, how's it doing."
   */
  async listAllShares() {
    const shares = await this.prisma.socialShare.findMany({
      orderBy: { sharedAt: "desc" },
      include: {
        snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
        manualCredits: true,
      },
    });

    const rows = [];
    for (const share of shares) {
      const snapshot = share.snapshots[0];
      const evaluation = snapshot ? await this.thresholdService.evaluate(snapshot) : null;
      const credit = share.manualCredits[0];

      const account = await this.prisma.userSocialAccount.findUnique({
        where: { userId_platform: { userId: share.userId, platform: "x" } },
      });

      rows.push({
        shareId: share.id,
        userId: share.userId,
        handle: account?.handle ?? null,
        postUrl: share.externalPostId ? `https://x.com/i/status/${share.externalPostId}` : null,
        postStatus: share.postStatus,
        copyVariant: share.copyVariant,
        sharedAt: share.sharedAt.toISOString(),
        metrics: snapshot
          ? {
              likes: snapshot.likes,
              retweets: snapshot.retweets,
              quoteCount: snapshot.quoteCount,
              replies: snapshot.replies,
              bookmarkCount: snapshot.bookmarkCount,
              impressionCount: snapshot.impressionCount,
            }
          : null,
        fetchedAt: snapshot?.fetchedAt.toISOString() ?? null,
        eligible: evaluation?.eligible ?? false,
        thresholdsMet: evaluation?.thresholdsMet ?? [],
        credited: Boolean(credit),
        creditAmount: credit?.amount.toString() ?? null,
        issuedBy: credit?.issuedBy ?? null,
        issuedAt: credit?.issuedAt.toISOString() ?? null,
      });
    }
    return rows;
  }

  async listEligibleUsers() {
    const shares = await this.prisma.socialShare.findMany({
      where: { postStatus: { in: ["confirmed", "deleted"] } },
      include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 }, manualCredits: true },
    });

    const rows = [];
    for (const share of shares) {
      if (share.manualCredits.length > 0) continue; // already credited, don't show again
      const snapshot = share.snapshots[0];
      if (!snapshot) continue;

      const { eligible, thresholdsMet } = await this.thresholdService.evaluate(snapshot);
      if (!eligible) continue;

      const account = await this.prisma.userSocialAccount.findUnique({
        where: { userId_platform: { userId: share.userId, platform: "x" } },
      });

      rows.push({
        userId: share.userId,
        shareId: share.id,
        handle: account?.handle ?? null,
        externalPostId: share.externalPostId,
        thresholdsMet,
        metrics: {
          likes: snapshot.likes,
          retweets: snapshot.retweets,
          quoteCount: snapshot.quoteCount,
          replies: snapshot.replies,
          bookmarkCount: snapshot.bookmarkCount,
          impressionCount: snapshot.impressionCount,
        },
        fetchedAt: snapshot.fetchedAt.toISOString(),
      });
    }
    return rows;
  }

  /**
   * Ledger integration is an open question (plan §8.6) — does a wallet/credit
   * system already exist to write to? Until confirmed, this only writes the
   * local manual_credit row; the actual ledger call is a stub.
   */
  private async writeToLedger(userId: string, amount: number): Promise<void> {
    console.log(JSON.stringify({ event: "ledger_write_stubbed", userId, amount }));
    // TODO: call the core team's wallet/credit ledger once §8.6 is answered.
  }

  async issueCredit(shareId: string, amount: number, issuedBy: string) {
    const share = await this.prisma.socialShare.findUnique({ where: { id: shareId } });
    if (!share) throw new NotFoundException("share not found");

    const credit = await this.prisma.manualCredit.create({
      data: { userId: share.userId, shareId, amount, issuedBy },
    });

    await this.writeToLedger(share.userId, amount);

    return credit;
  }
}

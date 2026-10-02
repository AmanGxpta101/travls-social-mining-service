import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ThresholdService } from "../threshold/threshold.service";
import { EngagementService } from "../engagement/engagement.service";
import { TasksService } from "../tasks/tasks.service";
import { hasEnded } from "../tasks/deadline";
import { PointsService } from "../points/points.service";

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly thresholdService: ThresholdService,
    private readonly engagementService: EngagementService,
    private readonly tasksService: TasksService,
    private readonly pointsService: PointsService,
  ) {}

  /**
   * Re-checks every live post against X ($0.005 each) so statuses and
   * numbers are current — e.g. posts deleted since their last check flip to
   * "deleted". Frozen shares (deleted, invalidated, pending) are skipped.
   * Sequential on purpose: small volume, and it keeps X rate limits calm.
   */
  async refreshAllShares() {
    const live = await this.prisma.socialShare.findMany({
      where: { postStatus: "confirmed", externalPostId: { not: null } },
      select: { id: true },
    });
    let refreshed = 0;
    let nowDeleted = 0;
    const failed: { shareId: string; error: string }[] = [];
    for (const { id } of live) {
      try {
        const result = await this.engagementService.refreshEngagementForShare(id);
        refreshed++;
        if (result.postStatus === "deleted") nowDeleted++;
      } catch (err) {
        this.logger.error(`refresh-all failed for share ${id}`, err as Error);
        failed.push({ shareId: id, error: (err as Error).message });
      }
    }
    return { checked: live.length, refreshed, nowDeleted, failed };
  }

  /**
   * Rejects a submission: it stops counting toward the challenge and its
   * points, and the user can do the challenge again with a new post (this
   * post stays claimed, so it can't simply be resubmitted). The reason is
   * shown to the user.
   */
  async invalidateShare(shareId: string, reason: string, by: string) {
    const share = await this.prisma.socialShare.findUnique({ where: { id: shareId } });
    if (!share) throw new NotFoundException("share not found");
    if (share.postStatus !== "confirmed" && share.postStatus !== "deleted") {
      throw new BadRequestException(`only completed submissions can be invalidated (this one is ${share.postStatus})`);
    }
    const updated = await this.prisma.socialShare.update({
      where: { id: shareId },
      data: { postStatus: "invalidated", invalidatedReason: reason, invalidatedBy: by, invalidatedAt: new Date() },
    });

    // Take back what completing it added to Travls. Only if it was credited —
    // shares completed before the Travls ledger existed never were.
    const credit = await this.prisma.pointsLedgerEntry.findUnique({ where: { idempotencyKey: `share:${shareId}:credit` } });
    if (credit) {
      const task = await this.tasksService.find(share.copyVariant);
      await this.pointsService.record({
        userId: share.userId,
        amount: -credit.amount,
        reason: `Submission for "${task?.title ?? share.copyVariant}" rejected: ${reason}`,
        kind: "challenge_revoked",
        idempotencyKey: `share:${shareId}:revoke`,
        shareId,
        createdBy: by,
      });
    }
    return updated;
  }

  /** Disables one challenge for one user. Doesn't touch a submission they already completed — invalidate that separately. */
  async blockTask(userId: string, taskId: string, reason: string, by: string) {
    if (!(await this.tasksService.find(taskId))) throw new NotFoundException(`unknown challenge ${taskId}`);
    return this.prisma.taskBlock.upsert({
      where: { userId_taskId: { userId, taskId } },
      create: { userId, taskId, reason, blockedBy: by },
      update: { reason, blockedBy: by, blockedAt: new Date() },
    });
  }

  async unblockTask(userId: string, taskId: string) {
    await this.prisma.taskBlock.deleteMany({ where: { userId, taskId } });
    return { ok: true };
  }

  /** Every challenge, archived ones included, with how many users have completed each. */
  async listTasks() {
    const [tasks, done] = await Promise.all([
      this.tasksService.listAll(),
      this.prisma.socialShare.groupBy({
        by: ["copyVariant"],
        where: { postStatus: { in: ["confirmed", "deleted"] }, externalPostId: { not: null } },
        _count: true,
      }),
    ]);
    const completions = new Map(done.map((d) => [d.copyVariant, d._count]));
    return tasks.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      deadline: t.deadline?.toISOString() ?? null,
      ended: hasEnded(t),
      completions: completions.get(t.id) ?? 0,
    }));
  }

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
   * The handle that posted this share. Recorded on the share itself, because
   * the user's connected account can change later and must not relabel
   * history. Falls back to the current account only for shares whose author
   * was never recorded (pending, or deleted before the backfill could see
   * them), flagged so ops can tell.
   */
  private async shareHandles(shares: { userId: string; authorHandle: string | null }[]) {
    const unrecorded = [...new Set(shares.filter((s) => !s.authorHandle).map((s) => s.userId))];
    const accounts = unrecorded.length
      ? await this.prisma.userSocialAccount.findMany({ where: { userId: { in: unrecorded }, platform: "x" } })
      : [];
    const accountHandle = new Map(accounts.map((a) => [a.userId, a.handle]));
    return (share: { userId: string; authorHandle: string | null }) => {
      if (share.authorHandle) return { handle: share.authorHandle, handleIsCurrentAccount: false };
      const handle = accountHandle.get(share.userId);
      return { handle: handle ?? null, handleIsCurrentAccount: accountHandle.has(share.userId) };
    };
  }

  /**
   * Full activity feed for ops monitoring (every share, not just payout-ready
   * ones) — distinct from listEligibleUsers(), which is filtered to the
   * "who do I pay" queue. This is "what's everyone sharing, how's it doing."
   */
  async listAllShares() {
    const [shares, tasks, blocks, adjustments, evaluate] = await Promise.all([
      this.prisma.socialShare.findMany({
        orderBy: { sharedAt: "desc" },
        include: {
          snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
          manualCredits: true,
        },
      }),
      this.tasksService.listAll(),
      this.prisma.taskBlock.findMany(),
      this.prisma.pointsAdjustment.findMany({ where: { shareId: { not: null } }, orderBy: { issuedAt: "desc" } }),
      this.thresholdService.evaluator(),
    ]);
    const shareHandle = await this.shareHandles(shares);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const blockByKey = new Map(blocks.map((b) => [`${b.userId}:${b.taskId}`, b]));

    const rows = [];
    for (const share of shares) {
      const snapshot = share.snapshots[0];
      const evaluation = snapshot ? evaluate(snapshot, share.tier) : null;
      const credit = share.manualCredits[0];

      rows.push({
        shareId: share.id,
        userId: share.userId,
        ...shareHandle(share),
        postUrl: share.externalPostId ? `https://x.com/i/status/${share.externalPostId}` : null,
        postStatus: share.postStatus,
        tier: share.tier,
        copyVariant: share.copyVariant,
        // null for pre-challenge shares (copyVariant "v1_static").
        task: taskById.has(share.copyVariant)
          ? {
              id: share.copyVariant,
              title: taskById.get(share.copyVariant)!.title,
              points: taskById.get(share.copyVariant)!.points,
            }
          : null,
        invalidated: share.invalidatedAt
          ? { reason: share.invalidatedReason, by: share.invalidatedBy, at: share.invalidatedAt.toISOString() }
          : null,
        deductions: adjustments
          .filter((a) => a.shareId === share.id)
          .map((a) => ({ points: -a.amount, reason: a.reason, by: a.issuedBy, at: a.issuedAt.toISOString() })),
        taskBlock: (() => {
          const b = blockByKey.get(`${share.userId}:${share.copyVariant}`);
          return b ? { reason: b.reason, by: b.blockedBy, at: b.blockedAt.toISOString() } : null;
        })(),
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

    const [evaluate, shareHandle] = await Promise.all([this.thresholdService.evaluator(), this.shareHandles(shares)]);
    const rows = [];
    for (const share of shares) {
      if (share.manualCredits.length > 0) continue; // already credited, don't show again
      const snapshot = share.snapshots[0];
      if (!snapshot) continue;

      const { eligible, thresholdsMet } = evaluate(snapshot, share.tier);
      if (!eligible) continue;

      rows.push({
        userId: share.userId,
        shareId: share.id,
        ...shareHandle(share),
        tier: share.tier,
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

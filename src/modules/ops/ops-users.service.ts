import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { EngagementSnapshot } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";
import { PointsService } from "../points/points.service";
import { completedChallenges, countsAsDone, pointsFor } from "../tasks/progress";

const METRIC_KEYS = ["likes", "retweets", "replies", "quoteCount", "bookmarkCount", "impressionCount"] as const;
type Metrics = Record<(typeof METRIC_KEYS)[number], number>;

function metricsOf(s: EngagementSnapshot | undefined): Metrics | null {
  if (!s) return null;
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, s[k]])) as Metrics;
}

/** Totals over each post's latest snapshot. Only submissions that count — invalidated posts are excluded. */
function totalEngagement(shares: { snapshots: EngagementSnapshot[]; externalPostId: string | null; postStatus: string; copyVariant: string; sharedAt: Date }[]) {
  const totals = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Metrics;
  let posts = 0;
  for (const share of shares) {
    if (!countsAsDone(share)) continue;
    posts++;
    const m = metricsOf(share.snapshots[0]);
    if (m) for (const k of METRIC_KEYS) totals[k] += m[k];
  }
  return { posts, ...totals };
}

/**
 * Per-user views for ops: everyone who took part, and one user's full history
 * with their points and engagement. Points use the same rule as the
 * user-facing challenge list (tasks/progress.ts), so both always agree.
 */
@Injectable()
export class OpsUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly pointsService: PointsService,
  ) {}

  /** Everyone who connected X or submitted anything, most recently active first. */
  async listUsers() {
    const [shares, accounts, kols, adjustments, tasks, blocks] = await Promise.all([
      this.prisma.socialShare.findMany({ include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } } }),
      this.prisma.userSocialAccount.findMany({ where: { platform: "x" } }),
      this.prisma.kolAllowlist.findMany(),
      this.prisma.pointsAdjustment.findMany(),
      this.tasksService.listAll(),
      this.prisma.taskBlock.findMany(),
    ]);
    const taskPoints = new Map(tasks.map((t) => [t.id, t.points]));
    const challengeIds = new Set(taskPoints.keys());
    const accountByUser = new Map(accounts.map((a) => [a.userId, a]));
    const kolSet = new Set(kols.map((k) => k.userId));
    const userIds = new Set([...shares.map((s) => s.userId), ...accounts.map((a) => a.userId)]);

    const rows = [...userIds].map((userId) => {
      const mine = shares.filter((s) => s.userId === userId);
      const completed = completedChallenges(mine, challengeIds);
      const account = accountByUser.get(userId);
      const lastActive = Math.max(account?.connectedAt.getTime() ?? 0, ...mine.map((s) => s.sharedAt.getTime()));
      return {
        userId,
        handle: account?.handle ?? null,
        connected: account?.tokenStatus === "active",
        isKol: kolSet.has(userId),
        challengesCompleted: completed.size,
        submissions: mine.length,
        invalidated: mine.filter((s) => s.postStatus === "invalidated").length,
        blockedChallenges: blocks.filter((b) => b.userId === userId).length,
        points: pointsFor(completed, taskPoints, adjustments.filter((a) => a.userId === userId)),
        engagement: totalEngagement(mine),
        lastActiveAt: new Date(lastActive).toISOString(),
      };
    });
    return rows.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  async getUser(userId: string) {
    const [shares, account, kol, adjustments, tasks, blocks] = await Promise.all([
      this.prisma.socialShare.findMany({
        where: { userId },
        orderBy: { sharedAt: "desc" },
        include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 }, manualCredits: true },
      }),
      this.prisma.userSocialAccount.findUnique({ where: { userId_platform: { userId, platform: "x" } } }),
      this.prisma.kolAllowlist.findUnique({ where: { userId } }),
      this.prisma.pointsAdjustment.findMany({ where: { userId }, orderBy: { issuedAt: "desc" } }),
      this.tasksService.listAll(),
      this.prisma.taskBlock.findMany({ where: { userId } }),
    ]);
    if (!account && shares.length === 0) throw new NotFoundException("no social mining activity for this user");

    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const completed = completedChallenges(shares, new Set(taskById.keys()));
    const blockByTask = new Map(blocks.map((b) => [b.taskId, b]));
    const challengeRef = (id: string) => {
      const t = taskById.get(id);
      return t ? { id: t.id, title: t.title, points: t.points } : null;
    };

    const challenges = tasks.map((task) => {
      const attempts = shares.filter((s) => s.copyVariant === task.id);
      const done = completed.get(task.id);
      const block = blockByTask.get(task.id);
      const status = done
        ? "completed"
        : block
          ? "blocked"
          : !task.active
            ? "retired"
            : attempts.some((s) => s.postStatus === "pending_confirmation")
              ? "awaiting_post"
              : "not_started";
      return {
        id: task.id,
        title: task.title,
        points: task.points,
        active: task.active,
        status,
        completedAt: done?.sharedAt.toISOString() ?? null,
        completedShareId: done?.id ?? null,
        attempts: attempts.length,
        invalidatedAttempts: attempts.filter((s) => s.postStatus === "invalidated").length,
        block: block ? { reason: block.reason, by: block.blockedBy, at: block.blockedAt.toISOString() } : null,
      };
    });

    const history = shares.map((s) => ({
      shareId: s.id,
      challenge: challengeRef(s.copyVariant),
      copyVariant: s.copyVariant,
      tier: s.tier,
      postStatus: s.postStatus,
      counts: countsAsDone(s) && completed.get(s.copyVariant)?.id === s.id,
      postUrl: s.externalPostId ? `https://x.com/i/status/${s.externalPostId}` : null,
      postedAs: s.authorHandle,
      sharedAt: s.sharedAt.toISOString(),
      metrics: metricsOf(s.snapshots[0]),
      fetchedAt: s.snapshots[0]?.fetchedAt.toISOString() ?? null,
      invalidated: s.invalidatedAt
        ? { reason: s.invalidatedReason, by: s.invalidatedBy, at: s.invalidatedAt.toISOString() }
        : null,
      credits: s.manualCredits.map((c) => ({ amount: c.amount.toString(), by: c.issuedBy, at: c.issuedAt.toISOString() })),
    }));

    return {
      userId,
      account: account
        ? {
            handle: account.handle,
            connected: account.tokenStatus === "active",
            tokenStatus: account.tokenStatus,
            connectedAt: account.connectedAt.toISOString(),
          }
        : null,
      isKol: Boolean(kol),
      points: {
        ...pointsFor(completed, new Map(tasks.map((t) => [t.id, t.points])), adjustments),
        deductions: adjustments.map((a) => ({
          id: a.id,
          points: -a.amount,
          reason: a.reason,
          by: a.issuedBy,
          at: a.issuedAt.toISOString(),
          shareId: a.shareId,
          challenge: a.shareId ? challengeRef(shares.find((s) => s.id === a.shareId)?.copyVariant ?? "") : null,
        })),
      },
      engagement: totalEngagement(shares),
      challenges,
      history,
    };
  }

  /** Takes points away from a user, optionally tied to one of their posts. The reason is shown to the user. */
  async deductPoints(userId: string, points: number, reason: string, by: string, shareId?: string) {
    if (shareId) {
      const share = await this.prisma.socialShare.findUnique({ where: { id: shareId } });
      if (!share || share.userId !== userId) throw new BadRequestException("that post doesn't belong to this user");
    }
    const adjustment = await this.prisma.pointsAdjustment.create({
      data: { userId, shareId: shareId || null, amount: -points, reason, issuedBy: by },
    });
    await this.pointsService.record({
      userId,
      amount: adjustment.amount,
      reason,
      kind: "ops_deduction",
      idempotencyKey: `adjustment:${adjustment.id}`,
      adjustmentId: adjustment.id,
      shareId: adjustment.shareId ?? undefined,
      createdBy: by,
    });
    return adjustment;
  }

  /**
   * Credits to Travls everything social mining awarded before the Travls
   * ledger existed: counting completions and ops deductions with no ledger
   * entry. Uses the same idempotency keys as the live paths, so it's safe to
   * run any number of times, and anything already sent is skipped.
   */
  async backfillPoints(by: string) {
    const [shares, tasks, adjustments] = await Promise.all([
      this.prisma.socialShare.findMany(),
      this.tasksService.listAll(),
      this.prisma.pointsAdjustment.findMany(),
    ]);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    let recorded = 0;
    for (const userId of new Set(shares.map((s) => s.userId))) {
      const completed = completedChallenges(shares.filter((s) => s.userId === userId), new Set(taskById.keys()));
      for (const [taskId, share] of completed) {
        const task = taskById.get(taskId)!;
        const before = await this.prisma.pointsLedgerEntry.count({ where: { idempotencyKey: `share:${share.id}:credit` } });
        if (before) continue;
        await this.pointsService.record({
          userId,
          amount: task.points,
          reason: `Completed "${task.title}"`,
          kind: "challenge_completed",
          idempotencyKey: `share:${share.id}:credit`,
          shareId: share.id,
          createdBy: by,
        });
        recorded++;
      }
    }
    for (const a of adjustments) {
      if (await this.prisma.pointsLedgerEntry.count({ where: { idempotencyKey: `adjustment:${a.id}` } })) continue;
      await this.pointsService.record({
        userId: a.userId,
        amount: a.amount,
        reason: a.reason,
        kind: "ops_deduction",
        idempotencyKey: `adjustment:${a.id}`,
        adjustmentId: a.id,
        shareId: a.shareId ?? undefined,
        createdBy: by,
      });
      recorded++;
    }
    return { recorded };
  }

  /** The user's Travls points change log and our copy of their balance vs. Travls' live one. */
  pointsLedger(userId: string) {
    return this.pointsService.reconcile(userId);
  }
}

import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { PointsLedgerEntry } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SimulatedTravlsPointsClient, type TravlsPointsClient } from "./travls-points.client";

export const TRAVLS_POINTS_CLIENT = Symbol("TRAVLS_POINTS_CLIENT");

export type PointsChangeKind = "challenge_completed" | "challenge_revoked" | "ops_deduction";

export interface PointsChange {
  userId: string;
  amount: number;
  reason: string;
  kind: PointsChangeKind;
  /** Same key => same change. A repeat returns the existing entry. */
  idempotencyKey: string;
  createdBy: string;
  shareId?: string;
  adjustmentId?: string;
}

const MAX_ATTEMPTS = 10;

/**
 * Scenario 1: Travls' points are the currency and their backend owns the
 * balance. Every add/remove is written to points_ledger_entry first, then
 * pushed to Travls; the entry records the balance before and after, and a
 * copy of the latest balance is kept for reconciliation. A failed push stays
 * in the log and the job below retries it — the user's action never fails
 * because Travls was down.
 */
@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);
  // Writes for one user go to Travls one at a time, oldest first, so each
  // entry's before/after is exact. The service runs as a single instance.
  private readonly userLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRAVLS_POINTS_CLIENT) private readonly client: TravlsPointsClient,
  ) {}

  get mode() {
    return this.client.mode;
  }

  /** Going live: whatever only reached the simulator gets sent to Travls for real. */
  async onModuleInit() {
    if (this.client.mode !== "live") return;
    const { count } = await this.prisma.pointsLedgerEntry.updateMany({
      where: { simulated: true },
      data: { simulated: false, status: "pending", attempts: 0, balanceBefore: null, balanceAfter: null, syncedAt: null },
    });
    if (count) this.logger.log(`re-queued ${count} points changes that were only simulated`);
  }

  /** Logs the change and tries to push it to Travls straight away. */
  async record(change: PointsChange): Promise<PointsLedgerEntry> {
    const entry = await this.prisma.pointsLedgerEntry.upsert({
      where: { idempotencyKey: change.idempotencyKey },
      create: {
        userId: change.userId,
        amount: change.amount,
        reason: change.reason,
        kind: change.kind,
        idempotencyKey: change.idempotencyKey,
        createdBy: change.createdBy,
        shareId: change.shareId ?? null,
        adjustmentId: change.adjustmentId ?? null,
      },
      update: {},
    });
    if (entry.status === "synced") return entry;
    return this.withUserLock(entry.userId, () => this.syncUser(entry.userId)).then(
      async () => (await this.prisma.pointsLedgerEntry.findUnique({ where: { id: entry.id } })) ?? entry,
    );
  }

  /**
   * The user's Travls balance, live when Travls answers, else our last copy.
   * Reading isn't a change, so nothing is logged — only the copy is refreshed.
   */
  async getBalance(userId: string) {
    try {
      const balance = await this.remoteBalance(userId);
      const copy = await this.saveCopy(userId, balance);
      return { balance, asOf: copy.fetchedAt.toISOString(), live: true };
    } catch (err) {
      this.logger.warn(`Travls balance read failed for ${userId}: ${(err as Error).message}`);
      const copy = await this.prisma.travlsPointsBalance.findUnique({ where: { userId } });
      return { balance: copy?.balance ?? null, asOf: copy?.fetchedAt.toISOString() ?? null, live: false };
    }
  }

  /** What the user sees: balance, points still on their way to Travls, and recent changes. */
  async summaryFor(userId: string, historyLimit = 10) {
    const [balance, unsynced, history] = await Promise.all([
      this.getBalance(userId),
      this.prisma.pointsLedgerEntry.aggregate({
        where: { userId, status: { not: "synced" } },
        _sum: { amount: true },
      }),
      this.prisma.pointsLedgerEntry.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: historyLimit,
      }),
    ]);
    return {
      ...balance,
      mode: this.client.mode,
      pending: unsynced._sum.amount ?? 0,
      history: history.map((e) => ({
        id: e.id,
        amount: e.amount,
        reason: e.reason,
        kind: e.kind,
        status: e.status,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  /**
   * For ops: the full change log plus a reconciliation of our copy against
   * Travls' live balance. `drift` is live − copy; non-zero just means Travls
   * changed the balance for something outside social mining since we last
   * looked, which is expected — the entries themselves are the audit trail.
   */
  async reconcile(userId: string) {
    const [copy, entries] = await Promise.all([
      this.prisma.travlsPointsBalance.findUnique({ where: { userId } }),
      this.prisma.pointsLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    ]);
    let live: number | null = null;
    let liveError: string | null = null;
    try {
      live = await this.remoteBalance(userId);
    } catch (err) {
      liveError = (err as Error).message;
    }
    const synced = entries.filter((e) => e.status === "synced");
    return {
      mode: this.client.mode,
      copy: copy ? { balance: copy.balance, fetchedAt: copy.fetchedAt.toISOString() } : null,
      live,
      liveError,
      drift: live !== null && copy ? live - copy.balance : null,
      socialMiningNet: synced.reduce((sum, e) => sum + e.amount, 0),
      unsynced: entries.filter((e) => e.status !== "synced").length,
      entries: entries.map((e) => ({
        id: e.id,
        amount: e.amount,
        reason: e.reason,
        kind: e.kind,
        status: e.status,
        balanceBefore: e.balanceBefore,
        balanceAfter: e.balanceAfter,
        attempts: e.attempts,
        lastError: e.lastError,
        by: e.createdBy,
        shareId: e.shareId,
        at: e.createdAt.toISOString(),
        syncedAt: e.syncedAt?.toISOString() ?? null,
      })),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryUnsynced(): Promise<void> {
    const due = await this.prisma.pointsLedgerEntry.findMany({
      where: { status: { not: "synced" }, attempts: { lt: MAX_ATTEMPTS } },
      distinct: ["userId"],
      select: { userId: true },
    });
    for (const { userId } of due) {
      await this.withUserLock(userId, () => this.syncUser(userId)).catch(() => undefined);
    }
  }

  /** Pushes this user's unsynced entries to Travls in order; stops at the first failure so order holds. */
  private async syncUser(userId: string) {
    const entries = await this.prisma.pointsLedgerEntry.findMany({
      where: { userId, status: { not: "synced" }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
    });
    for (const entry of entries) {
      try {
        const before = await this.remoteBalance(userId);
        const reported = await this.client.applyChange(userId, {
          amount: entry.amount,
          reason: entry.reason,
          idempotencyKey: entry.idempotencyKey,
        });
        const after = reported ?? before + entry.amount;
        await this.prisma.pointsLedgerEntry.update({
          where: { id: entry.id },
          data: {
            status: "synced",
            simulated: this.client.mode === "simulated",
            balanceBefore: before,
            balanceAfter: after,
            attempts: { increment: 1 },
            lastError: null,
            syncedAt: new Date(),
          },
        });
        await this.saveCopy(userId, after);
        this.logger.log(
          JSON.stringify({ event: "travls_points_synced", userId, amount: entry.amount, before, after, reason: entry.reason }),
        );
      } catch (err) {
        await this.prisma.pointsLedgerEntry.update({
          where: { id: entry.id },
          data: { status: "failed", attempts: { increment: 1 }, lastError: (err as Error).message.slice(0, 500) },
        });
        this.logger.warn(`Travls points push failed for entry ${entry.id}: ${(err as Error).message}`);
        return;
      }
    }
  }

  private async remoteBalance(userId: string) {
    if (this.client instanceof SimulatedTravlsPointsClient) {
      const copy = await this.prisma.travlsPointsBalance.findUnique({ where: { userId } });
      this.client.seed(userId, copy?.balance ?? 0);
    }
    return this.client.getBalance(userId);
  }

  private saveCopy(userId: string, balance: number) {
    const fetchedAt = new Date();
    return this.prisma.travlsPointsBalance.upsert({
      where: { userId },
      create: { userId, balance, fetchedAt },
      update: { balance, fetchedAt },
    });
  }

  private withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.userLocks.get(userId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.userLocks.set(userId, next);
    void next.finally(() => {
      if (this.userLocks.get(userId) === next) this.userLocks.delete(userId);
    });
    return next;
  }
}

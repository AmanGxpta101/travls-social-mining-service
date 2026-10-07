import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { PointsLedgerEntry } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { TravlsPointsClient } from "./travls-points.client";
import { TravlsSyncSwitch } from "./travls-sync-switch";

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
// A balance copy younger than this counts as live.
const LIVE_WINDOW_MS = 5 * 60_000;

/**
 * Every add/remove of a user's points is written to points_ledger_entry under
 * our userId. Travls' points are the currency (scenario 1), so once the user's
 * X account is linked to a Travls user and Travls sync is on, entries are
 * pushed to that Travls user's balance, oldest first; each records the balance
 * before and after. Until then they're held here — nothing is lost while
 * standalone, and linking later pushes the lot. A failed push stays in the log
 * and the job below retries it; the user's action never fails because of it.
 */
@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);
  // Writes for one user go to Travls one at a time, oldest first, so each
  // entry's before/after is exact. The service runs as a single instance.
  private readonly userLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRAVLS_POINTS_CLIENT) private readonly client: TravlsPointsClient | null,
    private readonly syncSwitch: TravlsSyncSwitch,
  ) {}

  /** Logs the change and, if the user is linked and sync is on, pushes it to Travls straight away. */
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
   * Checks a Travls access token with Travls and returns whose it is. Only
   * while sync is on. Travls answers with the user's balance too, so this is
   * also where our copy of it gets refreshed — their API has no other read.
   */
  async verifyTravlsToken(accessToken: string) {
    if (!this.client || !(await this.syncSwitch.isOn())) {
      throw new ServiceUnavailableException("the Travls connection is paused");
    }
    const session = await this.client.verifySession(accessToken);
    await this.saveCopy(session.userId, session.balance);
    return session;
  }

  /** Pushes whatever is held for this user now — e.g. right after they link. */
  async syncNow(userId: string) {
    await this.withUserLock(userId, () => this.syncUser(userId));
  }

  /**
   * A Travls user's balance as last seen: on their latest token check or
   * points write. `live` means Travls reported it within the last few minutes.
   */
  private async travlsBalance(travlsUserId: string | null) {
    const copy = travlsUserId ? await this.prisma.travlsPointsBalance.findUnique({ where: { userId: travlsUserId } }) : null;
    return {
      balance: copy?.balance ?? null,
      asOf: copy?.fetchedAt.toISOString() ?? null,
      live: !!copy && Date.now() - copy.fetchedAt.getTime() < LIVE_WINDOW_MS,
    };
  }

  private async travlsUserIdOf(userId: string) {
    const account = await this.prisma.userSocialAccount.findUnique({
      where: { userId_platform: { userId, platform: "x" } },
      select: { travlsUserId: true },
    });
    return account?.travlsUserId ?? null;
  }

  /**
   * What the user sees: whether they're linked to Travls, their Travls balance
   * if so, points recorded but not yet in Travls (held or retrying), and recent changes.
   */
  async summaryFor(userId: string, historyLimit = 10) {
    const travlsUserId = await this.travlsUserIdOf(userId);
    const [balance, syncOn, unsynced, history] = await Promise.all([
      this.travlsBalance(travlsUserId),
      this.syncSwitch.isOn(),
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
      linked: travlsUserId !== null,
      syncOn,
      ...balance,
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
   * For ops: the full change log next to our copy of the linked Travls
   * balance. Travls only reveals a balance to the user's own token or in a
   * write's response, so ops can't pull a live figure on demand. A balance
   * that moved between one entry's `balanceAfter` and the next one's
   * `balanceBefore` was changed by Travls for something outside social
   * mining, which is expected.
   */
  async reconcile(userId: string) {
    const travlsUserId = await this.travlsUserIdOf(userId);
    const [copy, entries, syncOn] = await Promise.all([
      travlsUserId ? this.prisma.travlsPointsBalance.findUnique({ where: { userId: travlsUserId } }) : null,
      this.prisma.pointsLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      this.syncSwitch.isOn(),
    ]);
    const synced = entries.filter((e) => e.status === "synced");
    return {
      travlsUserId,
      syncOn,
      copy: copy ? { balance: copy.balance, fetchedAt: copy.fetchedAt.toISOString() } : null,
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

  /**
   * Gives a user's failed entries (or everyone's) a fresh set of attempts and
   * pushes them now — for after whatever made Travls reject them is fixed.
   */
  async requeueFailed(userId?: string) {
    const { count } = await this.prisma.pointsLedgerEntry.updateMany({
      where: { status: { not: "synced" }, ...(userId && { userId }) },
      data: { attempts: 0 },
    });
    await this.retryUnsynced();
    return { requeued: count };
  }

  /** Pushes held/failed entries of every linked user — the catch-up after sync is switched on. */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryUnsynced(): Promise<void> {
    if (!this.client || !(await this.syncSwitch.isOn())) return;
    const due = await this.prisma.pointsLedgerEntry.findMany({
      where: { status: { not: "synced" }, attempts: { lt: MAX_ATTEMPTS } },
      distinct: ["userId"],
      select: { userId: true },
    });
    const linked = await this.prisma.userSocialAccount.findMany({
      where: { userId: { in: due.map((d) => d.userId) }, platform: "x", travlsUserId: { not: null } },
      select: { userId: true },
    });
    for (const { userId } of linked) {
      await this.withUserLock(userId, () => this.syncUser(userId)).catch(() => undefined);
    }
  }

  /**
   * Pushes this user's unsynced entries to their Travls user in order; stops
   * at the first failure so order holds. Does nothing while sync is off or the
   * user is unlinked — the entries stay held. An entry out of attempts blocks
   * everything after it until ops re-queues it (requeueFailed) — skipping it
   * could send a revoke for a credit that never landed, taking points the
   * user never got.
   */
  private async syncUser(userId: string) {
    const client = this.client;
    if (!client || !(await this.syncSwitch.isOn())) return;
    const travlsUserId = await this.travlsUserIdOf(userId);
    if (!travlsUserId) return;
    const entries = await this.prisma.pointsLedgerEntry.findMany({
      where: { userId, status: { not: "synced" } },
      orderBy: { createdAt: "asc" },
    });
    for (const entry of entries) {
      if (entry.attempts >= MAX_ATTEMPTS) {
        this.logger.warn(`points sync for ${userId} is held at entry ${entry.id}: out of attempts (${entry.lastError ?? "no error"})`);
        return;
      }
      try {
        const after = await client.applyChange(travlsUserId, {
          amount: entry.amount,
          reason: entry.reason,
          idempotencyKey: entry.idempotencyKey,
        });
        // Travls reports only the balance after the write; before follows from it.
        const before = after - entry.amount;
        await this.prisma.pointsLedgerEntry.update({
          where: { id: entry.id },
          data: {
            status: "synced",
            balanceBefore: before,
            balanceAfter: after,
            attempts: { increment: 1 },
            lastError: null,
            syncedAt: new Date(),
          },
        });
        await this.saveCopy(travlsUserId, after);
        this.logger.log(
          JSON.stringify({ event: "travls_points_synced", userId, travlsUserId, amount: entry.amount, before, after, reason: entry.reason }),
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

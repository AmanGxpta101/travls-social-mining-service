import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Ops-managed allowlist deciding which share flow a user gets. KOLs get the
 * direct API post ($0.20/post); everyone else gets the clipboard template and
 * submits the post id back for verification — posting via the API for every
 * points-farmer doesn't pay for itself at scale.
 */
@Injectable()
export class KolService {
  constructor(private readonly prisma: PrismaService) {}

  async isKol(userId: string): Promise<boolean> {
    const row = await this.prisma.kolAllowlist.findUnique({ where: { userId } });
    return Boolean(row);
  }

  /** Connected KOLs first, then handles still waiting for their owner to connect X. */
  async list() {
    const [rows, invites] = await Promise.all([
      this.prisma.kolAllowlist.findMany({ orderBy: { addedAt: "desc" } }),
      this.prisma.kolInvite.findMany({ orderBy: { addedAt: "desc" } }),
    ]);
    const accounts = await this.prisma.userSocialAccount.findMany({
      where: { platform: "x", userId: { in: rows.map((r) => r.userId) } },
    });
    const handleByUser = new Map(accounts.map((a) => [a.userId, a.handle]));
    return [
      ...rows.map((r) => ({
        userId: r.userId as string | null,
        handle: handleByUser.get(r.userId) ?? null,
        pending: false,
        addedBy: r.addedBy,
        addedAt: r.addedAt.toISOString(),
      })),
      ...invites.map((i) => ({
        userId: null,
        handle: i.handle,
        pending: true,
        addedBy: i.addedBy,
        addedAt: i.addedAt.toISOString(),
      })),
    ];
  }

  /**
   * Accepts a userId or an X handle. A handle that's already connected makes
   * that user a KOL now; one that isn't is kept as a pending invite and
   * promoted the moment that X account connects (promoteInvite).
   */
  async add(params: { userId?: string; handle?: string; addedBy: string }) {
    let userId = params.userId?.trim();
    if (!userId) {
      const handle = normalizeHandle(params.handle);
      if (!handle) throw new BadRequestException("userId or handle is required");
      if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
        throw new BadRequestException(`@${handle} isn't a valid X handle`);
      }
      const account = await this.prisma.userSocialAccount.findFirst({
        where: { platform: "x", handle: { equals: handle, mode: "insensitive" } },
      });
      if (!account) {
        await this.prisma.kolInvite.upsert({
          where: { handle },
          create: { handle, addedBy: params.addedBy },
          update: {},
        });
        return { userId: null, handle, pending: true };
      }
      userId = account.userId;
    }

    await this.prisma.kolAllowlist.upsert({
      where: { userId },
      create: { userId, addedBy: params.addedBy },
      update: {},
    });
    return { userId, pending: false };
  }

  /**
   * Called when an X account connects: if ops pre-approved its handle, the
   * user becomes a KOL now, credited to whoever added the handle.
   */
  async promoteInvite(userId: string, handle: string) {
    const invite = await this.prisma.kolInvite.findUnique({ where: { handle: normalizeHandle(handle) } });
    if (!invite) return;
    await this.prisma.$transaction([
      this.prisma.kolAllowlist.upsert({
        where: { userId },
        create: { userId, addedBy: invite.addedBy, addedAt: invite.addedAt },
        update: {},
      }),
      this.prisma.kolInvite.delete({ where: { handle: invite.handle } }),
    ]);
  }

  async remove(userId: string) {
    await this.prisma.kolAllowlist.deleteMany({ where: { userId } });
    return { ok: true };
  }

  /** Withdraws a handle that hasn't connected yet. */
  async removeInvite(handle: string) {
    await this.prisma.kolInvite.deleteMany({ where: { handle: normalizeHandle(handle) } });
    return { ok: true };
  }
}

function normalizeHandle(handle: string | undefined): string {
  return (handle ?? "").trim().replace(/^@/, "").toLowerCase();
}

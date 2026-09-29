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

  async list() {
    const rows = await this.prisma.kolAllowlist.findMany({ orderBy: { addedAt: "desc" } });
    const accounts = await this.prisma.userSocialAccount.findMany({
      where: { platform: "x", userId: { in: rows.map((r) => r.userId) } },
    });
    const handleByUser = new Map(accounts.map((a) => [a.userId, a.handle]));
    return rows.map((r) => ({
      userId: r.userId,
      handle: handleByUser.get(r.userId) ?? null,
      addedBy: r.addedBy,
      addedAt: r.addedAt.toISOString(),
    }));
  }

  /** Accepts either a userId or an X handle (resolved via the user's connected account). */
  async add(params: { userId?: string; handle?: string; addedBy: string }) {
    let userId = params.userId?.trim();
    if (!userId) {
      const handle = params.handle?.trim().replace(/^@/, "");
      if (!handle) throw new BadRequestException("userId or handle is required");
      const account = await this.prisma.userSocialAccount.findFirst({
        where: { platform: "x", handle: { equals: handle, mode: "insensitive" } },
      });
      if (!account) {
        throw new NotFoundException(`no connected X account with handle @${handle} — add by userId instead`);
      }
      userId = account.userId;
    }

    await this.prisma.kolAllowlist.upsert({
      where: { userId },
      create: { userId, addedBy: params.addedBy },
      update: {},
    });
    return { userId };
  }

  async remove(userId: string) {
    await this.prisma.kolAllowlist.deleteMany({ where: { userId } });
    return { ok: true };
  }
}

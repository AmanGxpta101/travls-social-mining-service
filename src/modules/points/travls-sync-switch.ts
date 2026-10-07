import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { env } from "../../env";

const KEY = "travls_sync";
// Re-read at most this often, so a flip from the dashboard lands within seconds.
const CACHE_MS = 5_000;

/**
 * The ops switch for the Travls connection.
 *
 * Off: social mining runs standalone. Everyone signs in with X, points are
 * recorded in our ledger and held, and Travls is never called.
 * On: Travls access tokens are checked, X accounts get linked to the Travls
 * user who brought them, and points go to linked users' Travls balances —
 * starting with everything held for them while off or unlinked.
 *
 * Signing in with X works the same either way; only the Travls side changes.
 */
@Injectable()
export class TravlsSyncSwitch {
  private cached: { on: boolean; until: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Whether Travls can be used at all: the API is configured. */
  get available() {
    return Boolean(env.travls.apiUrl);
  }

  async isOn(): Promise<boolean> {
    if (!this.available) return false;
    const now = Date.now();
    if (this.cached && this.cached.until > now) return this.cached.on;
    const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
    const on = (row?.value as { on?: unknown } | undefined)?.on === true;
    this.cached = { on, until: now + CACHE_MS };
    return on;
  }

  async state() {
    const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
    return {
      on: this.available && (row?.value as { on?: unknown } | undefined)?.on === true,
      available: this.available,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async set(on: boolean, by: string) {
    if (on && !this.available) {
      throw new BadRequestException("TRAVLS_API_URL isn't configured on the service, so Travls sync can't be turned on");
    }
    await this.prisma.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { on }, updatedBy: by },
      update: { value: { on }, updatedBy: by },
    });
    this.cached = { on, until: Date.now() + CACHE_MS };
    return this.state();
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { TravlsCallRecord } from "./travls-points.client";

const KEEP_DAYS = 14;
// Prune on roughly one write in this many, rather than on every call.
const PRUNE_EVERY = 50;

/**
 * Keeps every call to the Travls points API (TravlsApiCall) and prints a line
 * per call, so the integration can be checked by eye: in the service
 * terminal, or on the ops dashboard's Travls API page. Saving never fails or
 * slows the call it describes.
 */
@Injectable()
export class TravlsApiLog {
  private readonly logger = new Logger("TravlsApi");
  private writes = 0;

  constructor(private readonly prisma: PrismaService) {}

  record(call: TravlsCallRecord): void {
    try {
      this.save(call);
    } catch (err) {
      this.logger.warn(`couldn't record Travls API call: ${(err as Error).message}`);
    }
  }

  private save(call: TravlsCallRecord) {
    const outcome = call.error ? `failed: ${call.error}` : `${call.status}`;
    this.logger.log(
      `${call.method} ${call.path} -> ${outcome} (${call.durationMs}ms)${call.userId ? ` user=${call.userId}` : ""}` +
        (call.requestBody ? `\n  sent:     ${call.requestBody}` : "") +
        (call.responseBody ? `\n  received: ${call.responseBody.slice(0, 2000)}` : ""),
    );
    void this.prisma.travlsApiCall
      .create({ data: { ...call, requestHeaders: call.requestHeaders } })
      .then(() => {
        if (++this.writes % PRUNE_EVERY === 0) {
          return this.prisma.travlsApiCall.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
        }
      })
      .catch((err) => this.logger.warn(`couldn't save Travls API call: ${(err as Error).message}`));
  }

  /** Newest first; optionally only the calls about one user. */
  async list(opts: { userId?: string; limit?: number }) {
    const rows = await this.prisma.travlsApiCall.findMany({
      where: opts.userId ? { userId: opts.userId } : {},
      orderBy: { at: "desc" },
      take: Math.min(Math.max(opts.limit ?? 100, 1), 500),
    });
    return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
  }
}

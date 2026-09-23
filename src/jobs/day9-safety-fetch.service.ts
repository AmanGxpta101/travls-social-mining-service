import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EngagementService } from "../modules/engagement/engagement.service";

/**
 * Per plan §7.3: guaranteed checkpoint fetch on day 9 after a share, regardless
 * of cache window, so a post deleted right before the ~10-day cutoff mentioned
 * in the source conversation can't erase already-earned eligibility.
 *
 * Runs in-process via @nestjs/schedule for Phase 0 (low volume, no queue
 * needed per plan §6). If the org already has EventBridge/Cloud Scheduler,
 * swap this for an internal endpoint that scheduler calls instead.
 */
@Injectable()
export class Day9SafetyFetchService {
  private readonly logger = new Logger(Day9SafetyFetchService.name);

  constructor(private readonly engagementService: EngagementService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const nine = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    const ten = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    const dueShares = await this.engagementService.findSharesDueForSafetyFetch(ten, nine);

    for (const share of dueShares) {
      try {
        await this.engagementService.refreshEngagementForShare(share.id);
      } catch (err) {
        this.logger.error(`day9 safety fetch failed for share ${share.id}`, err as Error);
      }
    }
  }
}

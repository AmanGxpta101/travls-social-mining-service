import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { fetchTweetMetrics } from "./x-client";

// Config per plan §7.3 — default 5-day cache window.
const CACHE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

interface SnapshotRow {
  likes: number;
  retweets: number;
  quoteCount: number;
  replies: number;
  bookmarkCount: number;
  impressionCount: number;
  fetchedAt: Date;
}

function mapSnapshot(s: SnapshotRow) {
  return {
    likes: s.likes,
    retweets: s.retweets,
    quoteCount: s.quoteCount,
    replies: s.replies,
    bookmarkCount: s.bookmarkCount,
    impressionCount: s.impressionCount,
    fetchedAt: s.fetchedAt.toISOString(),
  };
}

function zeroSnapshot() {
  return {
    likes: 0,
    retweets: 0,
    quoteCount: 0,
    replies: 0,
    bookmarkCount: 0,
    impressionCount: 0,
    fetchedAt: new Date(0).toISOString(),
  };
}

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  private async latestSnapshot(shareId: string) {
    return this.prisma.engagementSnapshot.findFirst({ where: { shareId }, orderBy: { fetchedAt: "desc" } });
  }

  /**
   * Hits the X API regardless of cache freshness, for a share id alone — no
   * user context needed (public_metrics only requires an app-only Bearer
   * Token, see x-client.ts), so this works even if the sharer has since
   * disconnected or revoked access. Used by getEngagement (when stale) and
   * the day-9 safety job.
   */
  async refreshEngagementForShare(shareId: string) {
    const share = await this.prisma.socialShare.findUnique({ where: { id: shareId } });
    if (!share) throw new NotFoundException("share not found");
    if (!share.externalPostId) throw new NotFoundException("share has no post id yet");

    const result = await fetchTweetMetrics(share.externalPostId);

    if (result.status === "deleted") {
      // Per plan §7.3: freeze last-known metrics, never drop the row. Only a
      // confirmed share becomes "deleted" — overwriting "invalidated" would
      // quietly turn an ops rejection back into a completed challenge.
      const postStatus = share.postStatus === "confirmed" ? ("deleted" as const) : share.postStatus;
      if (postStatus !== share.postStatus) {
        await this.prisma.socialShare.update({ where: { id: shareId }, data: { postStatus } });
      }
      const last = await this.latestSnapshot(shareId);
      return { snapshot: last ? mapSnapshot(last) : null, postStatus };
    }

    const snapshot = await this.prisma.engagementSnapshot.create({
      data: {
        shareId,
        likes: result.metrics.like_count,
        retweets: result.metrics.retweet_count,
        quoteCount: result.metrics.quote_count,
        replies: result.metrics.reply_count,
        bookmarkCount: result.metrics.bookmark_count,
        impressionCount: result.metrics.impression_count,
      },
    });

    return { snapshot: mapSnapshot(snapshot), postStatus: share.postStatus };
  }

  async getEngagement(userId: string, shareId: string) {
    const share = await this.prisma.socialShare.findUnique({ where: { id: shareId } });
    if (!share || share.userId !== userId) throw new NotFoundException("share not found");

    // Community-tier share the user hasn't posted/confirmed yet — nothing to fetch.
    if (!share.externalPostId) {
      return { ...zeroSnapshot(), postStatus: share.postStatus };
    }

    if (share.postStatus === "deleted") {
      const last = await this.latestSnapshot(shareId);
      return { ...(last ? mapSnapshot(last) : zeroSnapshot()), postStatus: "deleted" as const };
    }

    const last = await this.latestSnapshot(shareId);
    const fresh = last && Date.now() - last.fetchedAt.getTime() < CACHE_WINDOW_MS;
    if (fresh) {
      return { ...mapSnapshot(last), postStatus: share.postStatus };
    }

    const result = await this.refreshEngagementForShare(shareId);
    return { ...(result.snapshot ?? zeroSnapshot()), postStatus: result.postStatus };
  }

  /** Used by the day-9 safety job, which iterates due shares across all users. */
  async findSharesDueForSafetyFetch(fromExclusive: Date, toInclusive: Date) {
    return this.prisma.socialShare.findMany({
      where: {
        postStatus: "confirmed",
        externalPostId: { not: null },
        sharedAt: { lte: toInclusive, gt: fromExclusive },
      },
    });
  }
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ConnectService } from "../connect/connect.service";
import { postTweet } from "../connect/x-oauth";

// Phase 0 per plan §7.2 / §9: single static copy, not yet config-driven.
// Move to a DB-backed config table in Phase 1 (copy-by-tier, §8.3).
const STATIC_COPY_V1 =
  "I just downloaded Travls — the fastest way to fund, spend, and track your travel money. Get yours: https://travls.io";

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectService: ConnectService,
  ) {}

  /**
   * Decision on record: direct API post, not the OS share sheet, so the post id
   * is known immediately — no user paste-confirm step needed.
   */
  async createShare(userId: string) {
    const accessToken = await this.connectService.getAccessToken(userId);

    const share = await this.prisma.socialShare.create({
      data: {
        userId,
        copyVariant: "v1_static",
        postStatus: "pending_confirmation",
      },
    });

    const posted = await postTweet(accessToken, STATIC_COPY_V1);

    const updated = await this.prisma.socialShare.update({
      where: { id: share.id },
      data: { externalPostId: posted.id, postStatus: "confirmed" },
    });

    return {
      shareId: updated.id,
      copy: STATIC_COPY_V1,
      status: updated.postStatus,
      postUrl: `https://x.com/i/status/${posted.id}`,
    };
  }
}

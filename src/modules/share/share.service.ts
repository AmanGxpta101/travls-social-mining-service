import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ShareTask } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ConnectService } from "../connect/connect.service";
import { postTweet, uploadMedia } from "../connect/x-oauth";
import { fetchTweetForVerification } from "../engagement/x-client";
import { KolService } from "../kol/kol.service";
import { PointsService } from "../points/points.service";
import { renderTaskCopy } from "../tasks/tasks.config";
import { downloadChallengeImage } from "../media/storage";
import { hasEnded } from "../tasks/deadline";
import { TasksService } from "../tasks/tasks.service";
import { COUNTS_AS_DONE, completedChallenges, pointsFor } from "../tasks/progress";

const LANDING_URL = "https://travls.io";
// Shown in community previews before the share (and so its ref code) exists.
const REF_LINK_PLACEHOLDER = `${LANDING_URL}/?ref=••••••••`;

// dist/modules/share and src/modules/share sit at the same depth relative to
// the package root (tsconfig rootDir: src, outDir: dist), so this resolves
// correctly whether running from src (tsx) or dist (build).
const SHARE_PROMO_IMAGE_PATH = join(__dirname, "../../../assets/share-promo.png");

// Lowercase alphanumerics only: survives X's URL expansion unchanged and is
// matched case-insensitively anyway. 8 chars of 36 is ~2.8e12 codes.
const REF_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function generateRefCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

/**
 * Query param rather than a /r/<code> path so the link works on the existing
 * landing page today; the code also doubles as referral attribution later.
 */
function refLink(refCode: string): string {
  return `${LANDING_URL}/?ref=${refCode}`;
}

function composeIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** When a post was created, read from its id (X ids are snowflakes: ms since X's epoch, shifted 22 bits). */
function postedAt(postId: string): Date {
  return new Date(Number((BigInt(postId) >> 22n) + 1288834974657n));
}

/** Case, whitespace and X's HTML-escaping differ between what was templated and what X returns. */
function normalizePostText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function postUrlFor(postId: string): string {
  return `https://x.com/i/status/${postId}`;
}

/** Accepts a post URL (x.com / twitter.com / mobile.twitter.com .../status/<id>) or a bare id. */
function parsePostId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{5,25}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:^|\/\/|\.)(?:x|twitter)\.com\/(?:[^/]+|i(?:\/web)?)\/status(?:es)?\/(\d{5,25})/i);
  return match ? match[1] : null;
}

type ShareFlow = "direct_post" | "paste_verify";

export interface TaskView {
  id: string;
  title: string;
  description: string;
  points: number;
  /** The image to post with this challenge (public URL), or null. */
  imageUrl: string | null;
  /** Last moment a submission counts, or null if it runs until archived. */
  deadline: string | null;
  status: "not_started" | "awaiting_post" | "completed" | "blocked" | "missed";
  flow: ShareFlow;
  copy: string;
  shareId?: string;
  composeUrl?: string;
  postUrl?: string;
  completedAt?: string;
  rejection?: { reason: string; at: string | null };
}


@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectService: ConnectService,
    private readonly kolService: KolService,
    private readonly tasksService: TasksService,
    private readonly pointsService: PointsService,
  ) {}

  /**
   * Adds the challenge's points to the user's Travls balance. Keyed on the
   * share, so a retry or a double-click can't credit twice; if Travls is
   * down the entry stays queued and the share still counts as completed.
   */
  private creditCompletion(userId: string, share: { id: string }, task: ShareTask) {
    return this.pointsService.record({
      userId,
      amount: task.points,
      reason: `Completed "${task.title}"`,
      kind: "challenge_completed",
      idempotencyKey: `share:${share.id}:credit`,
      shareId: share.id,
      createdBy: "system",
    });
  }

  /**
   * The challenge list as this user sees it: which flow they get, per
   * challenge whether it's done / waiting on a pasted link / not started /
   * blocked for them, and their points after any ops deductions.
   * Makes no X API calls.
   */
  async listTasks(userId: string) {
    const isKol = await this.kolService.isKol(userId);
    const flow = isKol ? ("direct_post" as const) : ("paste_verify" as const);

    const [allTasks, shares, blocks, adjustments, travls, account] = await Promise.all([
      this.tasksService.listAll(),
      this.prisma.socialShare.findMany({ where: { userId }, orderBy: { sharedAt: "desc" } }),
      this.prisma.taskBlock.findMany({ where: { userId } }),
      this.prisma.pointsAdjustment.findMany({ where: { userId }, orderBy: { issuedAt: "desc" } }),
      this.pointsService.summaryFor(userId),
      this.prisma.userSocialAccount.findUnique({ where: { userId_platform: { userId, platform: "x" } } }),
    ]);
    const blocked = new Set(blocks.map((b) => b.taskId));
    const completed = completedChallenges(shares, new Set(allTasks.map((t) => t.id)));

    const tasks = allTasks.flatMap((task): TaskView[] => {
      const forTask = shares.filter((s) => s.copyVariant === task.id);
      const done = completed.get(task.id);
      const base = {
        id: task.id,
        title: task.title,
        description: task.description,
        points: task.points,
        imageUrl: task.imageUrl,
        deadline: task.deadline?.toISOString() ?? null,
      };

      // Completed stays visible (and counted) even if the challenge was later
      // archived, ended or blocked — none is a revocation; invalidating is.
      if (done) {
        return [
          {
            ...base,
            status: "completed" as const,
            shareId: done.id,
            flow: done.tier === "kol" ? ("direct_post" as const) : ("paste_verify" as const),
            copy: renderTaskCopy(task, done.refCode ? refLink(done.refCode) : LANDING_URL),
            postUrl: postUrlFor(done.externalPostId!),
            completedAt: done.sharedAt.toISOString(),
          },
        ];
      }
      if (!task.active) return [];
      if (blocked.has(task.id)) {
        return [{ ...base, status: "blocked" as const, flow, copy: renderTaskCopy(task, LANDING_URL) }];
      }

      // Past the deadline and not completed: missed — but only for users who
      // were here before it ended; someone who joined later never had the chance.
      if (hasEnded(task)) {
        return account && account.connectedAt < task.deadline!
          ? [{ ...base, status: "missed" as const, flow, copy: renderTaskCopy(task, LANDING_URL) }]
          : [];
      }

      // A pending community share keeps its ref code even if the user was
      // since made a KOL — they can still finish pasting it back.
      const pending = forTask.find(
        (s) => s.tier === "community" && s.postStatus === "pending_confirmation" && s.refCode,
      );
      if (pending) {
        const copy = renderTaskCopy(task, refLink(pending.refCode!));
        return [
          {
            ...base,
            status: "awaiting_post" as const,
            shareId: pending.id,
            flow: "paste_verify" as const,
            copy,
            composeUrl: composeIntentUrl(copy),
          },
        ];
      }

      const latest = forTask[0];
      return [
        {
          ...base,
          status: "not_started" as const,
          flow,
          // Everyone's post carries a personal ref link; it's made when they start.
          copy: renderTaskCopy(task, REF_LINK_PLACEHOLDER),
          // Why their last attempt didn't count, so they know what to fix.
          ...(latest?.postStatus === "invalidated"
            ? { rejection: { reason: latest.invalidatedReason ?? "", at: latest.invalidatedAt?.toISOString() ?? null } }
            : {}),
        },
      ];
    });

    const points = pointsFor(completed, new Map(allTasks.map((t) => [t.id, t.points])), adjustments);

    return {
      flow,
      points: {
        ...points,
        deductions: adjustments.map((a) => ({
          points: -a.amount,
          reason: a.reason,
          at: a.issuedAt.toISOString(),
        })),
        // The user's whole Travls balance (social mining is one source of it)
        // and the recent changes social mining made to it.
        travls,
      },
      tasks,
    };
  }

  /**
   * Hybrid flow: ops-allowlisted KOLs get a direct API post ($0.20/post + media
   * upload). Everyone else gets the task's template to post themselves and
   * submits the post back via confirmShare, which costs one $0.005 read.
   * Each task can be completed once per user.
   */
  async createShare(userId: string, taskId: string) {
    const task = await this.tasksService.find(taskId);
    if (!task || !task.active) throw new NotFoundException("this challenge isn't available any more");
    if (hasEnded(task)) throw new BadRequestException("this challenge has ended");

    const block = await this.prisma.taskBlock.findUnique({ where: { userId_taskId: { userId, taskId } } });
    if (block) throw new ForbiddenException("this challenge isn't available for your account");

    const completed = await this.prisma.socialShare.findFirst({
      where: { userId, copyVariant: task.id, externalPostId: { not: null }, postStatus: { in: [...COUNTS_AS_DONE] } },
    });
    if (completed) throw new ConflictException("you've already completed this challenge");

    if (await this.kolService.isKol(userId)) {
      return this.createDirectShare(userId, task);
    }
    return this.createCommunityShare(userId, task);
  }

  /** KOL tier: posts on the user's behalf, so the post id is known immediately. */
  private async createDirectShare(userId: string, task: ShareTask) {
    const accessToken = await this.connectService.getAccessToken(userId);
    // Posted with this account's token, so it's the author.
    const account = await this.requireConnectedAccount(userId);
    // KOLs get a personal ref link too. It isn't needed to verify (we know
    // the post id), but it attributes sign-ups to them — and KOLs are the
    // ones whose referrals matter most.
    const refCode = generateRefCode();
    const copy = renderTaskCopy(task, refLink(refCode));

    const share = await this.prisma.socialShare.create({
      data: {
        userId,
        tier: "kol",
        copyVariant: task.id,
        postStatus: "pending_confirmation",
        refCode,
        authorXUserId: account.externalUserId,
        authorHandle: account.handle,
      },
    });

    // The challenge's own image, or the default promo image if it has none.
    const image = task.imageUrl
      ? await downloadChallengeImage(task.imageUrl)
      : { buffer: await readFile(SHARE_PROMO_IMAGE_PATH), mimeType: "image/png" };
    const mediaId = await uploadMedia({ accessToken, ...image, category: "tweet_image" });

    const posted = await postTweet(accessToken, copy, [mediaId]);

    const updated = await this.prisma.socialShare.update({
      where: { id: share.id },
      data: { externalPostId: posted.id, postStatus: "confirmed" },
    });
    await this.creditCompletion(userId, updated, task);

    return {
      shareId: updated.id,
      taskId: task.id,
      flow: "direct_post" as const,
      copy,
      status: updated.postStatus,
      postUrl: postUrlFor(posted.id),
    };
  }

  /**
   * Community tier: no X API call at all here. Still requires a connected X
   * account (decision on record: verify both the ref code and the author), so
   * confirmShare can check the post came from the user's own account.
   * Reuses the task's unconfirmed share if one exists, so pressing "Copy"
   * again doesn't pile up pending rows with different codes.
   */
  private async createCommunityShare(userId: string, task: ShareTask) {
    await this.requireConnectedAccount(userId);

    const existing = await this.prisma.socialShare.findFirst({
      where: {
        userId,
        copyVariant: task.id,
        tier: "community",
        postStatus: "pending_confirmation",
        refCode: { not: null },
      },
      orderBy: { sharedAt: "desc" },
    });
    const share =
      existing ??
      (await this.prisma.socialShare.create({
        data: {
          userId,
          tier: "community",
          copyVariant: task.id,
          postStatus: "pending_confirmation",
          refCode: generateRefCode(),
        },
      }));

    const copy = renderTaskCopy(task, refLink(share.refCode!));
    return {
      shareId: share.id,
      taskId: task.id,
      flow: "paste_verify" as const,
      copy,
      // X's compose link can't carry media: the app attaches this itself
      // (share sheet on mobile, download on web).
      imageUrl: task.imageUrl,
      composeUrl: composeIntentUrl(copy),
      status: share.postStatus,
    };
  }

  /**
   * Community tier: the user posted the template themselves and submits the
   * post URL/id. Verified with one app-only read, which also gives us the
   * first engagement snapshot for free.
   */
  async confirmShare(userId: string, shareId: string, postInput: string) {
    const share = await this.prisma.socialShare.findUnique({ where: { id: shareId } });
    if (!share || share.userId !== userId) throw new NotFoundException("share not found");
    if (share.tier !== "community" || !share.refCode) {
      throw new BadRequestException("this share was posted directly and doesn't need confirming");
    }
    if (share.postStatus !== "pending_confirmation") {
      throw new ConflictException("share already confirmed");
    }
    // Checked before the paid X read.
    const task = await this.tasksService.find(share.copyVariant);
    if (task && hasEnded(task)) {
      throw new BadRequestException("this challenge has ended — submissions closed at its deadline");
    }

    const postId = parsePostId(postInput);
    if (!postId) throw new BadRequestException("couldn't read a post id from that — paste the post's link");

    const claimed = await this.prisma.socialShare.findUnique({ where: { externalPostId: postId } });
    if (claimed) throw new ConflictException("that post has already been submitted");

    const account = await this.requireConnectedAccount(userId);

    const tweet = await fetchTweetForVerification(postId);
    if (!tweet) {
      throw new BadRequestException("post not found — make sure it's public and not deleted");
    }
    if (tweet.authorId !== account.externalUserId) {
      throw new BadRequestException(`that post isn't from your connected account @${account.handle}`);
    }
    // Only that some media is attached — X doesn't let us compare it to ours.
    if (task?.imageUrl && !tweet.hasMedia) {
      throw new BadRequestException("that post is missing the challenge image — attach it and post again");
    }
    if (!task || task.template.includes("{link}")) {
      const code = share.refCode.toLowerCase();
      const hasCode = [tweet.text, ...tweet.expandedUrls].some((s) => s.toLowerCase().includes(code));
      if (!hasCode) {
        throw new BadRequestException("that post doesn't contain your Travls link — post the template as given");
      }
    } else {
      // No link means no ref code to look for, so the post has to be this
      // challenge's text, posted after the user started it — an older post
      // with the same words can't be reused.
      if (postedAt(postId) < share.sharedAt) {
        throw new BadRequestException("that post is older than when you started this challenge — post it again");
      }
      if (!normalizePostText(tweet.text).includes(normalizePostText(task.template))) {
        throw new BadRequestException("that post doesn't match the challenge text — post the template as given");
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.socialShare.update({
        where: { id: share.id },
        data: {
          externalPostId: postId,
          postStatus: "confirmed",
          authorXUserId: tweet.authorId,
          authorHandle: account.handle,
        },
      }),
      this.prisma.engagementSnapshot.create({
        data: {
          shareId: share.id,
          likes: tweet.metrics.like_count,
          retweets: tweet.metrics.retweet_count,
          quoteCount: tweet.metrics.quote_count,
          replies: tweet.metrics.reply_count,
          bookmarkCount: tweet.metrics.bookmark_count,
          impressionCount: tweet.metrics.impression_count,
        },
      }),
    ]);

    if (task) await this.creditCompletion(userId, updated, task);
    return {
      shareId: updated.id,
      taskId: share.copyVariant,
      flow: "paste_verify" as const,
      copy: task ? renderTaskCopy(task, refLink(share.refCode)) : null,
      status: updated.postStatus,
      postUrl: postUrlFor(postId),
    };
  }

  private async requireConnectedAccount(userId: string) {
    const account = await this.prisma.userSocialAccount.findUnique({
      where: { userId_platform: { userId, platform: "x" } },
    });
    if (!account || account.tokenStatus === "revoked") {
      throw new BadRequestException("connect your X account first");
    }
    return account;
  }
}

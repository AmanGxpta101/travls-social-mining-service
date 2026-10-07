import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { parseDeadline } from "./deadline";
import { CHALLENGE_IMAGE_MAX_BYTES, CHALLENGE_IMAGE_TYPES, uploadChallengeImage } from "../media/storage";

type ChallengeImage = { buffer: Buffer; mimeType: string };

function checkImage(image: ChallengeImage) {
  if (!CHALLENGE_IMAGE_TYPES[image.mimeType]) {
    throw new BadRequestException("the image must be a PNG, JPEG or WebP (GIFs and video aren't supported yet)");
  }
  if (image.buffer.length > CHALLENGE_IMAGE_MAX_BYTES) {
    throw new BadRequestException("the image must be 5 MB or smaller — X's limit");
  }
}

// X counts every URL as 23 characters regardless of length.
const X_URL_LENGTH = 23;
const X_MAX_POST_LENGTH = 280;

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "challenge"
  );
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active challenges, oldest first — the order users see them in. */
  listActive() {
    return this.prisma.shareTask.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  }

  listAll() {
    return this.prisma.shareTask.findMany({ orderBy: { createdAt: "asc" } });
  }

  /** Any challenge, active or archived (archived ones still render for users who completed them). */
  find(id: string) {
    return this.prisma.shareTask.findUnique({ where: { id } });
  }

  async create(input: {
    title: string;
    description: string;
    template: string;
    points: number;
    /** Extra points for a post with the user's own photo; ignored if the challenge has an image. */
    photoBonus?: number;
    createdBy: string;
    image?: ChallengeImage;
    /** YYYY-MM-DD; the challenge runs to the end of that day (IST). Omit for no deadline. */
    deadline?: string;
  }) {
    const title = input.title.trim();
    const template = input.template.trim();
    if (!title) throw new BadRequestException("title is required");
    if (!template) throw new BadRequestException("the post text is required");
    // {link} is optional. With it, community posts are verified by the user's
    // ref code in the link; without it, by the post's text (see ShareService).
    if (template.split("{link}").length > 2) {
      throw new BadRequestException("use {link} only once in the template");
    }
    const length = [...template.replace("{link}", "")].length + (template.includes("{link}") ? X_URL_LENGTH : 0);
    if (length > X_MAX_POST_LENGTH) {
      throw new BadRequestException(`the post would be ${length} characters; X allows ${X_MAX_POST_LENGTH}`);
    }
    if (!Number.isInteger(input.points) || input.points <= 0) {
      throw new BadRequestException("points must be a positive whole number");
    }
    const photoBonus = input.photoBonus ?? 0;
    if (!Number.isInteger(photoBonus) || photoBonus < 0) {
      throw new BadRequestException("the photo bonus must be a whole number, 0 or more");
    }
    if (input.image) checkImage(input.image);
    const deadline = input.deadline ? parseDeadline(input.deadline) : null;

    // Ids are stored on shares, so they're permanent — dedupe rather than reuse.
    const base = slugify(title);
    let id = base;
    for (let n = 2; await this.prisma.shareTask.findUnique({ where: { id } }); n++) id = `${base}_${n}`;

    // Uploaded before the row exists, so a failed upload leaves no challenge
    // live without its image.
    const imageUrl = input.image ? await uploadChallengeImage({ taskId: id, ...input.image }) : null;

    return this.prisma.shareTask.create({
      data: {
        id,
        title,
        description: input.description.trim(),
        template,
        points: input.points,
        photoBonus,
        imageUrl,
        deadline,
        createdBy: input.createdBy,
      },
    });
  }

  /**
   * Adds, replaces or (with null) removes a challenge's image. Only affects
   * posts made from now on; the old file stays in storage, since posts
   * already made may have been built from it.
   */
  async setImage(id: string, image: ChallengeImage | null) {
    const task = await this.find(id);
    if (!task) throw new NotFoundException(`unknown challenge ${id}`);
    if (image) checkImage(image);
    const imageUrl = image ? await uploadChallengeImage({ taskId: id, ...image }) : null;
    return this.prisma.shareTask.update({ where: { id }, data: { imageUrl } });
  }

  /**
   * Sets (YYYY-MM-DD) or clears (null) a challenge's deadline. Clearing it —
   * or moving it later — reopens an ended challenge for everyone who hadn't
   * completed it.
   */
  async setDeadline(id: string, day: string | null) {
    const task = await this.find(id);
    if (!task) throw new NotFoundException(`unknown challenge ${id}`);
    return this.prisma.shareTask.update({ where: { id }, data: { deadline: day ? parseDeadline(day) : null } });
  }

  /**
   * Archiving hides a challenge from users who haven't completed it and stops
   * new submissions. Completed ones keep counting — it isn't a revocation.
   */
  async setActive(id: string, active: boolean) {
    const task = await this.find(id);
    if (!task) throw new NotFoundException(`unknown challenge ${id}`);
    return this.prisma.shareTask.update({ where: { id }, data: { active } });
  }
}

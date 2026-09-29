import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DEFAULT_TASKS } from "./tasks.config";

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
export class TasksService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    for (const t of DEFAULT_TASKS) {
      await this.prisma.shareTask.upsert({
        where: { id: t.id },
        create: { ...t, createdBy: "seed" },
        update: {},
      });
    }
  }

  /** Active challenges, oldest first — the order users see them in. */
  listActive() {
    return this.prisma.shareTask.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  }

  listAll() {
    return this.prisma.shareTask.findMany({ orderBy: { createdAt: "asc" } });
  }

  /** Any challenge, active or retired (retired ones still render for users who completed them). */
  find(id: string) {
    return this.prisma.shareTask.findUnique({ where: { id } });
  }

  async create(input: { title: string; description: string; template: string; points: number; createdBy: string }) {
    const title = input.title.trim();
    const template = input.template.trim();
    if (!title) throw new BadRequestException("title is required");
    if (!template.includes("{link}")) {
      throw new BadRequestException("the post template must include {link} — that's where the user's tracking link goes");
    }
    if (template.split("{link}").length > 2) {
      throw new BadRequestException("use {link} only once in the template");
    }
    const length = [...template.replace("{link}", "")].length + X_URL_LENGTH;
    if (length > X_MAX_POST_LENGTH) {
      throw new BadRequestException(`the post would be ${length} characters; X allows ${X_MAX_POST_LENGTH}`);
    }
    if (!Number.isInteger(input.points) || input.points <= 0) {
      throw new BadRequestException("points must be a positive whole number");
    }

    // Ids are stored on shares, so they're permanent — dedupe rather than reuse.
    const base = slugify(title);
    let id = base;
    for (let n = 2; await this.prisma.shareTask.findUnique({ where: { id } }); n++) id = `${base}_${n}`;

    return this.prisma.shareTask.create({
      data: {
        id,
        title,
        description: input.description.trim(),
        template,
        points: input.points,
        createdBy: input.createdBy,
      },
    });
  }

  /**
   * Retiring hides a challenge from users who haven't completed it and stops
   * new submissions. Completed ones keep counting — it isn't a revocation.
   */
  async setActive(id: string, active: boolean) {
    const task = await this.find(id);
    if (!task) throw new NotFoundException(`unknown challenge ${id}`);
    return this.prisma.shareTask.update({ where: { id }, data: { active } });
  }
}

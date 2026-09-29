import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { OpsKeyGuard } from "../../auth/ops-key.guard";
import { OpsService } from "./ops.service";
import { IssueCreditDto } from "./dto/issue-credit.dto";
import { AddKolDto } from "./dto/add-kol.dto";
import { KolService } from "../kol/kol.service";
import { TasksService } from "../tasks/tasks.service";
import { OpsUsersService } from "./ops-users.service";
import {
  BlockTaskDto,
  CreateTaskDto,
  DeductPointsDto,
  InvalidateShareDto,
  SetTaskActiveDto,
} from "./dto/moderation.dto";

@Controller("v1/ops")
@UseGuards(OpsKeyGuard)
export class OpsController {
  constructor(
    private readonly opsService: OpsService,
    private readonly kolService: KolService,
    private readonly tasksService: TasksService,
    private readonly opsUsersService: OpsUsersService,
  ) {}

  // Campaign participants and per-user profiles (history, points, moderation).
  @Get("users")
  listUsers() {
    return this.opsUsersService.listUsers();
  }

  @Get("users/:userId")
  getUser(@Param("userId") userId: string) {
    return this.opsUsersService.getUser(userId);
  }

  // One-off: pushes points earned before the Travls ledger existed. Idempotent.
  @Post("points/backfill")
  backfillPoints(@Body() body: { by?: string }) {
    return this.opsUsersService.backfillPoints(body?.by || "backfill");
  }

  @Get("users/:userId/points")
  pointsLedger(@Param("userId") userId: string) {
    return this.opsUsersService.pointsLedger(userId);
  }

  @Post("users/:userId/deductions")
  deduct(@Param("userId") userId: string, @Body() body: DeductPointsDto) {
    return this.opsUsersService.deductPoints(userId, body.points, body.reason, body.by, body.shareId);
  }

  @Get("eligible-users")
  listEligible() {
    return this.opsService.listEligibleUsers();
  }

  @Get("shares")
  listShares() {
    return this.opsService.listAllShares();
  }

  // Declared before shares/:id/refresh so "refresh-all" isn't read as an id.
  @Post("shares/refresh-all")
  refreshAll() {
    return this.opsService.refreshAllShares();
  }

  @Post("shares/:id/invalidate")
  invalidate(@Param("id") shareId: string, @Body() body: InvalidateShareDto) {
    return this.opsService.invalidateShare(shareId, body.reason, body.by);
  }

  @Post("shares/:id/refresh")
  refreshShare(@Param("id") shareId: string) {
    return this.opsService.refreshShareEngagement(shareId);
  }

  @Post("credits")
  issueCredit(@Body() body: IssueCreditDto) {
    return this.opsService.issueCredit(body.shareId, body.amount, body.issuedBy);
  }

  // KOL allowlist — decides who gets the direct-post flow vs. paste-back.
  @Get("kols")
  listKols() {
    return this.kolService.list();
  }

  @Post("kols")
  addKol(@Body() body: AddKolDto) {
    return this.kolService.add(body);
  }

  @Delete("kols/:userId")
  removeKol(@Param("userId") userId: string) {
    return this.kolService.remove(userId);
  }

  // Per-user challenge blocks.
  @Post("task-blocks")
  blockTask(@Body() body: BlockTaskDto) {
    return this.opsService.blockTask(body.userId, body.taskId, body.reason, body.by);
  }

  @Delete("task-blocks/:userId/:taskId")
  unblockTask(@Param("userId") userId: string, @Param("taskId") taskId: string) {
    return this.opsService.unblockTask(userId, taskId);
  }

  // Challenges — shown to every user once created.
  @Get("tasks")
  listTasks() {
    return this.opsService.listTasks();
  }

  @Post("tasks")
  createTask(@Body() body: CreateTaskDto) {
    return this.tasksService.create({ ...body, createdBy: body.by });
  }

  @Patch("tasks/:id")
  setTaskActive(@Param("id") id: string, @Body() body: SetTaskActiveDto) {
    return this.tasksService.setActive(id, body.active);
  }
}

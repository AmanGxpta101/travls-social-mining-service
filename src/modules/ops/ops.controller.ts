import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { OpsKeyGuard } from "../../auth/ops-key.guard";
import { OpsService } from "./ops.service";
import { IssueCreditDto } from "./dto/issue-credit.dto";
import { AddKolDto } from "./dto/add-kol.dto";
import { KolService } from "../kol/kol.service";
import { TasksService } from "../tasks/tasks.service";
import { OpsUsersService } from "./ops-users.service";
import { TravlsApiLog } from "../points/travls-api-log";
import { PointsService } from "../points/points.service";
import { TravlsSyncSwitch } from "../points/travls-sync-switch";
import { CHALLENGE_IMAGE_MAX_BYTES } from "../media/storage";
import {
  BlockTaskDto,
  CreateTaskDto,
  DeductPointsDto,
  InvalidateShareDto,
  SetTaskActiveDto,
  SetTaskDeadlineDto,
  SetTravlsSyncDto,
} from "./dto/moderation.dto";

/** The parts of multer's in-memory file these routes read. */
interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller("v1/ops")
@UseGuards(OpsKeyGuard)
export class OpsController {
  constructor(
    private readonly opsService: OpsService,
    private readonly kolService: KolService,
    private readonly tasksService: TasksService,
    private readonly opsUsersService: OpsUsersService,
    private readonly travlsApiLog: TravlsApiLog,
    private readonly pointsService: PointsService,
    private readonly travlsSync: TravlsSyncSwitch,
  ) {}

  // The Travls connection switch: off = standalone, points held; on = link users and push points.
  @Get("settings/travls-sync")
  travlsSyncState() {
    return this.travlsSync.state();
  }

  @Put("settings/travls-sync")
  async setTravlsSync(@Body() body: SetTravlsSyncDto) {
    const state = await this.travlsSync.set(body.on, body.by);
    // Turning it on: push everything held for linked users now rather than on the next tick.
    if (state.on) void this.pointsService.retryUnsynced().catch(() => undefined);
    return state;
  }

  // Fresh attempts for points changes Travls rejected, once the cause is fixed. `?userId=` for one user.
  @Post("points/requeue")
  requeuePoints(@Query("userId") userId?: string) {
    return this.pointsService.requeueFailed(userId || undefined);
  }

  // Every call made to the Travls points API, as sent and as answered.
  @Get("travls-calls")
  travlsCalls(@Query("userId") userId?: string, @Query("limit") limit?: string) {
    return this.travlsApiLog.list({ userId: userId || undefined, limit: limit ? Number(limit) || undefined : undefined });
  }

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

  @Delete("kols/pending/:handle")
  removeKolInvite(@Param("handle") handle: string) {
    return this.kolService.removeInvite(handle);
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

  // JSON, or multipart with an optional `image` file posted with the challenge.
  @Post("tasks")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: CHALLENGE_IMAGE_MAX_BYTES } }))
  createTask(@Body() body: CreateTaskDto, @UploadedFile() image?: UploadedImage) {
    return this.tasksService.create({
      ...body,
      createdBy: body.by,
      deadline: body.deadline || undefined,
      image: image ? { buffer: image.buffer, mimeType: image.mimetype } : undefined,
    });
  }

  @Put("tasks/:id/image")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: CHALLENGE_IMAGE_MAX_BYTES } }))
  setTaskImage(@Param("id") id: string, @UploadedFile() image?: UploadedImage) {
    if (!image) throw new BadRequestException("attach an image");
    return this.tasksService.setImage(id, { buffer: image.buffer, mimeType: image.mimetype });
  }

  @Put("tasks/:id/deadline")
  setTaskDeadline(@Param("id") id: string, @Body() body: SetTaskDeadlineDto) {
    return this.tasksService.setDeadline(id, body.deadline ?? null);
  }

  @Delete("tasks/:id/image")
  removeTaskImage(@Param("id") id: string) {
    return this.tasksService.setImage(id, null);
  }

  @Patch("tasks/:id")
  setTaskActive(@Param("id") id: string, @Body() body: SetTaskActiveDto) {
    return this.tasksService.setActive(id, body.active);
  }
}

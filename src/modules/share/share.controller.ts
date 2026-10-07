import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { UserId } from "../../auth/user-id.decorator";
import { ShareService } from "./share.service";
import { ConfirmShareDto } from "./dto/confirm-share.dto";
import { CreateShareDto } from "./dto/create-share.dto";

@Controller("v1")
@UseGuards(SessionGuard)
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Get("tasks")
  listTasks(@UserId() userId: string) {
    return this.shareService.listTasks(userId);
  }

  @Post("shares")
  create(@UserId() userId: string, @Body() body: CreateShareDto) {
    return this.shareService.createShare(userId, body.taskId);
  }

  @Post("shares/:id/confirm")
  confirm(@UserId() userId: string, @Param("id") shareId: string, @Body() body: ConfirmShareDto) {
    return this.shareService.confirmShare(userId, shareId, body.post);
  }

  // Back from X: look for the post among the user's latest, no link pasted.
  @Post("shares/:id/detect")
  detect(@UserId() userId: string, @Param("id") shareId: string) {
    return this.shareService.detectShare(userId, shareId);
  }
}

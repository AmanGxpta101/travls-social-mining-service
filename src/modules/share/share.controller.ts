import { Controller, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { UserId } from "../../auth/user-id.decorator";
import { ShareService } from "./share.service";

@Controller("v1/shares")
@UseGuards(SessionGuard)
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Post()
  create(@UserId() userId: string) {
    return this.shareService.createShare(userId);
  }
}

import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { UserId } from "../../auth/user-id.decorator";
import { EngagementService } from "./engagement.service";

@Controller("v1/shares")
@UseGuards(SessionGuard)
export class EngagementController {
  constructor(private readonly engagementService: EngagementService) {}

  @Get(":id/engagement")
  get(@UserId() userId: string, @Param("id") shareId: string) {
    return this.engagementService.getEngagement(userId, shareId);
  }
}

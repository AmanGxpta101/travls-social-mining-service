import { Controller, Get, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { UserId } from "../../auth/user-id.decorator";
import { RewardsService } from "./rewards.service";

@Controller("v1/rewards")
@UseGuards(SessionGuard)
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get("status")
  status(@UserId() userId: string) {
    return this.rewardsService.getRewardStatus(userId);
  }
}

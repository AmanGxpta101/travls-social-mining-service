import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OpsKeyGuard } from "../../auth/ops-key.guard";
import { OpsService } from "./ops.service";
import { IssueCreditDto } from "./dto/issue-credit.dto";

@Controller("v1/ops")
@UseGuards(OpsKeyGuard)
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get("eligible-users")
  listEligible() {
    return this.opsService.listEligibleUsers();
  }

  @Get("shares")
  listShares() {
    return this.opsService.listAllShares();
  }

  @Post("shares/:id/refresh")
  refreshShare(@Param("id") shareId: string) {
    return this.opsService.refreshShareEngagement(shareId);
  }

  @Post("credits")
  issueCredit(@Body() body: IssueCreditDto) {
    return this.opsService.issueCredit(body.shareId, body.amount, body.issuedBy);
  }
}

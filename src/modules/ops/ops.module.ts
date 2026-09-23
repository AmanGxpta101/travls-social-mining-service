import { Module } from "@nestjs/common";
import { ThresholdModule } from "../threshold/threshold.module";
import { EngagementModule } from "../engagement/engagement.module";
import { OpsController } from "./ops.controller";
import { OpsService } from "./ops.service";

@Module({
  imports: [ThresholdModule, EngagementModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}

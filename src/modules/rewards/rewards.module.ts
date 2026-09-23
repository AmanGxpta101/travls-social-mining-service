import { Module } from "@nestjs/common";
import { ThresholdModule } from "../threshold/threshold.module";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";

@Module({
  imports: [ThresholdModule],
  controllers: [RewardsController],
  providers: [RewardsService],
})
export class RewardsModule {}

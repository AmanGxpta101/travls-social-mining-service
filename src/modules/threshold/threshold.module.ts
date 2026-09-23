import { Module } from "@nestjs/common";
import { ThresholdService } from "./threshold.service";

@Module({
  providers: [ThresholdService],
  exports: [ThresholdService],
})
export class ThresholdModule {}

import { Module } from "@nestjs/common";
import { EngagementModule } from "../modules/engagement/engagement.module";
import { Day9SafetyFetchService } from "./day9-safety-fetch.service";

@Module({
  imports: [EngagementModule],
  providers: [Day9SafetyFetchService],
})
export class JobsModule {}

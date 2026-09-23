import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./prisma/prisma.module";
import { ConnectModule } from "./modules/connect/connect.module";
import { ShareModule } from "./modules/share/share.module";
import { EngagementModule } from "./modules/engagement/engagement.module";
import { ThresholdModule } from "./modules/threshold/threshold.module";
import { RewardsModule } from "./modules/rewards/rewards.module";
import { OpsModule } from "./modules/ops/ops.module";
import { JobsModule } from "./jobs/jobs.module";
import { AppController } from "./app.controller";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    ConnectModule,
    ShareModule,
    EngagementModule,
    ThresholdModule,
    RewardsModule,
    OpsModule,
    JobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

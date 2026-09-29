import { Module } from "@nestjs/common";
import { ThresholdModule } from "../threshold/threshold.module";
import { EngagementModule } from "../engagement/engagement.module";
import { KolModule } from "../kol/kol.module";
import { PointsModule } from "../points/points.module";
import { TasksModule } from "../tasks/tasks.module";
import { OpsController } from "./ops.controller";
import { OpsService } from "./ops.service";
import { OpsUsersService } from "./ops-users.service";

@Module({
  imports: [ThresholdModule, EngagementModule, KolModule, PointsModule, TasksModule],
  controllers: [OpsController],
  providers: [OpsService, OpsUsersService],
})
export class OpsModule {}

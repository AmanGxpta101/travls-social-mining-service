import { Module } from "@nestjs/common";
import { ConnectModule } from "../connect/connect.module";
import { KolModule } from "../kol/kol.module";
import { PointsModule } from "../points/points.module";
import { TasksModule } from "../tasks/tasks.module";
import { ShareController } from "./share.controller";
import { ShareService } from "./share.service";

@Module({
  imports: [ConnectModule, KolModule, PointsModule, TasksModule],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}

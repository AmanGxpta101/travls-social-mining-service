import { Module } from "@nestjs/common";
import { ConnectModule } from "../connect/connect.module";
import { ShareController } from "./share.controller";
import { ShareService } from "./share.service";

@Module({
  imports: [ConnectModule],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}

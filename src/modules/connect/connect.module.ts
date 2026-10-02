import { Module } from "@nestjs/common";
import { ConnectController } from "./connect.controller";
import { ConnectService } from "./connect.service";
import { KolModule } from "../kol/kol.module";

@Module({
  imports: [KolModule],
  controllers: [ConnectController],
  providers: [ConnectService],
  exports: [ConnectService],
})
export class ConnectModule {}

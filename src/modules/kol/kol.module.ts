import { Module } from "@nestjs/common";
import { KolService } from "./kol.service";

@Module({
  providers: [KolService],
  exports: [KolService],
})
export class KolModule {}

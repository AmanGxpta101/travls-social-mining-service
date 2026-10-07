import { Global, Module } from "@nestjs/common";
import { SessionService } from "./session.service";

// Global so SessionGuard can be used on any controller.
@Global()
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class AuthModule {}

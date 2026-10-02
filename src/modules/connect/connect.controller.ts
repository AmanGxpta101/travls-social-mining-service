import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { UserId } from "../../auth/user-id.decorator";
import { ConnectService } from "./connect.service";
import { ConnectInitDto } from "./dto/connect-init.dto";
import { ConnectCallbackDto } from "./dto/connect-callback.dto";

/**
 * init and callback are open: signing in with X is what hands the client its
 * userId, which it then sends as its session token on every other route.
 */
@Controller("v1/connect")
export class ConnectController {
  constructor(private readonly connectService: ConnectService) {}

  @Post("init")
  init(@Body() body: ConnectInitDto) {
    return this.connectService.initConnect(body.platform);
  }

  @Post("callback")
  callback(@Body() body: ConnectCallbackDto) {
    return this.connectService.handleConnectCallback(body.code, body.state);
  }

  @Post("disconnect")
  @UseGuards(SessionGuard)
  async disconnect(@UserId() userId: string) {
    await this.connectService.disconnect(userId);
    return { ok: true };
  }

  @Get("status")
  @UseGuards(SessionGuard)
  status(@UserId() userId: string) {
    return this.connectService.getStatus(userId);
  }
}

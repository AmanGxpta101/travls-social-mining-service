import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { UserId } from "../../auth/user-id.decorator";
import { ConnectService } from "./connect.service";
import { ConnectInitDto } from "./dto/connect-init.dto";
import { ConnectCallbackDto } from "./dto/connect-callback.dto";

@Controller("v1/connect")
@UseGuards(SessionGuard)
export class ConnectController {
  constructor(private readonly connectService: ConnectService) {}

  @Post("init")
  init(@UserId() userId: string, @Body() body: ConnectInitDto) {
    return this.connectService.initConnect(userId, body.platform);
  }

  @Post("callback")
  callback(@UserId() userId: string, @Body() body: ConnectCallbackDto) {
    return this.connectService.handleConnectCallback(userId, body.code, body.state);
  }

  @Post("disconnect")
  async disconnect(@UserId() userId: string) {
    await this.connectService.disconnect(userId);
    return { ok: true };
  }

  @Get("status")
  status(@UserId() userId: string) {
    return this.connectService.getStatus(userId);
  }
}

import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../auth/session.guard";
import { SessionService } from "../../auth/session.service";
import { UserId } from "../../auth/user-id.decorator";
import { ConnectService } from "./connect.service";
import { ConnectInitDto } from "./dto/connect-init.dto";
import { ConnectCallbackDto, LinkTravlsDto } from "./dto/connect-callback.dto";

/**
 * init and callback are open: signing in with X is the login, and the
 * callback hands back the session token every other route needs.
 */
@Controller("v1/connect")
export class ConnectController {
  constructor(
    private readonly connectService: ConnectService,
    private readonly sessions: SessionService,
  ) {}

  @Post("init")
  init(@Body() body: ConnectInitDto) {
    return this.connectService.initConnect(body.platform);
  }

  @Post("callback")
  async callback(@Body() body: ConnectCallbackDto) {
    const result = await this.connectService.handleConnectCallback(body.code, body.state, body.travlsToken);
    return { ...result, sessionToken: this.sessions.issue(result.userId) };
  }

  // Arriving from the cards dashboard: a Travls token is enough to sign in
  // once that Travls user is linked to an X account. Open, like callback —
  // the Travls token is the credential.
  @Post("travls-session")
  async travlsSession(@Body() body: LinkTravlsDto) {
    const userId = await this.connectService.userForTravlsToken(body.token);
    return userId ? { signedIn: true, userId, sessionToken: this.sessions.issue(userId) } : { signedIn: false };
  }

  // A signed-in user arriving from the cards dashboard: link them to that Travls user.
  @Post("travls")
  @UseGuards(SessionGuard)
  linkTravls(@UserId() userId: string, @Body() body: LinkTravlsDto) {
    return this.connectService.linkTravls(userId, body.token);
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

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { bearerToken, SessionService } from "./session.service";

/** Resolves the session token (see SessionService) onto `req.userId`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) {
      throw new UnauthorizedException("missing session token");
    }
    req.userId = this.sessions.resolve(token);
    return true;
  }
}

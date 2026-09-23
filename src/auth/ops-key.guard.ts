import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../env";

/** Ops routes (Retool/Airtable sync) authenticate with a separate internal key, not a user session. */
@Injectable()
export class OpsKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers["x-ops-key"];
    if (!env.opsApiKey || !key || key !== env.opsApiKey) {
      throw new UnauthorizedException("invalid ops key");
    }
    return true;
  }
}

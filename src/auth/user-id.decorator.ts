import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** The userId SessionGuard resolved onto the request. Use only on routes behind SessionGuard. */
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.userId;
});

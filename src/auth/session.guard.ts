import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

/**
 * Per plan §5: this service trusts the same session token the dashboard/mobile
 * app already issues — no separate login. Verification here is a placeholder;
 * wire it to the org's actual session-token verifier before this leaves Phase 0.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
    if (!token) {
      throw new UnauthorizedException("missing session token");
    }
    // TODO: verify `token` against the core team's session store / JWT issuer
    // and resolve the real userId. Placeholder decodes nothing and is not secure.
    req.userId = token;
    return true;
  }
}

import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Turns a failed X API response into a Nest HttpException with an actionable
 * message, instead of a plain Error that Nest's default filter flattens into
 * an opaque "Internal server error" (500) with no detail. Learned the hard
 * way: a rotated X_BEARER_TOKEN showed as a bare 500 with nothing pointing at
 * the actual cause — this is what should have surfaced it immediately.
 */
export async function throwOnXApiError(res: Response, context: string): Promise<never> {
  const body = await res.text();

  if (res.status === 401 || res.status === 403) {
    throw new HttpException(
      `X API rejected credentials for ${context} (${res.status}). The token may have been regenerated/rotated in the X Developer Portal — check it matches .env, then restart the service.`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  if (res.status === 429) {
    throw new HttpException(
      `X API rate-limited ${context} (429). Back off and retry.`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  throw new HttpException(`X API error for ${context}: ${res.status} ${body}`, HttpStatus.BAD_GATEWAY);
}

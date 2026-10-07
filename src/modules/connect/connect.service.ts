import { randomUUID } from "node:crypto";
import { BadRequestException, HttpException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { KolService } from "../kol/kol.service";
import { PointsService } from "../points/points.service";
import { TravlsApiError } from "../points/travls-points.client";
import { env } from "../../env";
import { decryptToken, encryptToken } from "../../crypto";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchXUser,
  generatePkce,
  refreshAccessToken,
  type TokenResponse,
} from "./x-oauth";

const STATE_TTL_MS = 10 * 60 * 1000;
// Refresh a bit before actual expiry so a request never races the token dying mid-flight.
const REFRESH_SKEW_MS = 60 * 1000;

function expiresAtFrom(tokens: TokenResponse): Date {
  return new Date(Date.now() + tokens.expires_in * 1000);
}

/**
 * Why a Travls token didn't link. Never shown to users — to them social
 * mining is simply part of Travls. The `*_taken` conflicts are logged as
 * warnings for ops to sort out; the rest resolve themselves next visit.
 */
export type TravlsLinkFailure =
  | "paused" // ops have Travls sync off
  | "token_invalid" // Travls rejected the token (expired, usually)
  | "travls_unreachable"
  | "not_connected" // no X account yet
  | "x_account_taken" // this X account is linked to another Travls user
  | "travls_account_taken"; // this Travls user is linked to another X account

/** What came of presenting a Travls token; never fatal to signing in. `reason` is for logs and ops. */
export type TravlsLinkResult =
  | { status: "linked"; travlsUserId: string }
  | { status: "not_linked"; code: TravlsLinkFailure; reason: string };

@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kolService: KolService,
    private readonly points: PointsService,
  ) {}

  async initConnect(platform: "web" | "mobile") {
    const { verifier, challenge } = generatePkce();
    const state = randomUUID();

    await this.prisma.pendingOAuthState.create({
      data: {
        state,
        platform,
        verifier,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    const redirectUri = platform === "web" ? env.x.redirectUriWeb : env.x.redirectUriMobile;
    const authorizeUrl = buildAuthorizeUrl({ state, codeChallenge: challenge, redirectUri });
    return { authorizeUrl, state };
  }

  /**
   * Signing in with X: the X account decides the user. One seen before gets
   * its userId back; a new one gets a freshly minted one. So each X account is
   * exactly one user, and the userId never changes — linking to Travls later
   * only adds the Travls id next to it.
   *
   * `travlsToken`: the user came in from the cards dashboard. If Travls sync
   * is on, the account is linked to that Travls user too (see linkTravls); if
   * linking doesn't work out, sign-in still succeeds and says why.
   */
  async handleConnectCallback(code: string, state: string, travlsToken?: string) {
    // The state is random, single-use and short-lived, and the PKCE verifier
    // never leaves the server — that's what ties this callback to its init.
    const pending = await this.prisma.pendingOAuthState.findUnique({ where: { state } });
    if (!pending) {
      throw new BadRequestException("unknown or expired OAuth state");
    }
    await this.prisma.pendingOAuthState.delete({ where: { state } });
    if (pending.expiresAt < new Date()) {
      throw new BadRequestException("OAuth state expired, restart connect");
    }

    const redirectUri = pending.platform === "web" ? env.x.redirectUriWeb : env.x.redirectUriMobile;
    const tokens = await exchangeCodeForTokens({ code, verifier: pending.verifier, redirectUri });
    const xUser = await fetchXUser(tokens.access_token);

    const credentials = {
      handle: xUser.username,
      accessTokenEnc: encryptToken(tokens.access_token),
      accessTokenExpiresAt: expiresAtFrom(tokens),
      refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      tokenStatus: "active" as const,
    };
    const account = await this.prisma.userSocialAccount.upsert({
      where: { platform_externalUserId: { platform: "x", externalUserId: xUser.id } },
      create: { userId: `usr_${randomUUID()}`, platform: "x", externalUserId: xUser.id, ...credentials },
      update: credentials,
    });

    // Ops may have added this handle as a KOL before the account connected.
    await this.kolService.promoteInvite(account.userId, xUser.username);

    const travls = travlsToken ? await this.linkTravls(account.userId, travlsToken) : null;
    return { userId: account.userId, handle: xUser.username, xUserId: xUser.id, tokenStatus: "active" as const, travls };
  }

  /**
   * Links this user's X account to the Travls user a Travls access token
   * belongs to, then pushes the points held for them. One to one both ways:
   * a Travls user already linked to another X account, or an X account
   * already linked to another Travls user, is refused (ops can sort it out).
   * Linking the same pair again is a no-op.
   */
  async linkTravls(userId: string, travlsToken: string): Promise<TravlsLinkResult> {
    const account = await this.prisma.userSocialAccount.findUnique({
      where: { userId_platform: { userId, platform: "x" } },
    });
    if (!account) return { status: "not_linked", code: "not_connected", reason: "connect X first" };

    let travlsUserId: string;
    try {
      ({ userId: travlsUserId } = await this.points.verifyTravlsToken(travlsToken));
    } catch (err) {
      if (err instanceof HttpException) return { status: "not_linked", code: "paused", reason: err.message };
      if (err instanceof TravlsApiError && err.status < 500) {
        return { status: "not_linked", code: "token_invalid", reason: "Travls rejected the access token" };
      }
      return { status: "not_linked", code: "travls_unreachable", reason: (err as Error).message };
    }

    if (account.travlsUserId && account.travlsUserId !== travlsUserId) {
      this.logger.warn(
        JSON.stringify({ event: "travls_link_conflict", code: "x_account_taken", userId, travlsUserId, linkedTo: account.travlsUserId }),
      );
      return {
        status: "not_linked",
        code: "x_account_taken",
        reason: `@${account.handle} is already linked to another Travls account`,
      };
    }
    if (!account.travlsUserId) {
      const taken = await this.prisma.userSocialAccount.findUnique({ where: { travlsUserId } });
      if (taken) {
        this.logger.warn(
          JSON.stringify({ event: "travls_link_conflict", code: "travls_account_taken", userId, travlsUserId, linkedTo: taken.userId }),
        );
        return {
          status: "not_linked",
          code: "travls_account_taken",
          reason: `this Travls account is already linked to @${taken.handle}`,
        };
      }
      await this.prisma.$transaction([
        this.prisma.userSocialAccount.update({
          where: { id: account.id },
          data: { travlsUserId, travlsLinkedAt: new Date() },
        }),
        // Anything that failed before had nowhere valid to go; give it fresh attempts.
        this.prisma.pointsLedgerEntry.updateMany({
          where: { userId, status: { not: "synced" } },
          data: { attempts: 0 },
        }),
      ]);
      this.logger.log(JSON.stringify({ event: "travls_linked", userId, travlsUserId, handle: account.handle }));
    }
    // Held points go now rather than on the next sync tick; a failure is retried there.
    await this.points.syncNow(userId).catch(() => undefined);
    return { status: "linked", travlsUserId };
  }

  /**
   * Signing in with a Travls access token alone: the user whose X account is
   * already linked to that Travls user. Lets someone coming from the cards
   * dashboard skip X sign-in after the first time, on any device. Null when
   * nobody is linked to it yet (they sign in with X, which links them), the
   * token is rejected, or Travls sync is off.
   */
  async userForTravlsToken(travlsToken: string): Promise<string | null> {
    let travlsUserId: string;
    try {
      ({ userId: travlsUserId } = await this.points.verifyTravlsToken(travlsToken));
    } catch {
      return null;
    }
    const account = await this.prisma.userSocialAccount.findUnique({ where: { travlsUserId } });
    if (!account) return null;
    this.logger.log(JSON.stringify({ event: "travls_sign_in", userId: account.userId, travlsUserId }));
    return account.userId;
  }

  async disconnect(userId: string) {
    await this.prisma.userSocialAccount.updateMany({
      where: { userId, platform: "x" },
      data: { tokenStatus: "revoked" },
    });
    // Per plan §7.1: shares and their last-known engagement stay intact;
    // only future fetches will fail (surfaced via token_status).
  }

  async getStatus(userId: string) {
    const account = await this.prisma.userSocialAccount.findUnique({
      where: { userId_platform: { userId, platform: "x" } },
    });
    if (!account) return { connected: false };
    return {
      connected: account.tokenStatus === "active",
      handle: account.handle,
      tokenStatus: account.tokenStatus,
      travlsLinked: account.travlsUserId !== null,
    };
  }

  /**
   * Decrypted access token for a user, for use by the Share module (posting
   * requires user context; engagement reads don't — see EngagementService).
   * Refreshes via the stored refresh_token if the access token is at/near
   * expiry (`offline.access` was requested specifically for this).
   */
  async getAccessToken(userId: string): Promise<string> {
    const account = await this.prisma.userSocialAccount.findUnique({
      where: { userId_platform: { userId, platform: "x" } },
    });
    if (!account || account.tokenStatus !== "active") {
      throw new BadRequestException("not connected");
    }

    const nearExpiry =
      !account.accessTokenExpiresAt || account.accessTokenExpiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;

    if (!nearExpiry) {
      return decryptToken(account.accessTokenEnc);
    }

    if (!account.refreshTokenEnc) {
      await this.prisma.userSocialAccount.update({
        where: { userId_platform: { userId, platform: "x" } },
        data: { tokenStatus: "expired" },
      });
      throw new BadRequestException("access token expired and no refresh token on file");
    }

    try {
      const tokens = await refreshAccessToken(decryptToken(account.refreshTokenEnc));
      await this.prisma.userSocialAccount.update({
        where: { userId_platform: { userId, platform: "x" } },
        data: {
          accessTokenEnc: encryptToken(tokens.access_token),
          accessTokenExpiresAt: expiresAtFrom(tokens),
          // X may rotate the refresh token; keep whichever is current.
          refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : account.refreshTokenEnc,
        },
      });
      return tokens.access_token;
    } catch (err) {
      await this.prisma.userSocialAccount.update({
        where: { userId_platform: { userId, platform: "x" } },
        data: { tokenStatus: "revoked" },
      });
      throw new BadRequestException("token refresh failed, reconnect required");
    }
  }
}

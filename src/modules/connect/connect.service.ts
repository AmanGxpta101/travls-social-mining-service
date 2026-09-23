import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
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

@Injectable()
export class ConnectService {
  constructor(private readonly prisma: PrismaService) {}

  async initConnect(userId: string, platform: "web" | "mobile") {
    const { verifier, challenge } = generatePkce();
    const state = randomUUID();

    await this.prisma.pendingOAuthState.create({
      data: {
        state,
        userId,
        platform,
        verifier,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    const redirectUri = platform === "web" ? env.x.redirectUriWeb : env.x.redirectUriMobile;
    const authorizeUrl = buildAuthorizeUrl({ state, codeChallenge: challenge, redirectUri });
    return { authorizeUrl, state };
  }

  async handleConnectCallback(userId: string, code: string, state: string) {
    const pending = await this.prisma.pendingOAuthState.findUnique({ where: { state } });
    if (!pending || pending.userId !== userId) {
      throw new BadRequestException("unknown or expired OAuth state");
    }
    if (pending.expiresAt < new Date()) {
      await this.prisma.pendingOAuthState.delete({ where: { state } });
      throw new BadRequestException("OAuth state expired, restart connect");
    }

    const redirectUri = pending.platform === "web" ? env.x.redirectUriWeb : env.x.redirectUriMobile;
    const tokens = await exchangeCodeForTokens({ code, verifier: pending.verifier, redirectUri });
    const xUser = await fetchXUser(tokens.access_token);

    await this.prisma.userSocialAccount.upsert({
      where: { userId_platform: { userId, platform: "x" } },
      create: {
        userId,
        platform: "x",
        externalUserId: xUser.id,
        handle: xUser.username,
        accessTokenEnc: encryptToken(tokens.access_token),
        accessTokenExpiresAt: expiresAtFrom(tokens),
        refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        tokenStatus: "active",
      },
      update: {
        externalUserId: xUser.id,
        handle: xUser.username,
        accessTokenEnc: encryptToken(tokens.access_token),
        accessTokenExpiresAt: expiresAtFrom(tokens),
        refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        tokenStatus: "active",
      },
    });

    await this.prisma.pendingOAuthState.delete({ where: { state } });

    return { handle: xUser.username, xUserId: xUser.id, tokenStatus: "active" as const };
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

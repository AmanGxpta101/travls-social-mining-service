function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  x: {
    clientId: process.env.X_CLIENT_ID ?? "",
    clientSecret: process.env.X_CLIENT_SECRET ?? "",
    redirectUriWeb: process.env.X_REDIRECT_URI_WEB ?? "",
    redirectUriMobile: process.env.X_REDIRECT_URI_MOBILE ?? "",
    // App-only auth for public_metrics reads (docs.x.com confirms these only need
    // a Bearer Token, not user context) — so engagement fetch doesn't depend on
    // any individual user's OAuth token staying valid.
    bearerToken: process.env.X_BEARER_TOKEN ?? "",
  },
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  ledger: {
    apiUrl: process.env.LEDGER_API_URL ?? "",
    apiKey: process.env.LEDGER_API_KEY ?? "",
  },
  opsApiKey: process.env.OPS_API_KEY ?? "",
};

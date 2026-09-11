export async function createJwtCodec({ secret, issuer, audience, accessTokenTtlSeconds = 900 }) {
  if (!secret) throw new Error("JWT secret is required");
  if (!issuer) throw new Error("JWT issuer is required");
  if (!audience) throw new Error("JWT audience is required");
  const { SignJWT, jwtVerify } = await import("jose");
  const key = new TextEncoder().encode(secret);
  return Object.freeze({
    async signAccessToken({ userId, organizationId, role, scopes = [], mobileDeviceId = undefined }) {
      const now = Math.floor(Date.now() / 1000);
      const claims = { org: organizationId, role, scopes };
      if (mobileDeviceId) claims.mobileDeviceId = mobileDeviceId;
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(now)
        .setExpirationTime(now + accessTokenTtlSeconds)
        .sign(key);
    },
    async verifyAccessToken(token) {
      const { payload } = await jwtVerify(token, key, { issuer, audience, algorithms: ["HS256"] });
      return payload;
    },
    describe() {
      return { algorithm: "HS256", issuer, audience, accessTokenTtlSeconds };
    },
  });
}

/**
 * Cloudflare Access verification for the dashboard + API.
 *
 * The `/admin` and `/api/prints` routes are placed behind a Cloudflare Access
 * application (configured in the Cloudflare dashboard). Access injects a signed
 * JWT in the `Cf-Access-Jwt-Assertion` header (and `CF_Authorization` cookie).
 * We verify that JWT against the team's public keys so the routes can't be
 * reached by bypassing Access (e.g. hitting the origin directly).
 *
 * Required runtime env (set as Pages variables/secrets):
 *   • CF_ACCESS_TEAM_DOMAIN  e.g. "yourteam.cloudflareaccess.com"
 *   • CF_ACCESS_AUD          the Access application's Audience (AUD) tag
 *
 * Local development: set DASHBOARD_DEV_BYPASS=1 to skip verification.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessUser {
  email?: string;
  sub?: string;
}

type Env = Record<string, string | undefined> & { [k: string]: unknown };

// Cache one JWKS resolver per team domain across requests (Workers keep modules warm).
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`)
    );
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

function readToken(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Returns the authenticated Access user, or null if verification fails.
 * Throws only on misconfiguration so it surfaces loudly in logs.
 */
export async function verifyAccess(
  request: Request,
  env: Env
): Promise<AccessUser | null> {
  if (env.DASHBOARD_DEV_BYPASS === "1") {
    return { email: "dev@localhost" };
  }

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN as string | undefined;
  const aud = env.CF_ACCESS_AUD as string | undefined;
  if (!teamDomain || !aud) {
    throw new Error(
      "Cloudflare Access not configured: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD."
    );
  }

  const token = readToken(request);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: aud,
    });
    return { email: payload.email as string | undefined, sub: payload.sub };
  } catch {
    return null;
  }
}

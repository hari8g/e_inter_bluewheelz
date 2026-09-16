import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const USERNAME = process.env.DASHBOARD_USERNAME ?? "bluewheelz";
const PASSWORD = process.env.DASHBOARD_PASSWORD ?? "bluewheelz";
const SECRET = process.env.AUTH_SECRET ?? "e-inter-demo-dashboard-secret";
const TTL_MS = 12 * 60 * 60 * 1000;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function credentialsMatch(username: string, password: string): boolean {
  return safeEqual(username.trim(), USERNAME) && safeEqual(password, PASSWORD);
}

export function signSession(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: username.trim(), exp: Date.now() + TTL_MS }),
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string): { username: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
      exp?: number;
    };
    if (!data.sub || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { username: data.sub };
  } catch {
    return null;
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

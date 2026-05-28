/**
 * Lightweight session handling.
 *
 * A signed cookie carries an opaque user id. If no valid cookie is present a
 * fresh anonymous identity is minted and returned for the response to set.
 * This provides real per-user isolation today and is the seam a real identity
 * provider (OAuth / Cloudflare Access) plugs into later — swap how `userId` is
 * established; the rest of the app keeps scoping by it.
 */
const COOKIE_NAME = "gpsid";

export interface Session {
  userId: string;
  /** Present when a new session was minted; the caller must set this header. */
  setCookie?: string;
}

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(userId: string, secret: string): Promise<string> {
  return `${userId}.${await hmacHex(secret, userId)}`;
}

async function verify(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = await hmacHex(secret, userId);
  return timingSafeEqual(mac, expected) ? userId : null;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export async function resolveSession(request: Request, secret: string): Promise<Session> {
  const token = parseCookies(request.headers.get("Cookie"))[COOKIE_NAME];
  if (token) {
    const userId = await verify(token, secret);
    if (userId) return { userId };
  }
  const userId = crypto.randomUUID();
  const newToken = await sign(userId, secret);
  const setCookie = `${COOKIE_NAME}=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
  return { userId, setCookie };
}

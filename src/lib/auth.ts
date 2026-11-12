import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/db";

const COOKIE = "fleet_session";
const MAX_AGE_S = 60 * 60 * 8;

export type Session = { username: string; role: Role };

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  return s;
};

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export async function createSession(s: Session) {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + MAX_AGE_S * 1000 })).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof d.exp !== "number" || d.exp < Date.now()) return null;
    if (d.role !== "admin" && d.role !== "viewer") return null;
    return { username: String(d.username), role: d.role };
  } catch {
    return null;
  }
}

/** For pages: redirects to /login when not signed in. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** For server actions: throws unless signed in (and as admin when requested). */
export async function requireRole(role?: Role): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("Not authenticated");
  if (role === "admin" && s.role !== "admin") throw new Error("Admin role required");
  return s;
}

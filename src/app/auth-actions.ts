"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { authConn } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "Enter a username and password." };

  const [u] = await authConn().db.select().from(users).where(eq(users.username, username)).limit(1);
  // Same message for unknown user and bad password.
  if (!u || !verifyPassword(password, u.passwordHash)) return { error: "Invalid username or password." };

  await createSession({ username: u.username, role: u.role });
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

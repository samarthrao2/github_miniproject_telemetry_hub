"use client";

import { useActionState } from "react";
import { login } from "@/app/auth-actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  const input = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <form action={action} className="space-y-3">
      <input name="username" placeholder="Username" autoComplete="username" className={input} />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" className={input} />
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { logout } from "./auth-actions";

export const metadata: Metadata = {
  title: "Fleet Telemetrics Hub",
  description: "IoT telemetry (MySQL) and semantic failure search (Qdrant)",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const link = "text-slate-600 hover:text-slate-900";
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <span className="font-semibold">Fleet Telemetrics Hub</span>
            {session && (
              <>
                <Link href="/" className={link}>Telemetry</Link>
                <Link href="/search" className={link}>Predictive Maintenance Search</Link>
                <Link href="/tickets" className={link}>Tickets</Link>
                <Link href="/analytics" className={link}>SQL Analytics</Link>
                <span className="ml-auto flex items-center gap-3 text-slate-500">
                  {session.username}
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">{session.role}</span>
                  <form action={logout}>
                    <button className="text-slate-700 underline">Log out</button>
                  </form>
                </span>
              </>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <LoginForm />
      <p className="text-xs text-slate-500">
        Two roles: <strong>admin</strong> can create, edit and delete tickets; <strong>viewer</strong> is read-only.
        Each role connects to MySQL with its own database account.
      </p>
    </div>
  );
}

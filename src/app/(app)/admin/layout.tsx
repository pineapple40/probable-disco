import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role.key !== "admin") redirect("/dashboard");

  return (
    <div className="space-y-4">
      <nav className="flex gap-4 border-b border-slate-800 pb-2 text-sm">
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>
        <Link href="/admin/feature-flags" className="hover:underline">
          Feature flags
        </Link>
        <Link href="/admin/audit" className="hover:underline">
          Audit log
        </Link>
      </nav>
      {children}
    </div>
  );
}

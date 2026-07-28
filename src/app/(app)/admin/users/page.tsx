"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getJson } from "@/lib/api-client";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  emailVerifiedAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => getJson<AdminUser[]>("/api/admin/users"),
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Failed to update user.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Verified</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id} className="border-t border-slate-800">
                  <td className="py-2">
                    {u.email}
                    {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                      <span className="ml-2 text-xs text-red-400">locked</span>
                    )}
                  </td>
                  <td className="py-2">{u.role}</td>
                  <td className="py-2">{u.isActive ? "active" : "disabled"}</td>
                  <td className="py-2">{u.emailVerifiedAt ? "yes" : "no"}</td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateUser.mutate({ id: u.id, patch: { isActive: !u.isActive } })}
                    >
                      {u.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-2"
                      onClick={() =>
                        updateUser.mutate({
                          id: u.id,
                          patch: { role: u.role === "admin" ? "trader" : "admin" },
                        })
                      }
                    >
                      Make {u.role === "admin" ? "trader" : "admin"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

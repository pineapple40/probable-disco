"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { getJson } from "@/lib/api-client";

interface AuditEvent {
  id: string;
  userEmail: string | null;
  category: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

const CATEGORIES = ["auth", "order", "strategy", "admin", "security", "data", "risk", "provider"];

export default function AuditLogPage() {
  const [category, setCategory] = React.useState("");
  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-audit", category],
    queryFn: () => getJson<AuditEvent[]>(`/api/admin/audit${category ? `?category=${category}` : ""}`),
    refetchInterval: 10000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
      </CardHeader>
      <CardContent>
        <Select className="mb-3 w-48" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>

        {isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : !events || events.length === 0 ? (
          <p className="text-sm text-slate-500">No audit events.</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900 text-left text-xs text-slate-400">
                <tr>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">User</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-800">
                    <td className="py-1.5 text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-1.5">{e.userEmail ?? "—"}</td>
                    <td className="py-1.5 text-xs text-slate-400">{e.category}</td>
                    <td className="py-1.5">{e.action}</td>
                    <td className="py-1.5 text-xs text-slate-400">
                      {e.targetType ? `${e.targetType}:${e.targetId?.slice(0, 8)}` : "—"}
                    </td>
                    <td className="py-1.5 text-xs text-slate-400">{e.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getJson } from "@/lib/api-client";

interface FeatureFlag {
  key: string;
  description: string | null;
  enabled: boolean;
}

export default function FeatureFlagsPage() {
  const queryClient = useQueryClient();
  const { data: flags, isLoading } = useQuery({
    queryKey: ["admin-feature-flags"],
    queryFn: () => getJson<FeatureFlag[]>("/api/admin/feature-flags"),
  });

  const toggle = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const res = await fetch(`/api/admin/feature-flags/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] }),
    onError: (err) => alert(err instanceof Error ? err.message : "Failed to update flag."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature flags</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-2">
            {flags?.map((f) => (
              <div key={f.key} className="flex items-center justify-between rounded-md bg-slate-800/50 p-3">
                <div>
                  <p className="text-sm font-medium">{f.key}</p>
                  <p className="text-xs text-slate-500">{f.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggle.mutate({ key: f.key, enabled: !f.enabled })}
                >
                  {f.enabled ? "Enabled" : "Disabled"}
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-amber-400">
          Live trading cannot be enabled from this page by design - it requires a separate secure
          server-side configuration change and acknowledgement flow that is not implemented in this
          release.
        </p>
      </CardContent>
    </Card>
  );
}

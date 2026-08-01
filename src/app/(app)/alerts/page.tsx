"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getJson, postJson } from "@/lib/api-client";

interface Alert {
  id: string;
  name: string;
  conditionType: string;
  symbol: string | null;
  config: { value: number };
  isActive: boolean;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
}

interface Notification {
  id: string;
  category: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => getJson<Alert[]>("/api/alerts"),
  });
  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getJson<Notification[]>("/api/notifications"),
    refetchInterval: 10000,
  });

  const [name, setName] = React.useState("");
  const [symbol, setSymbol] = React.useState("AAPL");
  const [conditionType, setConditionType] = React.useState("price_above");
  const [value, setValue] = React.useState("200");

  const createAlert = useMutation({
    mutationFn: () => postJson("/api/alerts", { name, symbol, conditionType, value: Number(value) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      setName("");
    },
  });

  const toggleAlert = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update alert.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const deleteAlert = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => postJson(`/api/notifications/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Alerts &amp; notifications</h1>

      <Card>
        <CardHeader>
          <CardTitle>New alert</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Symbol</Label>
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label>Condition</Label>
              <Select value={conditionType} onChange={(e) => setConditionType(e.target.value)}>
                <option value="price_above">Price above</option>
                <option value="price_below">Price below</option>
                <option value="pct_change_above">% change above</option>
                <option value="pct_change_below">% change below</option>
                <option value="volume_above">Volume above</option>
              </Select>
            </div>
            <div>
              <Label>Value</Label>
              <Input value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          </div>
          <Button
            className="mt-3"
            disabled={!name || createAlert.isPending}
            onClick={() => createAlert.mutate()}
          >
            Create alert
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : !alerts || alerts.length === 0 ? (
            <p className="text-sm text-slate-500">No alerts configured.</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md bg-slate-800/50 p-2 text-sm">
                  <span>
                    {a.name} — {a.symbol} {a.conditionType} {a.config.value}
                    {a.lastTriggeredAt && (
                      <span className="ml-2 text-xs text-slate-500">
                        last triggered {new Date(a.lastTriggeredAt).toLocaleString()}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleAlert.mutate({ id: a.id, isActive: !a.isActive })}
                    >
                      {a.isActive ? "Disable" : "Enable"}
                    </Button>
                    <button
                      className="text-xs text-slate-500 hover:text-red-400"
                      onClick={() => deleteAlert.mutate(a.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          {!notifications || notifications.length === 0 ? (
            <p className="text-sm text-slate-500">No notifications yet.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-md p-2 text-sm ${n.readAt ? "bg-slate-800/30 text-slate-400" : "bg-slate-800/70"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      [{n.category}] {n.title}
                    </span>
                    {!n.readAt && (
                      <button
                        className="text-xs text-sky-400 hover:underline"
                        onClick={() => markRead.mutate(n.id)}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                  <p className="text-xs">{n.body}</p>
                  <p className="text-[11px] text-slate-500">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

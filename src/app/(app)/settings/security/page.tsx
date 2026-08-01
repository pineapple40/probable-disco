"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson, ApiError } from "@/lib/api-client";

export default function SecuritySettingsPage() {
  const [enrollment, setEnrollment] = React.useState<{ secret: string; qrDataUrl: string } | null>(
    null,
  );
  const [code, setCode] = React.useState("");
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function startEnrollment() {
    setError(null);
    try {
      const data = await postJson<{ secret: string; otpauthUrl: string; qrDataUrl: string }>(
        "/api/auth/mfa/enroll",
        {},
      );
      setEnrollment(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start MFA enrollment.");
    }
  }

  async function confirmEnrollment() {
    setError(null);
    try {
      const data = await postJson<{ enabled: boolean; recoveryCodes: string[] }>(
        "/api/auth/mfa/confirm",
        { code },
      );
      setRecoveryCodes(data.recoveryCodes);
      setEnrollment(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invalid code.");
    }
  }

  async function disable() {
    await postJson("/api/auth/mfa/disable", {});
    setRecoveryCodes(null);
    setEnrollment(null);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Security settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Multi-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {recoveryCodes ? (
            <div>
              <p className="text-sm text-green-400">MFA is now enabled. Save these recovery codes:</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-slate-800 p-3 font-mono text-xs">
                {recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : enrollment ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrollment.qrDataUrl} alt="MFA QR code" className="h-40 w-40" />
              <p className="text-xs text-slate-400">
                Manual entry key: <code>{enrollment.secret}</code>
              </p>
              <div>
                <Label htmlFor="code">Enter the 6-digit code from your authenticator app</Label>
                <Input id="code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <Button onClick={confirmEnrollment}>Confirm and enable</Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button onClick={startEnrollment}>Enable MFA</Button>
              <Button variant="outline" onClick={disable}>
                Disable MFA
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson, ApiError } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("demo@probable-disco.local");
  const [password, setPassword] = React.useState("");
  const [mfaCode, setMfaCode] = React.useState("");
  const [needsMfa, setNeedsMfa] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await postJson("/api/auth/login", {
        email,
        password,
        mfaCode: needsMfa && mfaCode ? mfaCode : undefined,
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "mfa_required") {
          setNeedsMfa(true);
          setError("Enter your 6-digit authenticator code to continue.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {needsMfa && (
            <div>
              <Label htmlFor="mfaCode">Authenticator code</Label>
              <Input
                id="mfaCode"
                inputMode="numeric"
                maxLength={6}
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-400">
          No account?{" "}
          <Link href="/register" className="text-sky-400 hover:underline">
            Register
          </Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <Link href="/forgot-password" className="text-sky-400 hover:underline">
            Forgot password?
          </Link>
        </p>
        <p className="mt-4 rounded-md bg-slate-800/60 p-3 text-xs text-slate-400">
          Demo login: <code>demo@probable-disco.local</code> / <code>Demo!Trader123</code>
        </p>
      </CardContent>
    </Card>
  );
}

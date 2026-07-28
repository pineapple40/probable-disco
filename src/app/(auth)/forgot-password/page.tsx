"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson } from "@/lib/api-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await postJson("/api/auth/request-password-reset", { email });
    } finally {
      setLoading(false);
      setDone(true);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
      </CardHeader>
      <CardContent>
        {done ? (
          <p className="text-sm text-slate-300">
            If an account exists for <strong>{email}</strong>, a reset link has been sent. In local
            development, check the server logs for the &quot;[DEV EMAIL]&quot; entry.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </Button>
          </form>
        )}
        <Link href="/login" className="mt-4 inline-block text-sm text-sky-400 hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}

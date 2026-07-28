"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson, ApiError } from "@/lib/api-client";

function VerifyEmailStatus() {
  const params = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = React.useState<"pending" | "success" | "error">(
    token ? "pending" : "error",
  );
  const [message, setMessage] = React.useState(token ? "" : "Missing verification token.");

  React.useEffect(() => {
    if (!token) return;
    postJson("/api/auth/verify-email", { token })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Verification failed.");
      });
  }, [token]);

  return (
    <>
      {status === "pending" && <p className="text-sm text-slate-300">Verifying...</p>}
      {status === "success" && (
        <p className="text-sm text-green-400">Your email has been verified. You can now sign in.</p>
      )}
      {status === "error" && <p className="text-sm text-red-400">{message}</p>}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email verification</CardTitle>
      </CardHeader>
      <CardContent>
        <React.Suspense fallback={<p className="text-sm text-slate-400">Loading...</p>}>
          <VerifyEmailStatus />
        </React.Suspense>
        <Link href="/login" className="mt-4 inline-block text-sm text-sky-400 hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}

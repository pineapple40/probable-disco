import { jsonOk } from "@/server/http/respond";

/** Liveness check: process is up and serving requests. No external dependencies checked. */
export async function GET() {
  return jsonOk({ status: "ok", service: "probable-disco", timestamp: new Date().toISOString() });
}

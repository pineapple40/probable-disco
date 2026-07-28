import { getCurrentUser } from "@/server/auth/session";
import { jsonOk } from "@/server/http/respond";

export async function GET() {
  const user = await getCurrentUser();
  return jsonOk({ user });
}

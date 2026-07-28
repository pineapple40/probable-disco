import { getCurrentUser, type AuthenticatedUser } from "@/server/auth/session";

export async function requireAdminUser(): Promise<AuthenticatedUser | null> {
  const user = await getCurrentUser();
  if (!user || user.role.key !== "admin") return null;
  return user;
}

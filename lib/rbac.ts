import type { Session } from "next-auth";
import { Role } from "@prisma/client";

export function requireRole(session: Session | null, allowedRoles: Role[]): void {
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  if (!allowedRoles.includes(session.user.role as Role)) {
    throw new Error("FORBIDDEN");
  }
}
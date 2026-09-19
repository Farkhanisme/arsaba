import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();

  try {
    requireRole(session, ["ADMIN"]);
    return NextResponse.json({ ok: true, message: "Admin access granted" });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "UNAUTHORIZED") {
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
      }
      if (err.message === "FORBIDDEN") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
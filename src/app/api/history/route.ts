import { NextRequest, NextResponse } from "next/server";
import { getRecentTurns } from "@/lib/server/memory";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const session_id = url.searchParams.get("session_id") || "";
  const persona = (url.searchParams.get("persona") || "saint-paul").toLowerCase();
  const mode = (url.searchParams.get("mode") || "friend").toLowerCase();

  if (!session_id) return NextResponse.json({ recent: [] });

  const recent = await getRecentTurns(persona, mode, session_id);
  return NextResponse.json({ recent });
}

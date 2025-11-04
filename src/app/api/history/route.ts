// C:\Users\singh\OneDrive\Desktop\farAlpha\Frentor-AI-nextjs-hybird\Frentor-Ai\src\app\api\history\route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionHistory, getProfileMemory, setProfileMemory } from "@/lib/server/memory";

/**
 * GET /api/history?sessionId=... -> { recent: ChatTurn[] }
 * GET /api/history?profile=true  -> profile object
 *
 * POST /api/history?profile=true -> save profile
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    if (searchParams.get("profile")) {
      const stored = await getProfileMemory();
      const fallback = {
        id: "demo-user",
        name: "Rahul Singh",
        age_range: "25–34",
        country: "India",
        denom_pref: "Evangelical",
        goals: ["Understand purpose of life", "Grow in gratitude"],
      };
      return NextResponse.json(stored || fallback);
    }

    const sessionId = searchParams.get("sessionId");
    if (!sessionId) return new NextResponse("Missing sessionId", { status: 400 });

    const recent = await getSessionHistory(sessionId);
    return NextResponse.json({ recent });
  } catch (e: any) {
    console.error("History GET error:", e);
    return new NextResponse(e?.message || "History route error", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    if (!searchParams.get("profile")) {
      return new NextResponse("Not allowed", { status: 405 });
    }
    const body = await req.json();
    await setProfileMemory(body);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("History POST error:", e);
    return new NextResponse(e?.message || "History save error", { status: 500 });
  }
}

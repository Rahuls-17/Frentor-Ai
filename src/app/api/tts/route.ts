// src/app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/tts
 * JSON body: { text: string, voiceId?: string, model_id?: string }
 * returns: { audioUrl: string }
 *
 * Updated for ElevenLabs current TTS endpoint (v1/text-to-speech/{voice_id})
 * - Accepts plain text and returns base64 data URL (audio/mpeg)
 * - If ELEVENLABS_VOICE_ID not set, you must send voiceId in body
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return new NextResponse("Missing ELEVENLABS_API_KEY", { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const text: string = (body?.text ?? "").toString().trim();
    const voiceId: string =
      (body?.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "").toString().trim();
    const modelId: string = (body?.model_id ?? "eleven_turbo_v2").toString();

    if (!text) {
      return new NextResponse("Missing text", { status: 400 });
    }
    if (!voiceId) {
      return new NextResponse(
        "Missing voiceId (pass in body.voiceId or set ELEVENLABS_VOICE_ID)",
        { status: 400 }
      );
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}`;

    // Call ElevenLabs TTS
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId, // recommended model for speed & cost
      }),
      cache: "no-store",
    });

    if (!r.ok) {
      let detail = "";
      try {
        const j = await r.json();
        detail =
          j?.detail || j?.error || JSON.stringify(j).slice(0, 500) || "";
      } catch {
        detail = await r.text();
      }
      return NextResponse.json(
        {
          audioUrl: "",
          error: `TTS upstream ${r.status}: ${
            detail || r.statusText || "error"
          }`,
        },
        { status: r.status === 200 ? 502 : r.status }
      );
    }

    // Convert binary audio -> base64 data URL for direct playback
    const buf = Buffer.from(await r.arrayBuffer());
    const b64 = buf.toString("base64");
    const audioUrl = `data:audio/mpeg;base64,${b64}`;

    return NextResponse.json({ audioUrl });
  } catch (e: any) {
    return new NextResponse(e?.message || "TTS server error", { status: 500 });
  }
}

// src/app/api/stt/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/stt
 * multipart/form-data: file=<audio blob>  (also accepts 'audio')
 * returns: { text: string }
 *
 * Updated for ElevenLabs Scribe STT (model_id=scribe_v1)
 * Notes:
 * - Accepts .webm, .wav, or .mp3 input.
 * - Must be playable audio (16-bit PCM or MP3).
 * - Surfaces upstream ElevenLabs errors clearly.
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return new NextResponse("Missing ELEVENLABS_API_KEY", { status: 500 });
    }

    // Expect multipart/form-data
    const form = await req.formData();
    const file = (form.get("file") as File) || (form.get("audio") as File);
    if (!file) {
      return new NextResponse("Missing file", { status: 400 });
    }

    // Build new FormData for ElevenLabs (don't set Content-Type manually)
    const elForm = new FormData();
    elForm.set("file", file, (file as any).name || "audio.webm");

    // Model + optional language/task
    elForm.set("model_id", "scribe_v1");
    elForm.set("language_code", "en");
    elForm.set("task", "transcribe");

    // ✅ Current working STT endpoint (for scribe_v1)
    const url = "https://api.elevenlabs.io/v1/speech-to-text";
    const r = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: elForm,
    });

    const bodyText = await r.text();

    if (!r.ok) {
      // Pass through upstream detail for debugging
      return NextResponse.json(
        {
          text: "",
          error: `Upstream ${r.status}: ${
            bodyText?.slice(0, 500) || r.statusText
          }`,
        },
        { status: 502 }
      );
    }

    // Parse ElevenLabs JSON
    let json: any = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      return NextResponse.json(
        {
          text: "",
          error: `Unexpected STT response: ${bodyText.slice(0, 200)}`,
        },
        { status: 502 }
      );
    }

    const text =
      json?.text ??
      json?.transcript ??
      json?.data?.transcript ??
      "";

    return NextResponse.json({ text });
  } catch (e: any) {
    return new NextResponse(e?.message || "STT server error", { status: 500 });
  }
}

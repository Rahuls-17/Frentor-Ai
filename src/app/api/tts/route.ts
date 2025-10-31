export const runtime = "nodejs";

import { NextRequest } from "next/server";

/**
 * POST /api/tts
 * Body: { text: string, voiceId?: string }
 * Calls the non-stream ElevenLabs endpoint and returns a full MP3 buffer.
 * This avoids the occasional "first few words" skip that can happen with streaming playback.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return new Response("Missing ELEVENLABS_API_KEY", { status: 500 });

  let bodyJson: any;
  try { bodyJson = await req.json(); } catch { bodyJson = {}; }
  const { text, voiceId } = bodyJson as { text?: string; voiceId?: string };
  if (!text || typeof text !== "string") return new Response("Missing text", { status: 400 });

  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const ttsModel = process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2";

  // Non-stream endpoint returns a complete MP3 file
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;

  const payload = JSON.stringify({
    text,
    model_id: ttsModel,
    // Optional voice tuning:
    // voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    // Optional: explicit output format (defaults are fine, but you can uncomment):
    // output_format: "mp3_44100_128",
  });

  const upstreamRes = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: payload,
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    const errText = await upstreamRes.text().catch(() => "");
    return new Response(`TTS upstream error: ${errText}`, { status: 502 });
  }

  // Return full MP3 buffer (not chunked)
  const arrayBuf = await upstreamRes.arrayBuffer();
  return new Response(arrayBuf, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
      "content-length": String(arrayBuf.byteLength),
    },
  });
}

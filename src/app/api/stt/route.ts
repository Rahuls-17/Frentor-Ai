export const runtime = "nodejs";

import { NextRequest } from "next/server";

/**
 * POST /api/stt
 * Accepts audio/webm or audio/wav in the request body (or multipart with field "file").
 * Calls ElevenLabs STT and returns { text }.
 * Forces transcription in English only (no auto language detection).
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const sttModel = process.env.ELEVENLABS_STT_MODEL || "scribe_v1";
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing ELEVENLABS_API_KEY" }), { status: 500 });
  }

  // Support both raw audio body and multipart/form-data
  let fileBlob: Blob | null = null;
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const f = formData.get("file");
    if (f instanceof Blob) fileBlob = f;
  } else {
    // Treat body as raw audio (webm/wav)
    const arrayBuffer = await req.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: "No audio provided" }), { status: 400 });
    }
    const type = contentType.includes("wav") ? "audio/wav" : "audio/webm";
    fileBlob = new Blob([arrayBuffer], { type });
  }

  if (!fileBlob) {
    return new Response(JSON.stringify({ error: "No audio file found in request" }), { status: 400 });
  }

  // Build ElevenLabs request
  const fd = new FormData();
  fd.append("file", fileBlob, "audio" + (fileBlob.type.includes("wav") ? ".wav" : ".webm"));
  fd.append("model_id", sttModel);

  // 🧠 Force English transcription
  // These keys hint ElevenLabs STT to transcribe in English only
  fd.append("language_code", "en");
  fd.append("language", "en");
  fd.append("task", "transcribe"); // avoid "translate" mode

  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: fd,
  });

  if (!r.ok) {
    const text = await r.text();
    return new Response(JSON.stringify({ error: "STT failed", details: text }), { status: 502 });
  }

  const data = await r.json();
  const text = (data?.text || data?.transcript || "").toString();

  return new Response(JSON.stringify({ text }), {
    headers: { "content-type": "application/json" },
  });
}

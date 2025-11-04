export const runtime = "nodejs";

import { NextRequest } from "next/server";

/**
 * POST /api/chat
 * body: {
 *   sessionId: string;
 *   text: string;
 *   figure: "paul";
 *   mode: "friend" | "mentor" | "study";
 *   answerMode: "human_pov" | "biblical";
 *   autospeak: boolean;
 *   study?: { ref?: string; type?: "sermon" | "qna" }
 * }
 * returns: { reply: string; audioUrl?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      sessionId,
      text,
      figure,
      mode,
      answerMode,
      autospeak,
      study,
    } = body as {
      sessionId?: string;
      text?: string;
      figure?: string;
      mode?: "friend" | "mentor" | "study";
      answerMode?: "human_pov" | "biblical";
      autospeak?: boolean;
      study?: { ref?: string; type?: "sermon" | "qna" };
    };

    if (!sessionId || typeof sessionId !== "string") {
      return new Response("Missing sessionId", { status: 400 });
    }
    const userText = (text || "").trim();
    if (!userText) {
      return new Response("Missing text", { status: 400 });
    }

    // --- 1) Build your prompt & call your chat model (placeholder) ---
    // You already have the logic wired in your project to produce `reply`.
    // Keep your existing GPT call here; we just simulate a reply for clarity.
    // ----------------------------------------------------------------
    const reply = await generateReply({
      sessionId,
      userText,
      figure: figure || "paul",
      mode: mode || "friend",
      answerMode: answerMode || "human_pov",
      study,
    });

    // --- 2) Try to pre-generate TTS so UI can autoplay ---
    // We call our own /api/tts (non-stream) and return a data:audio/mpeg URL.
    let audioUrl: string | undefined;
    if (autospeak) {
      try {
        // Build an absolute base URL from incoming request
        const origin =
          process.env.NEXT_PUBLIC_BASE_URL ||
          `${req.nextUrl.protocol}//${req.headers.get("host")}`;

        const ttsRes = await fetch(`${origin}/api/tts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: reply }),
        });

        if (!ttsRes.ok) {
          const errTxt = await ttsRes.text().catch(() => "");
          console.warn(`[chat] /api/tts failed ${ttsRes.status}: ${errTxt}`);
        } else {
          const buf = await ttsRes.arrayBuffer();
          const b64 = Buffer.from(buf).toString("base64");
          audioUrl = `data:audio/mpeg;base64,${b64}`;
          console.log(`[chat] TTS generated (${(buf.byteLength / 1024).toFixed(1)} KB)`);
        }
      } catch (e: any) {
        console.warn("[chat] TTS error:", e?.message || e);
      }
    }

    return new Response(JSON.stringify({ reply, audioUrl }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(e?.message || "Server error", { status: 500 });
  }
}

/** Replace this with your existing GPT call */
async function generateReply(args: {
  sessionId: string;
  userText: string;
  figure: string;
  mode: "friend" | "mentor" | "study";
  answerMode: "human_pov" | "biblical";
  study?: { ref?: string; type?: "sermon" | "qna" };
}) {
  // TODO: call your real OpenAI logic; keeping a short echo for now.
  return `You said: ${args.userText}`;
}

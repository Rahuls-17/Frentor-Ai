//"src\app\api\chat\route.ts"
import { NextRequest, NextResponse } from "next/server";
import { ensureIndex } from "@/lib/server/pinecone";
import { CHAT_MODEL, EMBED_DIM, openai } from "@/lib/server/openai";
import { pushTurn, getRecentTurns, getState, setState, queryFacts, upsertFacts } from "@/lib/server/memory";
import { buildSystemPrompt, buildStagePlan } from "@/lib/server/prompt";

type ChatIn = { session_id: string; message: string; persona?: string; mode?: "friend"|"mentor" };

function needsClarifyFirst(text: string, newTopic: boolean, lastAiShape?: string) {
  const t = (text || "").trim().toLowerCase();

  // If we just clarified, do NOT clarify again — proceed to advice.
  if (lastAiShape === "clarify") return false;

  // New topic: start with clarify
  if (newTopic) return true;

  // Very short messages can be vague, but don't loop forever
  if (t.length < 18) return false;

  const vague = [
    "i don't know","not sure","feel bad","i feel","i'm not feeling","im not feeling",
    "dont think","don't think","i am sad","i'm sad","angry at god","god isn't listening","god is not listening"
  ];
  return vague.some(v => t.includes(v));
}


function enforceOneQuestion(reply: string, clarifyOnly: boolean) {
  if (!reply || !reply.includes("?")) return reply;
  const parts = reply.split("?");
  const chunks = parts.map((p)=>p.trim()).filter(Boolean);
  if (clarifyOnly) {
    const first = chunks.shift();
    const statements = chunks.map(c=>c+".");
    return tidyText([ (first? first + "?" : ""), ...statements ].join(" "));
  }
  // full turn: last question at end
  const last = chunks.pop();
  const statements = chunks.map(c=>c+".");
  const q = last ? last + "?" : "";
  return tidyText([ ...statements, q ].join(" "));
}

function tidyText(text: string) {
  return text.replace(/\s+/g," ").replace(/\?\./g,"?").replace(/\.\./g,".").trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatIn;
    const persona = (body.persona || process.env.DEFAULT_PERSONA || "saint-paul").toLowerCase();
    const mode = (body.mode || (process.env.DEFAULT_MODE as "friend"|"mentor") || "friend").toLowerCase() as "friend"|"mentor";

    await ensureIndex(EMBED_DIM);

    // persist user turn
    await pushTurn(persona, mode, body.session_id, "user", body.message);

    const recent = await getRecentTurns(persona, mode, body.session_id, 6);
    const state = await getState(persona, mode, body.session_id);

    const clarifyOnly = needsClarifyFirst(body.message, state.new_topic, state.last_ai_shape as string | undefined);

    // System prompt
    const system = buildSystemPrompt(persona, mode, { suppressAutoQuestion: clarifyOnly });

    if (clarifyOnly) {
      // Clarify-only: no RAG, no summary upsert
      const msgs = [
        { role: "system" as const, content: system },
        { role: "system" as const, content: buildStagePlan(persona, true) },
        ...recent,
        { role: "user" as const, content: body.message }
      ];
      const completion = await openai.chat.completions.create({ model: CHAT_MODEL, messages: msgs });
      let reply = completion.choices[0].message?.content || "";
      reply = enforceOneQuestion(reply, true);

      await pushTurn(persona, mode, body.session_id, "assistant", reply);
      await setState(persona, mode, body.session_id, "clarify", false);

      return NextResponse.json({ reply });
    }

    // Full turn: fetch concise facts (2 personal + 1 general)
    const personal = await queryFacts(persona, mode, body.session_id, body.message, 2, true, ["advice_fact","session_summary"]);
    const general  = await queryFacts(persona, mode, body.session_id, body.message, 1, false, ["advice_fact","session_summary"]);
    const hits = [...(personal||[]), ...(general||[])];

    const lines = hits
      .map(h => h?.metadata?.text ? `- ${h.metadata.text}` : "")
      .filter(Boolean)
      .join("\n")
      .slice(0, 600);

    const msgs = [
      { role: "system" as const, content: system },
      ...(lines ? [{ role: "system" as const, content: `(Long-term memory — concise facts)\n${lines}` }] : []),
      { role: "system" as const, content: buildStagePlan(persona, false) },
      ...recent,
      { role: "user" as const, content: body.message }
    ];

    const completion = await openai.chat.completions.create({ model: CHAT_MODEL, messages: msgs });
    let reply = completion.choices[0].message?.content || "";
    reply = enforceOneQuestion(reply, false);

    await pushTurn(persona, mode, body.session_id, "assistant", reply);
    await setState(persona, mode, body.session_id, "advise", false);

    // Summarize & store fact
    try {
      const sumSys =
        "You are a concise summarizer for a Christian mentoring assistant. Return exactly one short reusable fact (≤ ~25 words). If a verse is present, append (Book Chap:Verse). No quotes.";
      const sumMsgs = [
        { role: "system" as const, content: sumSys },
        { role: "user" as const, content: `Summarize this assistant reply into one reusable fact:\n\n${reply}` }
      ];
      const s = await openai.chat.completions.create({ model: CHAT_MODEL, messages: sumMsgs });
      const fact = (s.choices[0].message?.content || "").trim().slice(0, 300);
      if (fact) {
        await upsertFacts(persona, mode, body.session_id, [
          { id: `fact-${persona}-${mode}-${body.session_id}-${Date.now()}`, text: fact, metadata: { type: "advice_fact", source: "conversation" } }
        ]);
      }
    } catch {}

    return NextResponse.json({ reply });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}

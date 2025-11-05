// src/app/api/chat/route.ts
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { NextRequest } from "next/server";
import { redis } from "@/lib/server/redis";
import {
  getSessionHistory,
  pushTurn,
  fetchRelevantSummaries,
  upsertSummary,
  deleteSessionHistory,
  upsertRecap,
  upsertLearningJournal,
} from "@/lib/server/memory";

// Limits for contextualization
const MAX_TURNS = 12; // last N turns from Redis
const MAX_LTM = 3; // top-K Pinecone summaries
const SUMMARY_MESSAGE_COUNT = 10; // unchanged cadence

// Persona assets location (adjust if your repo differs)
const PERSONAS_DIR = path.resolve(process.cwd(), "src/personas/paul");

function loadYamlFile(filename: string): any {
  try {
    const p = path.join(PERSONAS_DIR, filename);
    if (!fs.existsSync(p)) return null;
    const content = fs.readFileSync(p, "utf8");
    return yaml.load(content);
  } catch {
    return null;
  }
}

function buildStageLine(stageYaml: any): string {
  if (!stageYaml) return "";
  const stages = (stageYaml as any)?.stages;
  if (Array.isArray(stages) && stages.length) {
    const items = stages.slice(0, 8).map((s: any, i: number) => {
      const name = typeof s?.id === "string" ? s.id : `stage_${i + 1}`;
      const purpose = typeof s?.purpose === "string" ? s.purpose : "";
      return `${i + 1}. ${name}${purpose ? ` — ${purpose}` : ""}`;
    });
    return `Follow this conversation flow naturally. Adapt if the user shifts topics, but preserve momentum and warmth.
When a stage mentions a "prompt", treat it as guidance for tone/intent, not text to echo verbatim.
${items.join("\n")}`;
  }
  const dumped = JSON.stringify(stageYaml);
  const compact = dumped.length > 1200 ? dumped.slice(0, 1197) + "…" : dumped;
  return `Conversation stages (schema-detected): ${compact}`;
}

function compilePersonaDescription(pYaml: any): string {
  if (!pYaml) return "warm, concise, pastoral";
  const core =
    typeof pYaml.core_identity === "string" ? pYaml.core_identity.trim() : "";
  const motive =
    typeof pYaml.motivation === "string" ? pYaml.motivation.trim() : "";
  const rules = Array.isArray(pYaml.rules)
    ? pYaml.rules.filter((r: any) => typeof r === "string").join(" ")
    : "";
  const sig = Array.isArray(pYaml.signature_phrases)
    ? `You may use phrases like: ${pYaml.signature_phrases
        .slice(0, 5)
        .join(" · ")}`
    : "";
  const parts = [core, motive, rules, sig].filter(Boolean);
  return parts.join("\n\n");
}

/** NEW: compact profile into a single safe line for context */
function compactProfile(p: any): string {
  if (!p || typeof p !== "object") return "";
  const safe = (v: any) =>
    typeof v === "string" ? v.trim().slice(0, 300) : "";
  const arr = (a: any) =>
    Array.isArray(a) ? a.map((s) => String(s ?? "").trim()).filter(Boolean) : [];

  const goals = arr(p.goals).slice(0, 5).join(" • ");
  const past = arr(p.pastActivities).slice(0, 3).join(" • ");

  const parts = [
    safe(p.name) ? `Name: ${safe(p.name)}` : "",
    safe(p.age) ? `Age: ${safe(p.age)}` : "",
    safe(p.country) ? `Country: ${safe(p.country)}` : "",
    safe(p.journaling) ? `Journaling: ${safe(p.journaling)}` : "",
    goals ? `Goals: ${goals}` : "",
    past ? `Past activities: ${past}` : "",
  ].filter(Boolean);

  // keep overall profile line bounded
  return parts.join(" | ").slice(0, 800);
}

/** NEW: extract a preferred name for greeting */
function getPreferredName(profile: any): string {
  const n = typeof profile?.name === "string" ? profile.name.trim() : "";
  return n ? n.slice(0, 60) : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ---- Recap action (explicit) ----
    if (body?.action === "recap") {
      const sessionId: string = body?.sessionId;
      const recapMode: "friend" | "mentor" | "study" =
        body?.mode === "mentor" || body?.mode === "study" ? body.mode : "friend";

      if (!sessionId || typeof sessionId !== "string") {
        return new Response("Missing sessionId", { status: 400 });
      }

      const turns = await getSessionHistory(sessionId);
      const rawText = turns
        .map((t: any) => {
          const who =
            t.role === "user"
              ? "User"
              : t.role === "assistant"
              ? "Assistant"
              : "System";
          const content =
            typeof t.content === "string" ? t.content : JSON.stringify(t.content);
          return `${who}: ${content}`;
        })
        .join("\n");

      const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
      if (!OPENAI_API_KEY)
        return new Response("Missing OPENAI_API_KEY", { status: 500 });
      const model = process.env.OPENAI_MODEL || "gpt-5";

      const modeDirectives: Record<string, string> = {
        friend:
          "Summarize the conversation you had with a compassionate friend: what you shared, how you felt, and any moments of relief or clarity. Avoid giving instructions.",
        mentor:
          "Summarize the mentorship you received: the guidance or options offered to you, the main principle emphasized, and (if present) a scripture reference in book+chapter form (e.g., Philippians 4).",
        study:
          "Summarize your study session: which passage(s) you focused on, 1–2 key insights you learned, and one question or curiosity you’re still holding.",
      };

      const summaryMessages = [
        {
          role: "system" as const,
          content: [
            "Write a recap in SECOND PERSON (use 'you'/'your'). Do NOT use 'User' or 'Assistant'.",
            "Output 4–6 compact lines. No headings, no quotes, no bullet symbols, no imperative instructions.",
            modeDirectives[recapMode],
            "Keep the tone warm and non-judgmental. Be concise and concrete.",
          ].join(" "),
        },
        {
          role: "user" as const,
          content:
            `Here is the full dialog transcript:\n\n${rawText}\n\n` +
            `Write the recap now in second person as per the instructions.`,
        },
      ];

      const summaryRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages: summaryMessages }),
      });

      if (!summaryRes.ok) {
        const errTxt = await summaryRes.text().catch(() => "");
        return new Response(
          JSON.stringify({
            recap: "",
            error: `OpenAI ${summaryRes.status}: ${errTxt || summaryRes.statusText}`,
          }),
          { status: 502, headers: { "content-type": "application/json" } }
        );
      }

      const summaryJson: any = await summaryRes.json().catch(() => ({}));
      const recapText: string =
        summaryJson?.choices?.[0]?.message?.content?.trim() || "No recap available.";

      await upsertRecap(sessionId, recapText);
      await deleteSessionHistory(sessionId);

      return new Response(JSON.stringify({ recap: recapText }), {
        headers: { "content-type": "application/json" },
      });
    }

    // ---- Journal action (user reflection after recap) ----
    if (body?.action === "journal") {
      const sessionId: string = body?.sessionId;
      const text: string = body?.text;
      const mode: string = body?.mode || "friend";
      const studyRef: string | undefined = body?.studyRef;
      if (!sessionId || !text) {
        return new Response("Missing sessionId or text", { status: 400 });
      }
      await upsertLearningJournal({ sessionId, text, mode, studyRef });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    // ---- Normal chat path (unchanged except: study stage loading + greet hint) ----
    const {
      sessionId,
      text,
      figure = "paul",
      mode = "friend", // "friend" | "mentor" | "study"
      answerMode = "human_pov", // "human_pov" | "biblical"
      study, // optional { ref, type }
      profile, // client-provided profile (from localStorage)
    } = body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return new Response("Missing sessionId", { status: 400 });
    }
    const userText = (text || "").trim();
    if (!userText) {
      return new Response("Missing text", { status: 400 });
    }

    const personaYaml = loadYamlFile("persona.yaml");
    const modeYaml = loadYamlFile(`mode.${mode}.yaml`);
    const stageYaml =
      mode === "friend" || mode === "mentor"
        ? loadYamlFile("stages.yaml")
        : mode === "study"
        ? loadYamlFile("study.yaml")
        : null;

    const personaName =
      (personaYaml && (personaYaml as any).name) || "Saint Paul";
    const personaDescription = compilePersonaDescription(personaYaml);

    const modeDescription =
      (modeYaml && (modeYaml as any).description) || mode.toUpperCase();

    const answerPerspective =
      answerMode === "biblical"
        ? "Biblical (quote/paraphrase Scripture appropriately)"
        : "Human POV (pastoral guidance)";

    const personaBudget =
      typeof (personaYaml as any)?.style?.length_tokens === "number" &&
      ((personaYaml as any)?.style?.length_tokens as number) > 0
        ? ((personaYaml as any)!.style!.length_tokens as number)
        : 160;

    const lengthBudget =
      mode === "study"
        ? Math.round(personaBudget * 2.2)
        : mode === "mentor"
        ? 120
        : 110;

    const personaSystem = `You are "${personaName}"—${personaDescription}.
- Persona: ${figure}
- Mode: ${modeDescription}
- Answer perspective: ${answerPerspective}
- Keep replies brief (2–4 short sentences). Avoid long paragraphs.`;

    const brevityPolicy = [
      `Answer-Length Budget: ~${lengthBudget} tokens.`,
      mode === "study"
        ? `In STUDY mode you may exceed the budget briefly for necessary quotations or exegesis.`
        : `In ${mode.toUpperCase()} mode, write conversationally in short lines; avoid bullet lists.`,
    ].join(" ");

    const selfCheck =
      "Before finalizing, quickly self-check: keep it short, clear, and human. If unclear, ask ONE short question. If clear, stop clarifying and respond briefly.";

    const stageLine = buildStageLine(stageYaml);

    const fullHistory = await getSessionHistory(sessionId);
    const recent = Array.isArray(fullHistory) ? fullHistory.slice(-MAX_TURNS) : [];

    const historyMsgs: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = recent
      .map((t: any) => {
        const role =
          t?.role === "user" ||
          t?.role === "assistant" ||
          t?.role === "system"
            ? t.role
            : "user";
        const content =
          typeof t?.content === "string"
            ? t.content
            : JSON.stringify(t?.content ?? "");
        return { role, content };
      })
      .filter((m) => m.content && m.content.trim().length > 0);

    const hasAssistantBefore = recent.some((t: any) => t?.role === "assistant");
    const greetPolicy = hasAssistantBefore
      ? "Do NOT repeat any greeting like 'Grace and peace to you.' since this is not the first assistant reply in this session."
      : "This is the first assistant reply in the session; you may greet briefly once.";

    const modeToneHint =
      mode === "friend"
        ? "Voice/Tone: modern American conversational English; very short, human sentences; empathy first; no directives."
        : mode === "mentor"
        ? "Voice/Tone: warm mentor; gentle teacher; weave scripture conversationally (reference letters rather than quoting at length); keep it succinct."
        : mode === "study"
        ? "Voice/Tone: calm, text-centered, concise; clarify intent, provide compact context, invite one observation; avoid long quotations."
        : "";

    const phaseHint =
      mode === "friend"
        ? "FRIEND PHASE: If unclear, you may ask ONE short question; otherwise reflect briefly. Share lived experience ONLY after clarity."
        : mode === "mentor"
        ? "MENTOR PHASE: Offer one brief, invitational suggestion when clear; if unclear, ask ONE clarifying question. Share lived experience ONLY after clarity."
        : mode === "study"
        ? "STUDY PHASE: Clarify study intent (passage/theme); provide 1–2 short context lines; invite ONE observation; application only if asked."
        : "";

    // NEW: Build a compact profile line and a friendly greeting directive using the name
    const profileLine = compactProfile(profile);
    const preferredName = getPreferredName(profile);
    const userIntroLine = preferredName
      ? `You are conversing with ${preferredName}. When you greet them, you may say, “Grace and peace to you, ${preferredName}.” Address them by name warmly when appropriate.`
      : "You are conversing with the user. You may greet them warmly (e.g., “Grace and peace to you”).";

    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [
      ...(modeToneHint ? [{ role: "system" as const, content: modeToneHint }] : []),
      ...(phaseHint ? [{ role: "system" as const, content: phaseHint }] : []),
      { role: "system" as const, content: greetPolicy },
      { role: "system" as const, content: personaSystem },
      { role: "system" as const, content: userIntroLine },
      ...(profileLine
        ? [
            {
              role: "system" as const,
              content:
                `User details for context: ${profileLine}. Use this to make responses personal and connected.`,
            },
          ]
        : []),
      { role: "system" as const, content: brevityPolicy },
      { role: "system" as const, content: selfCheck },
      ...(stageLine ? [{ role: "system" as const, content: stageLine }] : []),
      ...((await fetchRelevantSummaries(sessionId, userText, MAX_LTM)) || []).map(
        (s: string, i: number) => ({
          role: "system" as const,
          content: `Long-term memory ${i + 1}: ${s}`,
        })
      ),
      ...historyMsgs,
      { role: "user" as const, content: userText },
    ];

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    if (!OPENAI_API_KEY)
      return new Response("Missing OPENAI_API_KEY", { status: 500 });
    const model = process.env.OPENAI_MODEL || "gpt-5";

    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
    });

    if (!oaiRes.ok) {
      const errTxt = await oaiRes.text().catch(() => "");
      return new Response(
        JSON.stringify({
          reply: "",
          error: `OpenAI ${oaiRes.status}: ${errTxt || oaiRes.statusText}`,
        }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    const oaiJson: any = await oaiRes.json().catch(() => ({}));
    const reply: string =
      oaiJson?.choices?.[0]?.message?.content?.trim() || "(no reply)";

    await pushTurn(sessionId, { role: "user", content: userText });
    await pushTurn(sessionId, { role: "assistant", content: reply });

    const lastActiveKey = `session:${sessionId}:lastActive`;
    await redis.set(lastActiveKey, Date.now().toString());
    await redis.expire(lastActiveKey, 60 * 60 * 24 * 7);

    const turns = await getSessionHistory(sessionId);
    if (Array.isArray(turns) && turns.length % SUMMARY_MESSAGE_COUNT === 0) {
      const rawText = turns
        .map((t: any) => {
          const who =
            t.role === "user"
              ? "User"
              : t.role === "assistant"
              ? "Assistant"
              : "System";
          const content =
            typeof t.content === "string"
              ? t.content
              : JSON.stringify(t.content);
          return `${who}: ${content}`;
        })
        .join("\n");

      const summaryMessages = [
        {
          role: "system" as const,
          content: "You are a helpful assistant that summarizes conversations briefly.",
        },
        {
          role: "user" as const,
          content: `Summarize the following dialog in 4–6 bullets:\n\n${rawText}`,
        },
      ];

      const summaryRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages: summaryMessages }),
      });

      if (summaryRes.ok) {
        const summaryJson: any = await summaryRes.json().catch(() => ({}));
        const summaryText: string =
          summaryJson?.choices?.[0]?.message?.content?.trim() || "";
        if (summaryText) {
          await upsertSummary(sessionId, summaryText, "session-summary");
        }
      }
    }

    return new Response(JSON.stringify({ reply }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(e?.message || "Server error", { status: 500 });
  }
}

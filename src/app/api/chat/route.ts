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
  // Try common schema: { stages: [{ name, goal/description/brief }, ...] }
  const stages = (stageYaml as any)?.stages;
  if (Array.isArray(stages) && stages.length) {
    const items = stages.slice(0, 8).map((s: any, i: number) => {
      const name = typeof s?.name === "string" ? s.name : `Stage ${i + 1}`;
      const detail =
        (typeof s?.brief === "string" && s.brief) ||
        (typeof s?.description === "string" && s.description) ||
        (typeof s?.goal === "string" && s.goal) ||
        "";
      const compact = detail.length > 160 ? detail.slice(0, 157) + "…" : detail;
      return `${i + 1}. ${name}${compact ? ` — ${compact}` : ""}`;
    });
    return `Follow this conversation stage plan. If the user changes topics, adapt but try to keep momentum.\n${items.join(
      "\n"
    )}`;
  }
  // Fallback: include a compact JSON dump (capped) without blowing up the prompt
  const dumped = JSON.stringify(stageYaml);
  const compact = dumped.length > 1200 ? dumped.slice(0, 1197) + "…" : dumped;
  return `Conversation stages (schema-detected): ${compact}`;
}

/** ---- Small helpers for post-trim (Friend/Mentor only) ---- **/
function trimToBudget(text: string, maxWords: number) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const out: string[] = [];
  let count = 0;
  for (const s of sentences) {
    const words = s.trim().split(/\s+/).filter(Boolean);
    const w = words.length;
    if (w === 0) continue;
    if (count + w > maxWords) break;
    out.push(s.trim());
    count += w;
  }
  // If nothing fit (first sentence too long), hard trim first ~maxWords words
  if (out.length === 0) {
    const words = text.split(/\s+/).filter(Boolean).slice(0, maxWords);
    return words.join(" ");
  }
  return out.join(" ");
}

function ensureFollowUpQuestion(text: string) {
  if (/\?\s*$/.test(text)) return text;
  const suffix =
    (text.endsWith(".") || text.endsWith("…") || text.endsWith("!")) ? "" : ".";
  return `${text}${suffix} What’s one small next step you can take?`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      sessionId,
      text,
      figure = "paul",
      mode = "friend", // "friend" | "mentor" | "study"
      answerMode = "human_pov", // "human_pov" | "biblical"
      study, // optional { ref, type }
      profile, // left as-is
    } = body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return new Response("Missing sessionId", { status: 400 });
    }
    const userText = (text || "").trim();
    if (!userText) {
      return new Response("Missing text", { status: 400 });
    }

    // YAML persona/mode/stages — LOGIC PRESERVED
    // NOTE: stages.yaml is ONLY for friend & mentor (NOT for study)
    const personaYaml = loadYamlFile("persona.yaml");
    const modeYaml = loadYamlFile(`mode.${mode}.yaml`);
    const stageYaml =
      mode === "friend" || mode === "mentor" ? loadYamlFile("stages.yaml") : null;

    const personaName =
      (personaYaml && (personaYaml as any).name) || "Saint Paul";
    const personaDescription =
      (personaYaml && (personaYaml as any).description) ||
      "warm, concise, pastoral";

    const modeDescription =
      (modeYaml && (modeYaml as any).description) || mode.toUpperCase();

    const answerPerspective =
      answerMode === "biblical"
        ? "Biblical (quote/paraphrase Scripture appropriately)"
        : "Human POV (pastoral guidance)";

    // Length budget: use YAML base and scale for STUDY (no API-level max_tokens)
    const baseBudget =
      (personaYaml?.style?.length_tokens as number) || 140;
    const lengthBudget =
      mode === "study" ? Math.round(baseBudget * 2.2) : baseBudget;

    const personaSystem = `You are "${personaName}"—${personaDescription}.
- Persona: ${figure}
- Mode: ${modeDescription}
- Answer perspective: ${answerPerspective}
- Keep replies brief (4–7 sentences). End with ONE short follow-up question.`;

    const brevityPolicy = [
      `Answer-Length Budget: ~${lengthBudget} tokens.`,
      mode === "study"
        ? `In STUDY mode you may exceed the budget only for brief scripture quotations or necessary exegesis.`
        : `In ${mode.toUpperCase()} mode, keep replies tight and practical.`,
      `Prefer 1–3 short bullets for lists.`,
    ].join(" ");

    const selfCheck =
      "Before finalizing, quickly self-check: is the reply within the Answer-Length Budget and ending with ONE short follow-up question? If not, compress.";

    const stageLine = buildStageLine(stageYaml);

    // Optional study context string; stages.yaml is not used for study mode
    let studyLine = "";
    if (mode === "study" && study?.ref) {
      studyLine = `Study context: ${study.ref}${
        study?.type ? ` (${String(study.type).toUpperCase()})` : ""
      }.`;
    }

    // Profile summary line
    const prof = profile || {};
    const profSummary = [
      prof.name ? `Name: ${prof.name}` : "",
      prof.age ? `Age: ${prof.age}` : "",
      prof.country ? `Country: ${prof.country}` : "",
      prof.journaling ? `Journal: ${prof.journaling}` : "",
      Array.isArray(prof.goals) && prof.goals.length
        ? `Goals: ${prof.goals.join(", ")}`
        : "",
      Array.isArray(prof.pastActivities) && prof.pastActivities.length
        ? `Past: ${prof.pastActivities.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("  ·  ");

    const profileLine = profSummary
      ? `User profile summary → ${profSummary}`
      : "User profile summary → (none)";

    // Context: Redis recent turns + Pinecone LTM
    const fullHistory = await getSessionHistory(sessionId);
    const recent = Array.isArray(fullHistory) ? fullHistory.slice(-MAX_TURNS) : [];

    const historyMsgs: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = recent
      .map((t: any) => {
        const role =
          t?.role === "user" || t?.role === "assistant" || t?.role === "system"
            ? t.role
            : "user";
        const content =
          typeof t?.content === "string"
            ? t.content
            : JSON.stringify(t?.content ?? "");
        return { role, content };
      })
      .filter((m) => m.content && m.content.trim().length > 0);

    const ltm = await fetchRelevantSummaries(sessionId, userText, MAX_LTM);
    const ltmSystemLines: Array<{ role: "system"; content: string }> = (
      ltm || []
    ).map((s: string, i: number) => ({
      role: "system",
      content: `Long-term memory ${i + 1}: ${s}`,
    }));

    // Final message array
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [
      { role: "system" as const, content: personaSystem },
      { role: "system" as const, content: brevityPolicy },
      { role: "system" as const, content: selfCheck },
      { role: "system" as const, content: profileLine },
      ...(studyLine ? [{ role: "system" as const, content: studyLine }] : []),
      ...(stageLine ? [{ role: "system" as const, content: stageLine }] : []),
      ...ltmSystemLines,
      ...historyMsgs,
      { role: "user" as const, content: userText },
    ];

    // Call OpenAI
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
    let reply: string =
      oaiJson?.choices?.[0]?.message?.content?.trim() || "(no reply)";

    // ---- Server-side length enforcement for Friend/Mentor only ----
    if (mode !== "study") {
      const maxWords = Math.round(lengthBudget * 1.3);
      reply = trimToBudget(reply, maxWords);
      reply = ensureFollowUpQuestion(reply);
    }

    // Persist turns to Redis (removed `ts` to satisfy ChatTurn type)
    await pushTurn(sessionId, { role: "user", content: userText });
    await pushTurn(sessionId, { role: "assistant", content: reply });

    // Touch lastActive
    const lastActiveKey = `session:${sessionId}:lastActive`;
    await redis.set(lastActiveKey, Date.now().toString());
    await redis.expire(lastActiveKey, 60 * 60 * 24 * 7);

    // Rolling summary every N messages
    const turns = await getSessionHistory(sessionId);
    if (Array.isArray(turns) && turns.length % SUMMARY_MESSAGE_COUNT === 0) {
      const rawText = turns
        .map((t: any) =>
          `${t.role === "user"
            ? "User"
            : t.role === "assistant"
            ? "Assistant"
            : "System"}: ${
            typeof t.content === "string"
              ? t.content
              : JSON.stringify(t.content)
          }`
        )
        .join("\n");

      const summaryMessages = [
        {
          role: "system" as const,
          content:
            "You are a helpful assistant that summarizes conversations briefly.",
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

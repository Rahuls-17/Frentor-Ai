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
  fetchPastRecapsFromPinecone,
} from "@/lib/server/memory";

// Limits for contextualization
const MAX_TURNS = 12; // last N turns from Redis
const MAX_LTM = 10; // top-K Pinecone summaries
const SUMMARY_MESSAGE_COUNT = 10; // unchanged cadence

// how many past recaps to include in prompt (from Redis/Pinecone)
const MAX_PAST_RECAPS = 10;
const RECAPS_KEY = (sessionId: string) => `recaps:${sessionId}`;

// Persona assets location (kept as-is)
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

/** compact profile into a single safe line for context */
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

/** extract a preferred name for greeting */
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

      // Save recap to long-term store
      await upsertRecap(sessionId, recapText);

      // Also push recap to Redis list for easy retrieval in future prompts (by sessionId)
      try {
        await redis.lpush(RECAPS_KEY(sessionId), recapText);
        await redis.ltrim(RECAPS_KEY(sessionId), 0, MAX_PAST_RECAPS - 1);
      } catch {
        // best-effort only
      }

      // Clear the short-term history
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

    // ---- Normal chat path ----
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

    // ---------- PROMPT: system blocks ----------

    // QUESTION POLICY (one per reply; mentor clarifies across turns)
    const questionPolicy = "Ask at most ONE sincere question per reply (zero is fine once the user has shared). Clarify across turns if needed.";

    // Clear, modern, non-AI voice & differentiation across modes
    const personaSystem = `You are "${personaName}"—${personaDescription}.
- Persona: ${figure}
- Mode: ${modeDescription}
- Answer perspective: ${answerPerspective}
- Sound fully human and modern. Never say you are an AI. No boilerplate disclaimers. No bullet lists. No long paragraphs.
- Prefer 2–4 short sentences; go longer only if the user asks or nuance is essential.
- ${questionPolicy}`;

    // Brevity & mode movement
    const brevityPolicy = [
      `Target Length: ~${lengthBudget} tokens (flexible).`,
      `Reflect first (emotion or motive).`,
      mode === "friend"
        ? `FRIEND: Movement = connection only (empathy, shared "I" line, or one gentle question). Do NOT propose techniques or homework.`
        : mode === "mentor"
        ? `MENTOR: Clarify first with ONE concise question and stop. After the user answers, frame the issue briefly and offer one tiny, invitational next step.`
        : `STUDY: Focus and clarify.`,
    ].join(" ");

    // Tone hints
    const modeToneHint =
      mode === "friend"
        ? "FRIEND MODE: Focus on the person—their feelings, day, relationships, interests (off-topic is fine if it builds trust). Ask one personal, present-tense question when unclear. Avoid doctrine unless invited."
        : mode === "mentor"
        ? "MENTOR MODE: Real mentor presence—brief empathy, one wise probing question, then (after they answer) a small invitation grounded in principle."
        : mode === "study"
        ? "STUDY MODE: Clarify passage/theme; offer 1–2 short lines of context; invite ONE observation; cite by book/chapter; quote only on request."
        : "";

    // Phase hints
    const phaseHint =
      mode === "friend"
        ? "After asking (if needed), mirror what you heard and strengthen connection. Most turns should not include any personal story—use lived experience rarely, only if empathy alone would feel too distant. Presence and listening matter more than sharing your past. You may end without a question."
        : mode === "mentor"
        ? "Clarify first with ONE concise scope/motive question and stop. After they answer, frame the issue in one short line, then offer one tiny, invitational step or two soft options max; keep agency with the user."
        : mode === "study"
        ? "Confirm focus, give compact context, invite one observation. Application only if asked."
        : "";

    // Anti-generic AI
    const antiGenericVoice = [
      "Do not explain your capabilities or limitations.",
      "Do not output outlines or lists; use short, human sentences.",
      "Avoid repeating the same opener or signature phrase in adjacent replies.",
      "If your previous turn ended with a question and the user did not directly answer it, DO NOT ask another question now—reflect briefly and move forward.",
    ].join(" ");

    // Attribution / citation policy (scriptural only)
    const attributionPolicy = [
      "ATTRIBUTION POLICY:",
      "- When you invoke a recognizably Pauline idea, include ONE brief parenthetical citation per idea cluster (e.g., “(Romans 8)”).",
      "- FRIEND: generally avoid citations unless you clearly refer to a verse or the user asks.",
      "- MENTOR: usually include 0–1 brief citation when grounding a principle.",
      "- STUDY: cite by book/chapter; quote only on request (“show me the passage”).",
      "COMMON THEMES → CITATIONS:",
      "• Suffering & hope → (Romans 8; 2 Corinthians 1)",
      "• Strength in weakness → (2 Corinthians 12)",
      "• Reconciliation → (2 Corinthians 5)",
      "• Unity & humility → (Philippians 2)",
      "• Anxiety & prayer → (Philippians 4)",
      "• Love & community → (Romans 12; 1 Corinthians 13)",
      "• Perseverance → (Galatians 6; Romans 5)",
      "Do not add 'Basis:' lines or cite personal experience.",
    ].join(" ");

    // Precedence
    const precedenceRule =
      "If answerMode ever conflicts with the Mode’s language/behavior rules, the Mode rules take precedence. Keep citations compact and human; avoid verse dumps unless the user requests quotations.";

    // Name repetition fix
    const profileLine = compactProfile(profile);
    const preferredName = getPreferredName(profile);
    const userIntroLine = preferredName
      ? `You are conversing with ${preferredName}.
Use their name only in the **first greeting** of a session or when it adds clarity or comfort.
Do NOT repeat their name in every reply. Avoid starting more than one reply in a row with their name.`
      : "You are conversing with the user. You may greet them once warmly (e.g., “Grace and peace to you”). Then stop repeating their name unless context truly needs it.";

    // Friend lexical guardrails if present in persona.yaml
    const friendGuard =
      mode === "friend" && (personaYaml as any)?.lexical_guards
        ? `FRIEND MODE LEXICAL GUARDS:
- Forbidden imperatives: ${((personaYaml as any).lexical_guards.friend_forbidden_imperatives || []).join(", ")}.
- Rule: ${(personaYaml as any).lexical_guards.friend_rewrite_rule}`
        : "";

    const modePhilosophy =
      (modeYaml as any)?.philosophy ? `MODE PHILOSOPHY:\n${(modeYaml as any).philosophy}` : "";
    const modeBehavior =
      (modeYaml as any)?.behavior
        ? `MODE BEHAVIOR:\n${Object.entries((modeYaml as any).behavior)
            .map(([k, v]) => `${k}:\n${v}`)
            .join("\n")}`
        : "";
    const modeLanguage =
      (modeYaml as any)?.language?.constraints?.length
        ? `MODE LANGUAGE CONSTRAINTS:\n- ${((modeYaml as any).language.constraints as string[]).join("\n- ")}`
        : "";
    const modeSamples =
      Array.isArray((modeYaml as any)?.samples) && (modeYaml as any).samples.length
        ? `SAMPLES (style, not to parrot):\n${((modeYaml as any).samples as any[])
            .slice(0, 3)
            .map((s: any) => `U: ${s.user}\nA: ${s.ai}`)
            .join("\n\n")}`
        : "";

    // Self-checks
    const selfCheck =
      "Before finalizing: keep it short, human, and specific. Vary phrasing. If your last turn ended with a question that wasn’t answered, do NOT ask another—reflect and advance the conversation.";

    const friendSelfCheck =
      mode === "friend"
        ? `FRIEND MODE SELF-CHECK:
If you used any of these as imperatives—try, take, write, breathe, read, pray, list, choose, pick, practice, journal, name—REWRITE into empathy or an "I" story. No techniques or homework.`
        : "";

    // Friend experience guard
    const friendExperienceGuard =
      mode === "friend"
        ? "Before sending: if you already conveyed understanding, skip any personal story. Keep most Friend replies experience-free; include a brief 'I' line only when warmth alone would feel too thin."
        : "";

    // Citation self-check—cite only Scripture/Pauline ideas; never cite personal experience
    const citationSelfCheck =
      "Before sending: include ONE compact parenthetical citation only if you quoted or clearly paraphrased a Pauline verse/idea (e.g., “(Philippians 4)”). Do NOT add 'Basis:' lines or cite personal experience.";

    const stageLine = buildStageLine(stageYaml);

    const fullHistory = await getSessionHistory(sessionId);
    const recent = Array.isArray(fullHistory) ? fullHistory.slice(-MAX_TURNS) : [];

    const historyMsgs: Array<{ role: "system" | "user" | "assistant"; content: string }> = recent
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

    const hasAssistantBefore = recent.some((t: any) => t?.role === "assistant");
    const greetPolicy = hasAssistantBefore
      ? "Do NOT repeat any greeting like 'Grace and peace to you.' since this is not the first assistant reply in this session."
      : "This is the first assistant reply in the session; you may greet briefly once.";

    // Background context markers
    const memoryContextIntro = {
      role: "system" as const,
      content:
        "BACKGROUND CONTEXT: The next lines include the user's past session recaps and long-term summaries from previous conversations. Use them only for continuity and understanding. Do NOT repeat or restate them unless the user brings them up.",
    };
    const recentContextIntro = {
      role: "system" as const,
      content:
        "RECENT CONTEXT (Redis): The next messages are the latest turns from this session. Treat them as the active conversation. Do not repeat greetings. Do not re-ask a question you've already asked unless the user did not answer it. If your previous turn ended with a question and it wasn’t answered, avoid asking another; reflect briefly and move forward.",
    };

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      ...(modeToneHint ? [{ role: "system" as const, content: modeToneHint }] : []),
      ...(phaseHint ? [{ role: "system" as const, content: phaseHint }] : []),
      { role: "system" as const, content: greetPolicy },
      { role: "system" as const, content: personaSystem },
      { role: "system" as const, content: antiGenericVoice },
      { role: "system" as const, content: attributionPolicy },
      { role: "system" as const, content: precedenceRule },
      { role: "system" as const, content: userIntroLine },

      ...(profileLine
        ? [{ role: "system" as const, content: `User details for context: ${profileLine}. Use this to make responses personal and connected.` }]
        : []),

      // Friend guardrails and mode content
      ...(friendGuard ? [{ role: "system" as const, content: friendGuard }] : []),
      ...(modePhilosophy ? [{ role: "system" as const, content: modePhilosophy }] : []),
      ...(modeBehavior ? [{ role: "system" as const, content: modeBehavior }] : []),
      ...(modeLanguage ? [{ role: "system" as const, content: modeLanguage }] : []),
      ...(modeSamples ? [{ role: "system" as const, content: modeSamples }] : []),

      // Background memory (recaps + LTM)
      memoryContextIntro,
      ...(await (async () => {
        let recaps: string[] = [];
        try {
          recaps = await redis.lrange(RECAPS_KEY(sessionId), 0, MAX_PAST_RECAPS - 1);
          if (!recaps || recaps.length === 0) {
            const pineRecaps = await fetchPastRecapsFromPinecone(sessionId, MAX_PAST_RECAPS);
            recaps = pineRecaps || [];
            if (recaps.length > 0) {
              await redis.del(RECAPS_KEY(sessionId));
              for (const r of recaps) await redis.rpush(RECAPS_KEY(sessionId), r);
              await redis.ltrim(RECAPS_KEY(sessionId), -MAX_PAST_RECAPS, -1);
            }
          }
        } catch {}
        return (recaps || []).map((r, i) => ({
          role: "system" as const,
          content: `Past session recap ${i + 1}: ${String(r).trim().slice(0, 1200)}`,
        }));
      })()),

      { role: "system" as const, content: brevityPolicy },
      { role: "system" as const, content: selfCheck },
      ...(friendSelfCheck ? [{ role: "system" as const, content: friendSelfCheck }] : []),
      ...(friendExperienceGuard ? [{ role: "system" as const, content: friendExperienceGuard }] : []),
      { role: "system" as const, content: citationSelfCheck },
      ...(stageLine ? [{ role: "system" as const, content: stageLine }] : []),

      // LTM summaries (semantic matches)
      ...((await fetchRelevantSummaries(sessionId, userText, MAX_LTM)) || []).map(
        (s: string, i: number) => ({
          role: "system" as const,
          content: `Long-term summary ${i + 1}: ${s}`,
        })
      ),

      // Active conversation
      recentContextIntro,
      ...historyMsgs,

      // Current message
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

// src/lib/server/prompt.ts
import * as yaml from "js-yaml";
import fs from "fs";
import path from "path";

type Mode = "friend" | "mentor" | "study";
type AnswerMode = "human_pov" | "biblical";

export type StudyConfig = {
  ref?: string;                 // e.g., "Philippians 2:1-11"
  type?: "sermon" | "qna";      // Sermon≈3min or Q&A
  allowMissing?: boolean;
};

const PASSAGE_RE =
  /\b([1-3]?\s?[A-Za-z]+)\s+(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?\b/;

function tryLoadStudyContext(basePath: string, ref?: string, userText?: string) {
  const corpusPath = path.join(basePath, "study.corpus.yaml");
  if (!fs.existsSync(corpusPath)) return { block: "", matchedRef: null };

  const doc = yaml.load(fs.readFileSync(corpusPath, "utf8")) as any;
  if (!doc || !Array.isArray(doc.passages)) return { block: "", matchedRef: null };

  let targetRef = ref?.trim();
  if (!targetRef && userText) {
    const m = userText.match(PASSAGE_RE);
    if (m) targetRef = `${m[1].replace(/\s+/g, " ").trim()} ${m[2]}:${m[3]}${m[4] ? "-" + m[4] : ""}`;
  }
  if (!targetRef) return { block: "", matchedRef: null };

  const needle = targetRef.toLowerCase();
  const hit = doc.passages.find((p: any) => (p.ref_lc || "").toLowerCase() === needle);
  if (!hit) return { block: "", matchedRef: targetRef };

  const verseText = (hit.text || "").trim();
  const notes = (hit.notes || "").trim();

  const block = `
STUDY PASSAGE:
[${hit.ref}]
${verseText}

NOTES:
${notes}
`.trim();

  return { block, matchedRef: hit.ref };
}

/**
 * Strict persona behavior per mode:
 * - FRIEND: warm, pastoral conversation, NO scripture references unless user asks.
 * - MENTOR: concise guidance and a practical next step; may include 1 short scripture ref if it genuinely helps.
 * - STUDY: chooses SERMON (~3min) or Q&A per StudyConfig; grounded in passage (from YAML).
 */
export function buildSystemPrompt(
  figure: string,
  mode: Mode,
  answerMode: AnswerMode,
  userTextForStudy?: string,
  study?: StudyConfig,
  profile?: { name?: string; country?: string; goals?: string[] }
) {
  const safeFigure = figure.toLowerCase().replace(/\s+/g, "-");
  const basePath = path.resolve(process.cwd(), `src/personas/${safeFigure}`);
  if (!fs.existsSync(basePath)) throw new Error(`Persona folder not found: ${basePath}`);

  const persona = yaml.load(fs.readFileSync(path.join(basePath, "persona.yaml"), "utf8")) as any;
  const modeSpec = yaml.load(fs.readFileSync(path.join(basePath, `mode.${mode}.yaml`), "utf8")) as any;
  const stages = yaml.load(fs.readFileSync(path.join(basePath, "stages.yaml"), "utf8")) as any;

  const figureName = persona?.display_name || "Saint Paul";
  const tone = modeSpec?.tone || "warm";
  const policyLines = (modeSpec?.policy || []).map((p: string) => `- ${p}`).join("\n");
  const stageRules = (stages?.stages || []).map((s: any) => `• ${s.rule}`).join("\n");

  const pov =
    answerMode === "biblical"
      ? "Use scripture support naturally with inline refs like (Phil 2:5-11). Do not invent verses."
      : mode === "friend"
      ? "Do NOT quote scripture or give references unless the user explicitly asks."
      : "Use scripture sparingly; only if it clearly helps a practical step.";

  // Study add-ons
  let studyHeader = "";
  let studyBlock = "";
  if (mode === "study") {
    const { block, matchedRef } = tryLoadStudyContext(basePath, study?.ref, userTextForStudy);
    studyBlock = block;

    if (study?.type === "sermon") {
      studyHeader = `
STUDY MODE: SERMON (~3 minutes)
- Produce a cohesive sermon on ${matchedRef || study?.ref || "the passage"} (≈400–500 words).
- Structure: brief intro → exposition → pastoral application → one reflective question.
- Respect quotation; do not fabricate verses.
`.trim();
    } else {
      studyHeader = `
STUDY MODE: Q&A
- Answer questions grounded in the passage and notes below.
- Keep answers 80–140 words.
- Cite verses only as needed and never fabricate quotes.
`.trim();
    }

    if (!studyBlock && !study?.allowMissing) {
      studyBlock = `STUDY PASSAGE:\n[${study?.ref || "Unknown"}]\n(Note: passage text not found in YAML.)`;
    }
  }

  const greet = profile?.name ? `Always greet the user by name when appropriate (e.g., “${profile.name}, ...”).` : "";

  return `
ROLE: ${figureName} in ${mode.toUpperCase()} mode.
Tone: ${tone}

Conversation policy:
${policyLines}

Stage logic:
${stageRules}

Behavior by mode:
- FRIEND: warm, empathetic, conversational. ${answerMode === "human_pov" ? "No scripture refs unless asked." : ""}
- MENTOR: concise coaching + 1 practical next step${answerMode === "human_pov" ? "; scripture ref optional" : ""}.
- STUDY: follow Study section below (Sermon or Q&A).

Personalization:
${greet}

General guidelines:
- Empathy → short counsel → end with one reflective question.
- Keep replies 80–140 words (except SERMON ~400–500).
- ${pov}

${studyHeader}
${studyBlock}
`.trim();
}

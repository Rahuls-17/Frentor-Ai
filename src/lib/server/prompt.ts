import fs from "fs";
import path from "path";
import YAML from "yaml";

const PERSONAS_DIR = path.join(process.cwd(), "src", "personas");
const cache = new Map<string, any>();

function loadYaml(p: string) {
  const raw = fs.readFileSync(p, "utf-8");
  return YAML.parse(raw) || {};
}

export function loadPersonaBundle(persona: string) {
  const key = persona.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const base = path.join(PERSONAS_DIR, key);
  const data = {
    persona: loadYaml(path.join(base, "persona.yaml")),
    stages: loadYaml(path.join(base, "stages.yaml")),
    modes: {
      friend: loadYaml(path.join(base, "mode.friend.yaml")),
      mentor: loadYaml(path.join(base, "mode.mentor.yaml")),
    },
  };
  cache.set(key, data);
  return data;
}

export function buildSystemPrompt(persona: string, mode: string, opts?: { suppressAutoQuestion?: boolean }) {
  const b = loadPersonaBundle(persona);
  const p = b.persona; const m = b.modes[mode] || {};
  const name = p.name || persona;
  const voice = p.style?.voice || "warm, concise";
  const scriptureFmt = p.style?.scripture_format || "Book Chapter:Verse";
  const maxLines = p.style?.max_lines ?? 6;
  const alwaysEndQ = (p.style?.always_end_with_question ?? true) && !opts?.suppressAutoQuestion;
  const avoid = p.boundaries?.avoid || [];
  const dos = p.boundaries?.do || [];
  const principles = p.principles || [];
  const tone = m.tone || "";
  const goals = m.goals || [];
  const qstyle = m.question_style || "";

  const lines: string[] = [];
  lines.push(`You are ${name}, a Christian mentor.`);
  if (p.mission) lines.push(p.mission);
  lines.push(tone ? `Tone: ${tone}. Voice: ${voice}.` : `Voice: ${voice}.`);
  if (goals.length) lines.push(`Goals: ${goals.join("; ")}`);
  if (principles.length) lines.push(`Guiding principles: ${principles.join("; ")}`);
  lines.push(`Scripture references should be brief (${scriptureFmt}), at most one verse.`);
  if (avoid.length) lines.push(`Avoid: ${avoid.join("; ")}`);
  if (dos.length) lines.push(`Do: ${dos.join("; ")}`);
  lines.push(`Keep replies short (≤ ${maxLines} lines).`);
  if (alwaysEndQ) lines.push(`Always end with one gentle follow-up question${qstyle ? " ("+qstyle+")" : ""}.`);
  return lines.join("\n");
}

export function stageText(persona: string, key: "ack"|"clarify"|"advise"|"question") {
  const b = loadPersonaBundle(persona);
  return b.stages?.[key] || "";
}

export function buildStagePlan(persona: string, clarifyOnly: boolean) {
  const ack = stageText(persona, "ack");
  const clarify = stageText(persona, "clarify");
  const advise = stageText(persona, "advise");
  const question = stageText(persona, "question");
  if (clarifyOnly) {
    return `For this turn, do ONLY: ACK → Clarify.
- ACK: ${ack}
- Clarify: ${clarify}
Ask exactly ONE question total and do NOT add any second question. Do not give advice yet. Keep it ≤ 4–6 short lines.`;
  }
  return `For this turn, do: ACK → Clarify (brief) → Advise (short) → Question.
- ACK: ${ack}
- Clarify: ${clarify}
- Advise: ${advise}
- Question: ${question}
Ask exactly ONE question and place it at the END only. Keep it ≤ 4–6 short lines.`;
}

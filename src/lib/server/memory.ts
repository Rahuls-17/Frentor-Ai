// C:\Users\singh\OneDrive\Desktop\farAlpha\Frentor-AI-nextjs-hybird\Frentor-Ai\src\lib\server\memory.ts
import { redis } from "./redis";
import { index } from "./pinecone";
import fs from "fs";
import path from "path";

export type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const PROFILE_KEY = "profile:dummy";
const AUDIO_DIR = path.resolve(process.cwd(), "public/audio");

/** Read entire session from Redis (safe against mixed payloads). */
export async function getSessionHistory(sessionId: string): Promise<ChatTurn[]> {
  const key = `session:${sessionId}:turns`;
  const arr = ((await redis.lrange(key, 0, -1)) as any[]) || [];
  const safe: ChatTurn[] = [];
  for (const item of arr) {
    try {
      const parsed = typeof item === "string" ? JSON.parse(item) : item;
      if (parsed?.role && typeof parsed?.content === "string") {
        safe.push({ role: parsed.role, content: parsed.content });
      }
    } catch {
      safe.push({ role: "system", content: String(item) });
    }
  }
  return safe;
}

/** Append a new turn and refresh TTL so active sessions don't expire. */
export async function pushTurn(sessionId: string, turn: ChatTurn) {
  const key = `session:${sessionId}:turns`;
  await redis.rpush(key, JSON.stringify(turn));
  await redis.expire(key, SESSION_TTL);
}

/** Pinecone upsert/query (unchanged). */
export async function upsertSummary(userId: string, summary: string, type: string) {
  try {
    const embed = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: summary, model: "text-embedding-3-small" }),
    }).then((r) => r.json());
    const vector = embed.data?.[0]?.embedding;
    if (!vector) return;
    await index.upsert([{ id: `${userId}-${Date.now()}`, values: vector, metadata: { type, text: summary, userId } }]);
  } catch (e) {
    console.error("Pinecone upsertSummary error:", e);
  }
}

export async function fetchRelevantSummaries(userId: string, query: string, topK = 3): Promise<string[]> {
  try {
    const embed = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: query, model: "text-embedding-3-small" }),
    }).then((r) => r.json());
    const vector = embed.data?.[0]?.embedding;
    if (!vector) return [];
    const res = await index.query({ vector, topK, includeMetadata: true, filter: { userId } });
    return res.matches?.map((m) => m.metadata?.text as string) || [];
  } catch (e) {
    console.error("Pinecone query error:", e);
    return [];
  }
}

/** Profile memory in Redis. */
export async function getProfileMemory<T = any>(): Promise<T | null> {
  return ((await redis.get(PROFILE_KEY)) as any) ?? null;
}
export async function setProfileMemory(profile: any): Promise<void> {
  await redis.set(PROFILE_KEY, profile);
}

/** Save TTS audio to /public/audio and return a URL. */
export async function saveTTSAudio(sessionId: string, buffer: ArrayBuffer): Promise<string> {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const filename = `${sessionId}-${Date.now()}.mp3`;
  const filePath = path.join(AUDIO_DIR, filename);
  await fs.promises.writeFile(filePath, Buffer.from(buffer));
  return `/audio/${filename}`;
}

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

/** Delete entire session history (used by Recap). */
export async function deleteSessionHistory(sessionId: string) {
  const key = `session:${sessionId}:turns`;
  await redis.del(key);
  const lastActiveKey = `session:${sessionId}:lastActive`;
  await redis.del(lastActiveKey);
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

/** Store recap as a separate typed vector for LTM continuity. */
export async function upsertRecap(sessionId: string, summary: string) {
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
    await index.upsert([
      {
        id: `recap:${sessionId}:${Date.now()}`,
        values: vector,
        metadata: {
          type: "recap",
          text: summary,
          sessionId,
          userId: sessionId, // ✅ added for filter consistency
          preview: summary.slice(0, 240),
          createdAt: Date.now(),
        },
      },
    ]);
  } catch (e) {
    console.error("Pinecone upsertRecap error:", e);
  }
}

/** Save user’s learning reflection after recap. */
export async function upsertLearningJournal(args: {
  sessionId: string;
  text: string;
  mode?: string;
  studyRef?: string;
}) {
  const { sessionId, text, mode, studyRef } = args;
  try {
    const embed = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: text, model: "text-embedding-3-small" }),
    }).then((r) => r.json());

    const vector = embed.data?.[0]?.embedding;
    if (!vector) return;

    // Build metadata without undefined fields
    const metadata: Record<string, any> = {
      type: "learning_journal",
      text,
      sessionId,
      userId: sessionId, // for filter consistency
      preview: text.slice(0, 240),
      createdAt: Date.now(),
    };
    if (mode !== undefined) metadata.mode = mode;
    if (studyRef !== undefined) metadata.studyRef = studyRef;

    await index.upsert([
      {
        id: `journal:${sessionId}:${Date.now()}`,
        values: vector,
        metadata,
      },
    ]);
  } catch (e) {
    console.error("Pinecone upsertLearningJournal error:", e);
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

/**
 * 🔄 Fallback: fetch the latest few recap texts from Pinecone when Redis has none.
 * Filters by { userId, type: "recap" }, returns the most recent 'limit' by createdAt (desc).
 * Note: Pinecone doesn't sort server-side; we request a modest topK and sort locally.
 */
export async function fetchPastRecapsFromPinecone(userId: string, limit = 3): Promise<string[]> {
  try {
    // Use a neutral query: embed a short generic token to satisfy query API.
    const embed = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "recap", model: "text-embedding-3-small" }),
    }).then((r) => r.json());

    const vector = embed.data?.[0]?.embedding;
    if (!vector) return [];

    // Ask for a small pool, then sort by createdAt desc
    const res = await index.query({
      vector,
      topK: Math.max(limit, 10), // fetch a bit more, then trim after sorting
      includeMetadata: true,
      includeValues: false,
      filter: { userId, type: "recap" },
    });

    const matches = res?.matches || [];
    const sorted = matches.sort(
      (a: any, b: any) => (b?.metadata?.createdAt || 0) - (a?.metadata?.createdAt || 0)
    );

    return sorted
      .slice(0, limit)
      .map((m: any) => (m?.metadata?.text as string) || "")
      .filter((t: string) => typeof t === "string" && t.trim().length > 0);
  } catch (e) {
    console.error("Pinecone fetchPastRecapsFromPinecone error:", e);
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

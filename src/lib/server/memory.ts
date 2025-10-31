// src/lib/server/memory.ts
import { redis, REDIS_MAX_TURNS, REDIS_TTL, keyState, keyTurns } from "./redis";
import { index, ns } from "./pinecone";
import { openai, EMBED_MODEL } from "./openai";

type Turn = { role: "user"|"assistant"|"system"; content: string };

export async function pushTurn(persona: string, mode: string, sessionId: string, role: Turn["role"], content: string) {
  const k = keyTurns(persona, mode, sessionId);
  const entry = JSON.stringify({ t: Date.now()/1000, role, content });
  await redis.lpush(k, entry);
  await redis.ltrim(k, 0, REDIS_MAX_TURNS - 1);
  await redis.expire(k, REDIS_TTL);
}

export async function getRecentTurns(
  persona: string,
  mode: string,
  sessionId: string,
  limit = REDIS_MAX_TURNS
): Promise<Turn[]> {
  const k = keyTurns(persona, mode, sessionId);

  // Upstash REST may return strings or objects (from older writes).
  const raw = await redis.lrange(k, 0, limit - 1);
  const items = (raw ?? []) as any[];

  const turns = items
    .map((x) => {
      if (typeof x === "string") {
        try { return JSON.parse(x); } catch { return null; }
      }
      // already an object?
      if (x && typeof x === "object" && "role" in x && "content" in x) return x;
      return null;
    })
    .filter(Boolean)
    .reverse();

  return turns.map((it: any) => ({
    role: it.role as Turn["role"],
    content: String(it.content ?? "")
  }));
}



export async function getState(persona: string, mode: string, sessionId: string) {
  const st = await redis.hgetall<Record<string, string>>(keyState(persona, mode, sessionId));
  return {
    last_ai_shape: st?.last_ai_shape || null,
    new_topic: (st?.new_topic ?? "true") === "true",
  };
}

export async function setState(persona: string, mode: string, sessionId: string, last_ai_shape: string|null, new_topic: boolean) {
  const k = keyState(persona, mode, sessionId);
  await redis.hset(k, { last_ai_shape: last_ai_shape || "", new_topic: new_topic ? "true" : "false" });
  await redis.expire(k, REDIS_TTL);
}

// --- Pinecone + OpenAI code below unchanged ---
export async function embedOne(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
  return (res.data[0].embedding as unknown) as number[];
}
export async function embedMany(texts: string[]) {
  const res = await openai.embeddings.create({ model: EMBED_MODEL, input: texts });
  return res.data.map((d) => (d.embedding as unknown) as number[]);
}
export async function upsertFacts(persona: string, mode: string, sessionId: string, items: {id: string, text: string, metadata?: Record<string, any>}[]) {
  if (!items.length) return;
  const values = await embedMany(items.map((i) => i.text));
  const toUpsert = items.map((it, i) => ({
    id: it.id,
    values: values[i],
    metadata: { ...it.metadata, persona, mode, session_id: sessionId, text: it.text, timestamp: Date.now()/1000 }
  }));
  await index().namespace(ns(persona, mode)).upsert(toUpsert);
}
export async function queryFacts(persona: string, mode: string, sessionId: string, query: string, topK = 3, filterBySession = false, types?: string[]) {
  const v = await embedOne(query);
  const flt: Record<string, any> = {};
  if (filterBySession) flt.session_id = { "$eq": sessionId };
  if (types?.length) flt.type = { "$in": types };
  const res = await index().namespace(ns(persona, mode)).query({ topK, vector: v, filter: Object.keys(flt).length ? flt : undefined });
  return res.matches?.map((m) => ({ id: m.id, score: m.score, metadata: m.metadata as Record<string, any> })) || [];
}

import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const REDIS_TTL = Number(process.env.REDIS_TTL_SECONDS || 43200);
export const REDIS_MAX_TURNS = Number(process.env.REDIS_MAX_TURNS || 12);

export function keyTurns(persona: string, mode: string, sessionId: string) {
  return `session:${persona}:${mode}:${sessionId}:turns`;
}
export function keyState(persona: string, mode: string, sessionId: string) {
  return `session:${persona}:${mode}:${sessionId}:state`;
}

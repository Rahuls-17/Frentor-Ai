import Redis from "ioredis";

const url = process.env.REDIS_URL!;
export const redis = new Redis(url, { lazyConnect: false });

export const REDIS_TTL = Number(process.env.REDIS_TTL_SECONDS || 43200);
export const REDIS_MAX_TURNS = Number(process.env.REDIS_MAX_TURNS || 12);

export function keyTurns(persona: string, mode: string, sessionId: string) {
  return `session:${persona}:${mode}:${sessionId}:turns`;
}
export function keyState(persona: string, mode: string, sessionId: string) {
  return `session:${persona}:${mode}:${sessionId}:state`;
}

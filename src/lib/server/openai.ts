import OpenAI from "openai";
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-5";
export const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-large";
export const EMBED_DIM = EMBED_MODEL.endsWith("3-large") ? 3072 : 1536;

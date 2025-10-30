// src/lib/server/pinecone.ts
import { Pinecone, type ServerlessSpec } from "@pinecone-database/pinecone";

export const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
export const INDEX_NAME = process.env.PINECONE_INDEX || "frentor-ai";

// Narrow env values to the SDK's expected literal types
const CLOUD = (process.env.PINECONE_CLOUD ?? "aws") as ServerlessSpec["cloud"];
const REGION = (process.env.PINECONE_REGION ?? "us-east-1") as ServerlessSpec["region"];

let _ensured = false;

export async function ensureIndex(dimension: number) {
  if (_ensured) return;
  const list = await pc.listIndexes();
  const exists = list.indexes?.some((i) => i.name === INDEX_NAME);
  if (!exists) {
    await pc.createIndex({
      name: INDEX_NAME,
      dimension,
      metric: "cosine",
      // Cast once to satisfy the enum types from the SDK
      spec: { serverless: { cloud: CLOUD, region: REGION } as ServerlessSpec },
    });
  }
  _ensured = true;
}

export function index() {
  return pc.index(INDEX_NAME);
}

export function ns(persona: string, mode: string) {
  return `${persona}:${mode}`.toLowerCase();
}

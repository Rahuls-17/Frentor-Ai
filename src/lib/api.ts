// src/lib/api.ts

export type Mode = "friend" | "mentor" | "study";
export type AnswerMode = "human_pov" | "biblical";
export type StudyType = "sermon" | "qna";

export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
};

type SendArgs = {
  sessionId: string;
  text: string;
  figure: string;                  // e.g., "paul"
  mode: Mode;                      // "friend" | "mentor" | "study"
  answerMode: AnswerMode;          // "human_pov" | "biblical"
  study?: { ref?: string; type?: StudyType }; // optional for study mode
  profile?: any;                   // ✅ NEW: client-provided profile (from localStorage)
};

type SendResult = {
  reply: string;                   // plain text reply (no audioUrl)
};

type HistoryResult = {
  recent: ChatTurn[];
};

// Resolve base URL safely (works on both server & client)
function getBaseUrl() {
  if (typeof window !== "undefined") {
    return ""; // relative calls in browser
  }
  // For SSR or edge: allow env override
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";
  return fromEnv.replace(/\/+$/, "");
}

/** Send chat turn to backend -> returns text reply only */
export async function sendToBackend(args: SendArgs): Promise<SendResult> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: args.sessionId,
      text: args.text,
      figure: args.figure,
      mode: args.mode,
      answerMode: args.answerMode,
      // no autospeak, no audio
      study: args.study,
      profile: args.profile, // ✅ NEW: forward profile to backend
    }),
  });

  if (!res.ok) {
    const msg = await safeText(res);
    throw new Error(msg || `chat failed: ${res.status}`);
  }
  const data = (await res.json()) as SendResult;
  return data;
}

/** Fetch recent chat history (used on first load per mode) */
export async function getHistory(
  sessionId: string,
  figure: string,
  mode: Mode
): Promise<HistoryResult> {
  const base = getBaseUrl();
  const qs = new URLSearchParams({ sessionId, figure, mode });
  const res = await fetch(`${base}/api/history?${qs.toString()}`, {
    method: "GET",
    headers: { "content-type": "application/json" },
  });

  if (!res.ok) {
    const msg = await safeText(res);
    throw new Error(msg || `history failed: ${res.status}`);
  }
  const data = (await res.json()) as HistoryResult;
  return data;
}

/** Trigger a recap: server summarizes, stores to Pinecone, clears Redis. */
export async function recapSession(sessionId: string): Promise<{ recap: string }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "recap", sessionId }),
  });

  if (!res.ok) {
    const msg = await safeText(res);
    throw new Error(msg || `recap failed: ${res.status}`);
  }
  const data = (await res.json()) as { recap: string };
  return data;
}

/** Save the user's learning/feeling reflection after a recap. */
export async function saveLearningJournal(params: {
  sessionId: string;
  text: string;
  mode: Mode;
  studyRef?: string;
}): Promise<{ ok: true }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "journal", ...params }),
  });

  if (!res.ok) {
    const msg = await safeText(res);
    throw new Error(msg || `journal failed: ${res.status}`);
  }
  const data = (await res.json()) as { ok: true };
  return data;
}

/** Utility: avoid throwing on res.text() for non-JSON error bodies */
async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

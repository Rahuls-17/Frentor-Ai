// src/lib/api.ts
export type ChatTurn = {
  role: "user" | "assistant" | "system";
  content: string;
  audioUrl?: string;
};

export async function sendToBackend(params: {
  sessionId: string;
  text: string;
  figure: string;
  mode: "friend" | "mentor" | "study";
  answerMode: "human_pov" | "biblical";
  autospeak: boolean;
  study?: { ref?: string; type?: "sermon" | "qna" };
}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { reply: string; audioUrl?: string };
}

export async function getHistory(
  sessionId: string,
  figure: string,
  mode: "friend" | "mentor" | "study"
) {
  const res = await fetch(
    `/api/history?sessionId=${encodeURIComponent(sessionId)}&figure=${figure}&mode=${mode}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
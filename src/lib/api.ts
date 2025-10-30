export type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

export async function sendToBackend(
  sessionId: string,
  userText: string,
  persona: string,
  mode: "friend" | "mentor"
) {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, persona, mode, message: userText })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as { reply?: string };
}

export async function getHistory(sessionId: string, persona: string, mode: "friend" | "mentor") {
  const params = new URLSearchParams({ session_id: sessionId, persona, mode });
  const resp = await fetch(`/api/history?${params.toString()}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as { recent: ChatTurn[] };
}

"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import VoiceMic from "@/components/VoiceMic";
import ChatBubble from "@/components/ChatBubble";
import { safeUUID } from "@/lib/safeId";

type Mode = "friend" | "mentor";
const DEFAULT_PERSONA = "saint-paul" as const;
type Turn = { role: "user" | "assistant"; content: string };

function getOrCreateSessionId(mode: Mode) {
  if (typeof window === "undefined") return `ssr-${mode}`;
  const key = `frentor:session:${mode}`;
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = safeUUID(); // safe fallback (works on older mobile browsers)
    window.localStorage.setItem(key, id);
  }
  return id;
}

export default function HomePage() {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window !== "undefined") {
      const v = window.localStorage.getItem("frentor:mode");
      if (v === "mentor" || v === "friend") return v;
    }
    return "friend";
  });
  const sessionId = useMemo(() => getOrCreateSessionId(mode), [mode]);

  const [messages, setMessages] = useState<Turn[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem("frentor:mode", mode);
  }, [mode]);

  // Load history from Redis via /api/history whenever mode/session changes
  useEffect(() => {
    (async () => {
      const qs = new URLSearchParams({
        session_id: sessionId,
        persona: DEFAULT_PERSONA,
        mode,
      });
      const r = await fetch(`/api/history?${qs.toString()}`);
      const data = await r.json();
      const recent = Array.isArray(data?.recent) ? (data.recent as Turn[]) : [];
      setMessages(recent);
    })();
  }, [mode, sessionId]);

  function handleNewTurn(userText: string, assistantText: string) {
    setMessages((m) => [
      ...m,
      { role: "user", content: userText },
      { role: "assistant", content: assistantText },
    ]);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.title}>Frentor AI</div>
        <div className={styles.controls}>
          <div className={styles.toggle}>
            <label>
              <input
                type="radio"
                name="mode"
                value="friend"
                checked={mode === "friend"}
                onChange={() => setMode("friend")}
              />{" "}
              Friend
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="mentor"
                checked={mode === "mentor"}
                onChange={() => setMode("mentor")}
              />{" "}
              Mentor
            </label>
          </div>
        </div>
      </header>

      <main className={styles.centerMain}>
        <div className={styles.centerColumn}>
          {/* Single central mic button */}
          <VoiceMic
            sessionId={sessionId}
            persona={DEFAULT_PERSONA}
            mode={mode}
            onTurn={handleNewTurn}
          />

          {/* Read-only conversation history below the mic */}
          <div className={styles.historyWrap}>
            {messages.map((m, i) => (
              <ChatBubble key={i} role={m.role} text={m.content} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import ChatBubble from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import { sendToBackend, getHistory, ChatTurn } from "@/lib/api";

type Mode = "friend" | "mentor";
const PERSONA = "saint-paul";

// localStorage keys
const SID_KEY = "frentor.sessionIds.v1"; // stores {friend,mentor}

function loadSessionIds(): Record<Mode, string> {
  try {
    const raw = localStorage.getItem(SID_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj.friend && obj.mentor) return obj;
    }
  } catch {}
  const fresh = {
    friend: `friend-${Math.random().toString(36).slice(2, 8)}`,
    mentor: `mentor-${Math.random().toString(36).slice(2, 8)}`,
  };
  localStorage.setItem(SID_KEY, JSON.stringify(fresh));
  return fresh;
}

export default function Page() {
  const [currentMode, setCurrentMode] = useState<Mode>("friend");

  const [sessionIdByMode, setSessionIdByMode] = useState<Record<Mode, string>>({
    friend: "",
    mentor: "",
  });

  const [messagesByMode, setMessagesByMode] = useState<
    Record<Mode, ChatTurn[]>
  >({
    friend: [],
    mentor: [],
  });

  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState<Record<Mode, boolean>>({
    friend: false,
    mentor: false,
  });

  // On first mount, load/persist session IDs and fetch history for both modes (lazy)
  useEffect(() => {
    const ids = loadSessionIds();
    setSessionIdByMode(ids);
  }, []);

  // Load history when session IDs are known and a mode is selected (lazy per mode)
  useEffect(() => {
    const sid = sessionIdByMode[currentMode];
    if (!sid || initialized[currentMode]) return;

    (async () => {
      try {
        const res = await getHistory(sid, PERSONA, currentMode);
        const recent = res.recent?.length
          ? res.recent
          : [
              {
                role: "assistant",
                content:
                  currentMode === "friend"
                    ? "Hello! I’m Frentor (Friend mode). How can I help?"
                    : "Hello! I’m Frentor (Mentor mode). What’s on your mind?",
              },
            ];
        setMessagesByMode((m) => ({ ...m, [currentMode]: recent }));
        setInitialized((s) => ({ ...s, [currentMode]: true }));
      } catch {
        // if history call fails, still seed a greeting
        setMessagesByMode((m) => ({
          ...m,
          [currentMode]: [
            {
              role: "assistant",
              content:
                currentMode === "friend"
                  ? "Hello! I’m Frentor (Friend mode). How can I help?"
                  : "Hello! I’m Frentor (Mentor mode). What’s on your mind?",
            },
          ],
        }));
        setInitialized((s) => ({ ...s, [currentMode]: true }));
      }
    })();
  }, [sessionIdByMode, currentMode, initialized]);

  const onSend = async (text: string) => {
    const sid = sessionIdByMode[currentMode];
    if (!sid) return;

    setMessagesByMode((m) => ({
      ...m,
      [currentMode]: [...m[currentMode], { role: "user", content: text }],
    }));

    setLoading(true);
    try {
      const res = await sendToBackend(sid, text, PERSONA, currentMode);
      const reply = res.reply ?? "(no reply)";
      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [
          ...m[currentMode],
          { role: "assistant", content: reply },
        ],
      }));
    } catch (e: any) {
      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [
          ...m[currentMode],
          {
            role: "assistant",
            content: `Oops: ${e?.message ?? "error sending message"}`,
          },
        ],
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }, [messagesByMode, currentMode, loading]);

  const messages = messagesByMode[currentMode];

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.titleBox}>
            <h1 className={styles.title}>Frentor Chat</h1>
            <p className={styles.sub}>
              Persona: Saint Paul • Mode:{" "}
              {currentMode === "friend" ? "Friend" : "Mentor"}
            </p>
          </div>

          <div className={styles.controls}>
            <div
              className={styles.modeToggle}
              role="tablist"
              aria-label="Chat mode"
            >
              <button
                role="tab"
                aria-selected={currentMode === "friend"}
                className={`${styles.toggleBtn} ${
                  currentMode === "friend" ? styles.toggleBtnActive : ""
                }`}
                onClick={() => setCurrentMode("friend")}
              >
                Friend
              </button>
              <button
                role="tab"
                aria-selected={currentMode === "mentor"}
                className={`${styles.toggleBtn} ${
                  currentMode === "mentor" ? styles.toggleBtnActive : ""
                }`}
                onClick={() => setCurrentMode("mentor")}
              >
                Mentor
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} />
        ))}
        {loading && <div className={styles.loading}>Thinking…</div>}
      </main>

      <ChatInput onSend={onSend} />
    </div>
  );
}

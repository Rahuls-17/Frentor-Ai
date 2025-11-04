// src/components/ChatBubble.tsx
"use client";
import React from "react";
import styles from "./ChatBubble.module.css";

type Props = {
  role: "user" | "assistant" | "system";
  content: string;
  audioUrl?: string | null;
};

export default function ChatBubble({ role, content, audioUrl }: Props) {
  const isUser = role === "user";
  const side = isUser ? styles.end : styles.start;
  const palette =
    role === "user"
      ? styles.user
      : role === "assistant"
      ? styles.assistant
      : styles.system;

  return (
    <div className={`${styles.row} ${side}`}>
      <div className={`${styles.bubble} ${palette}`}>
        <div className={styles.content}>{content}</div>
        {role === "assistant" && audioUrl ? (
          <div className={styles.actions}>
            <button
              className={styles.replay}
              onClick={() => new Audio(audioUrl).play()}
            >
              🔁 Replay
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

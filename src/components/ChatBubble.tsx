// src/components/ChatBubble.tsx
import React from "react";
import styles from "./ChatBubble.module.css";

type Props = {
  role: "user" | "assistant" | "system";
  content: string;
};

export default function ChatBubble({ role, content }: Props) {
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
        {/* Use a normal div; CSS handles preserving newlines + wrapping */}
        <div className={styles.content}>{content}</div>
      </div>
    </div>
  );
}

// C:\Users\singh\OneDrive\Desktop\farAlpha\Frentor-AI-nextjs-hybird\Frentor-Ai\src\components\ChatInput.tsx
// src/components/ChatInput.tsx
"use client";
import React, { useState } from "react";
import styles from "./ChatInput.module.css";

export default function ChatInput({
  onSend,
  disabled,
  studyContext,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  studyContext?: {
    mode: "friend" | "mentor" | "study";
    ref?: string;
    type?: "qna" | "sermon";
  };
}) {
  // ALWAYS-controlled text input
  const [text, setText] = useState<string>("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;

    const t = (text || "").trim();
    if (!t) {
      // keep your study-mode convenience fallback
      if (studyContext?.mode === "study" && (studyContext?.ref || "").trim()) {
        const fallback =
          studyContext?.type === "sermon"
            ? `Start sermon on ${studyContext.ref}`
            : `Study ${studyContext.ref}`;
        onSend(fallback);
      }
      return;
    }
    onSend(t);
    setText("");
  }

  return (
    <div className={styles.bar}>
      <form className={styles.form} onSubmit={submit}>
        <input
          className={styles.input}
          placeholder={disabled ? "Preparing session…" : "Type your message…"}
          value={text}
          onChange={(e) => setText(e.target.value ?? "")}
          disabled={!!disabled}
        />
        <button type="submit" className={styles.button} disabled={!!disabled}>
          Send
        </button>
      </form>
    </div>
  );
}

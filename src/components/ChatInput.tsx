"use client";
import React, { useState } from "react";
import styles from "./ChatInput.module.css";

export default function ChatInput({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <form
      className={styles.bar}
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        onSend(t);
        setText("");
      }}
    >
      <input
        className={styles.input}
        placeholder="Type your message…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className={styles.button}>
        Send
      </button>
    </form>
  );
}

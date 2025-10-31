"use client";

import { useRef, useState } from "react";
import styles from "./ChatBubble.module.css";

export default function ChatBubble({
  role,
  text,
}: {
  role: "user" | "assistant";
  text: string;
}) {
  const [playing, setPlaying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handlePlay() {
    if (!text) return;
    try {
      setPlaying(true);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error("TTS failed");
      const audio = new Audio();
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "audio/mpeg" });
      audio.src = URL.createObjectURL(blob);
      await audio.play();
    } catch {
      /* ignore */
    } finally {
      setPlaying(false);
    }
  }

  function handleStop() {
    try {
      abortRef.current?.abort();
    } catch {}
  }

  return (
    <div className={role === "user" ? styles.user : styles.assistant}>
      <div className={styles.text}>{text}</div>
      {role === "assistant" && (
        <div className={styles.controls}>
          {!playing ? (
            <button
              className={styles.playBtn}
              onClick={handlePlay}
              aria-label="Play"
            >
              ▶
            </button>
          ) : (
            <button
              className={styles.stopBtn}
              onClick={handleStop}
              aria-label="Stop"
            >
              ⏹
            </button>
          )}
        </div>
      )}
    </div>
  );
}

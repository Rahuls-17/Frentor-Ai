// C:\Users\singh\OneDrive\Desktop\farAlpha\Frentor-AI-nextjs-hybird\Frentor-Ai\src\components\ChatInput.tsx
"use client";
import React, { useRef, useState } from "react";
import styles from "./ChatInput.module.css";

export default function ChatInput({
  onSend,
  disabled,
  studyContext,
  lastAudioUrl,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  studyContext?: {
    mode: "friend" | "mentor" | "study";
    ref?: string;
    type?: "qna" | "sermon";
  };
  lastAudioUrl?: string | null;
}) {
  // ALWAYS-controlled text input
  const [text, setText] = useState<string>("");

  const [recording, setRecording] = useState<boolean>(false);
  const [transcribing, setTranscribing] = useState<boolean>(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    if (disabled) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      setTranscribing(true);
      try {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        const form = new FormData();
        form.append("file", audioBlob, "recording.webm");
        const res = await fetch("/api/stt", { method: "POST", body: form });
        const data = await res.json();
        const txt = (data?.text || "").trim();
        if (txt) onSend(txt);
      } catch (e) {
        console.error("STT error", e);
      } finally {
        setTranscribing(false);
      }
    };
    rec.start();
    mediaRef.current = rec;
    setRecording(true);
  }

  function stopRecording() {
    if (!mediaRef.current) return;
    try {
      mediaRef.current.stop();
      mediaRef.current.stream.getTracks().forEach((t) => t.stop());
    } catch {}
    setRecording(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;

    const t = (text || "").trim();
    if (!t) {
      if (studyContext?.mode === "study" && (studyContext?.ref || "").trim()) {
        const fallback =
          studyContext?.type === "sermon"
            ? `Start sermon on ${studyContext.ref}`
            : `Q&A on ${studyContext.ref}`;
        onSend(fallback);
      }
      return;
    }
    onSend(t);
    setText("");
  }

  return (
    <div className={styles.bar}>
      <form onSubmit={submit}>
        <input
          className={styles.input}
          placeholder={
            disabled ? "Preparing session…" : "Type or record your message…"
          }
          value={text ?? ""} // ← ALWAYS string
          onChange={(e) => setText(e.target.value ?? "")}
          disabled={!!disabled}
        />
        <button type="submit" className={styles.button} disabled={!!disabled}>
          Send
        </button>
      </form>

      <div className={styles.controls}>
        <button
          className={`${styles.mic} ${recording ? styles.active : ""}`}
          onClick={recording ? stopRecording : startRecording}
          disabled={!!disabled || !!transcribing}
          aria-label={recording ? "Stop recording" : "Start recording"}
          title={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? "⏹ Stop" : "🎤 Record"}
        </button>

        {lastAudioUrl ? (
          <button
            className={styles.replay}
            onClick={() => {
              try {
                new Audio(lastAudioUrl!).play();
              } catch {}
            }}
            title="Replay last reply"
            disabled={!!disabled}
          >
            🔁 Replay last reply
          </button>
        ) : null}

        {transcribing && <div className={styles.loading}>Transcribing…</div>}
      </div>
    </div>
  );
}

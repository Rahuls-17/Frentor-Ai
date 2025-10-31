"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ChatInput.module.css";
import { createRecorder } from "@/lib/voice/recorder";

export default function ChatInput({
  onSend,
}: {
  onSend: (txt: string) => void;
}) {
  const [text, setText] = useState("");
  const [recState, setRecState] = useState<
    "idle" | "recording" | "transcribing"
  >("idle");
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const pttDown = useRef(false);

  useEffect(() => {
    if (recState !== "recording") {
      setSec(0);
      return;
    }
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recState]);

  async function handleSend() {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  }

  async function startRec() {
    try {
      setErr(null);
      if (!recorderRef.current) {
        recorderRef.current = createRecorder({
          mimeType: "audio/webm;codecs=opus",
          vad: { enabled: true, silenceMs: 1500, threshold: 0.02 },
          maxDurationMs: 15000,
        });
      }
      await recorderRef.current.start();
      setRecState("recording");
    } catch (e: any) {
      setErr(e?.message || "Mic permission denied or unsupported browser.");
    }
  }

  async function stopRec() {
    try {
      if (!recorderRef.current) return;
      setRecState("transcribing");
      const blob = await recorderRef.current.stop();
      const res = await fetch("/api/stt", {
        method: "POST",
        body: blob,
        headers: { "content-type": blob.type || "audio/webm" },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const transcript = (data?.text || "").toString();
      if (transcript.trim()) {
        setText("");
        onSend(transcript);
      }
    } catch (e: any) {
      setErr(e?.message || "Could not transcribe. Please try again.");
    } finally {
      setRecState("idle");
    }
  }

  function toggleRec() {
    if (recState === "idle") startRec();
    else if (recState === "recording") stopRec();
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.code === "Space" && !pttDown.current && recState === "idle") {
      pttDown.current = true;
      startRec();
      e.preventDefault();
    }
  }
  function onKeyUp(e: React.KeyboardEvent) {
    if (e.code === "Space" && pttDown.current && recState === "recording") {
      pttDown.current = false;
      stopRec();
      e.preventDefault();
    }
  }

  const isRecording = recState === "recording";

  return (
    <div
      className={styles.wrap}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      tabIndex={0}
    >
      <button
        className={isRecording ? styles.micActive : styles.mic}
        onClick={toggleRec}
        onTouchStart={startRec}
        onTouchEnd={stopRec}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        title={
          isRecording
            ? "Stop (click) — or release Space"
            : "Start (click) — or hold Space"
        }
      />
      <span className={styles.hint}>
        {recState === "recording"
          ? `Listening… ${sec}s`
          : recState === "transcribing"
          ? "Transcribing…"
          : ""}
      </span>
      <input
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          recState === "transcribing"
            ? "Transcribing…"
            : "Type your message or use mic"
        }
        disabled={recState === "transcribing"}
      />
      <button
        className={styles.send}
        onClick={handleSend}
        disabled={!text.trim() || recState !== "idle"}
      >
        Send
      </button>
      {err ? <div className={styles.error}>{err}</div> : null}
    </div>
  );
}

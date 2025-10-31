"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./VoiceMic.module.css";
import { createRecorder } from "@/lib/voice/recorder";

export default function VoiceMic({
  sessionId,
  persona,
  mode,
  onTurn,
}: {
  sessionId: string;
  persona: string;
  mode: "friend" | "mentor";
  onTurn?: (userText: string, assistantText: string) => void;
}) {
  const [state, setState] = useState<
    "idle" | "recording" | "transcribing" | "waiting_reply" | "speaking"
  >("idle");
  const [hint, setHint] = useState<string>("Tap to start. Tap again to stop.");
  const [sec, setSec] = useState(0);
  const [lastUser, setLastUser] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const abortTts = useRef<AbortController | null>(null);

  useEffect(() => {
    if (state !== "recording") {
      setSec(0);
      return;
    }
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  async function startRec() {
    try {
      setErr(null);
      if (!recRef.current) {
        recRef.current = createRecorder({
          mimeType: "audio/webm;codecs=opus",
          vad: { enabled: false }, // manual stop only
          maxDurationMs: 120000, // optional safety cap
        });
      }
      await recRef.current.start();
      setState("recording");
      setHint("Recording… Tap again to stop.");
    } catch (e: any) {
      setErr(e?.message || "Mic permission denied or unsupported browser.");
    }
  }

  async function stopRec() {
    try {
      if (!recRef.current) return;
      setState("transcribing");
      setHint("Transcribing…");

      const blob = await recRef.current.stop();

      const stt = await fetch("/api/stt", {
        method: "POST",
        body: blob,
        headers: { "content-type": blob.type || "application/octet-stream" },
      });
      if (!stt.ok) throw new Error(await stt.text());
      const sttData = await stt.json();
      const transcript = (sttData?.text || "").toString();

      if (!transcript.trim()) {
        setHint("Didn’t catch that. Tap to try again.");
        setState("idle");
        return;
      }

      setLastUser(transcript);
      setState("waiting_reply");
      setHint("Thinking…");

      const chat = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          persona,
          mode,
          message: transcript,
        }),
      });
      const data = await chat.json();
      const reply = (data?.reply || "").toString();
      setLastReply(reply);
      onTurn?.(transcript, reply);

      // Always auto-speak the reply (no toggle)
      if (reply) {
        try {
          setState("speaking");
          setHint("Speaking…");
          abortTts.current?.abort();
          abortTts.current = new AbortController();

          // Non-stream: get full MP3 then play from the start (prevents skipped intro)
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: reply }),
            signal: abortTts.current.signal,
          });
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const audio = new Audio();
            audio.src = URL.createObjectURL(
              new Blob([buf], { type: "audio/mpeg" })
            );
            // ensure decode before play to avoid any offset quirks
            await audio.play();
          }
        } catch {
          /* ignore speak errors */
        }
      }

      setHint("Tap to start. Tap again to stop.");
      setState("idle");
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
      setHint("Tap to start. Tap again to stop.");
      setState("idle");
    }
  }

  function onClick() {
    if (state === "idle") startRec();
    else if (state === "recording") stopRec();
  }

  return (
    <div className={styles.centerWrap}>
      <button
        className={state === "recording" ? styles.micActive : styles.mic}
        onClick={onClick}
        aria-label={
          state === "recording" ? "Stop recording" : "Start recording"
        }
      >
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M19 11a7 7 0 0 1-14 0"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path d="M12 18v3" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <div className={styles.hint}>
        {state === "recording" ? `Recording… ${sec}s` : hint}
      </div>
      {lastUser ? (
        <div className={styles.transcript}>
          <strong>You:</strong> {lastUser}
        </div>
      ) : null}
      {lastReply ? (
        <div className={styles.reply}>
          <strong>Paul:</strong> {lastReply}
        </div>
      ) : null}
      {err ? <div className={styles.error}>{err}</div> : null}
    </div>
  );
}

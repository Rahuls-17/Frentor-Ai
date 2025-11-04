// src/app/chat/ChatPageInner.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import ChatBubble from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import { sendToBackend, getHistory, ChatTurn } from "@/lib/api";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Mode = "friend" | "mentor" | "study";
type AnswerMode = "human_pov" | "biblical";

const SID_KEY = "frentor.sessionIds";
const ANSWER_MODE_KEY = "frentor.answerMode";
const STUDY_PREF_KEY = "frentor.studyPref";
const PROFILE_KEY = "frentor.profile.v1"; // profile localStorage key

export default function ChatPageInner() {
  const search = useSearchParams();
  const figure = search?.get("figure") || "paul";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [currentMode, setCurrentMode] = useState<Mode>("friend");
  const [sessionIdByMode, setSessionIdByMode] = useState<Record<Mode, string>>({
    friend: "",
    mentor: "",
    study: "",
  });
  const [answerMode, setAnswerMode] = useState<AnswerMode>("human_pov");
  const [messagesByMode, setMessagesByMode] = useState<
    Record<Mode, ChatTurn[]>
  >({
    friend: [],
    mentor: [],
    study: [],
  });
  const [initialized, setInitialized] = useState<Record<Mode, boolean>>({
    friend: false,
    mentor: false,
    study: false,
  });
  const [loading, setLoading] = useState(false);

  const [studyBook, setStudyBook] = useState<string>("");
  const [studyChapter, setStudyChapter] = useState<string>("");
  const [studyVerses, setStudyVerses] = useState<string>("");

  useEffect(() => {
    if (!mounted) return;

    let ids: any = null;
    try {
      const raw = window.localStorage.getItem(SID_KEY);
      ids = raw ? JSON.parse(raw) : null;
    } catch {
      ids = null;
    }
    if (
      !ids ||
      typeof ids.friend !== "string" ||
      typeof ids.mentor !== "string" ||
      typeof ids.study !== "string" ||
      !ids.friend ||
      !ids.mentor ||
      !ids.study
    ) {
      ids = {
        friend: `friend-${Math.random().toString(36).slice(2, 8)}`,
        mentor: `mentor-${Math.random().toString(36).slice(2, 8)}`,
        study: `study-${Math.random().toString(36).slice(2, 8)}`,
      };
      try {
        window.localStorage.setItem(SID_KEY, JSON.stringify(ids));
      } catch {}
    }
    setSessionIdByMode({
      friend: ids.friend || "",
      mentor: ids.mentor || "",
      study: ids.study || "",
    });

    try {
      const raw = window.localStorage.getItem(ANSWER_MODE_KEY);
      setAnswerMode(raw === "biblical" ? "biblical" : "human_pov");
    } catch {
      setAnswerMode("human_pov");
    }

    try {
      const raw = window.localStorage.getItem(STUDY_PREF_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.ref === "string" && p.ref.includes(" ")) {
          const i = p.ref.indexOf(" ");
          const book = p.ref.slice(0, i) || "";
          const rest = p.ref.slice(i + 1);
          const [ch, v] = (rest || "").split(":");
          setStudyBook(book || "");
          setStudyChapter((ch || "").toString());
          setStudyVerses((v || "").toString());
        } else {
          setStudyBook("Philippians");
          setStudyChapter("2");
          setStudyVerses("1-11");
        }
      } else {
        setStudyBook("Philippians");
        setStudyChapter("2");
        setStudyVerses("1-11");
      }
    } catch {
      setStudyBook("Philippians");
      setStudyChapter("2");
      setStudyVerses("1-11");
    }
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(ANSWER_MODE_KEY, answerMode);
    } catch {}
  }, [mounted, answerMode]);

  useEffect(() => {
    if (!mounted) return;
    const sid = sessionIdByMode[currentMode];
    if (!sid) return;
    if (initialized[currentMode]) return;

    let active = true;
    (async () => {
      try {
        const res = await getHistory(sid, figure, currentMode);
        if (!active) return;
        const recent: ChatTurn[] =
          Array.isArray(res?.recent) && res.recent.length
            ? res.recent
            : [
                {
                  role: "assistant",
                  content:
                    currentMode === "friend"
                      ? "Hi! I’m Saint Paul (Friend). What’s on your heart today?"
                      : currentMode === "mentor"
                      ? "I’m Saint Paul (Mentor). Share briefly; we’ll take a next step."
                      : "I’m Saint Paul (Study). Choose Book, Chapter, and Verses, then press Send.",
                },
              ];
        setMessagesByMode((m) => ({ ...m, [currentMode]: recent }));
        setInitialized((s) => ({ ...s, [currentMode]: true }));
      } catch {
        if (!active) return;
        setMessagesByMode((m) => ({
          ...m,
          [currentMode]: [
            {
              role: "assistant",
              content:
                currentMode === "friend"
                  ? "Hi! I’m Saint Paul (Friend). What’s on your heart today?"
                  : currentMode === "mentor"
                  ? "I’m Saint Paul (Mentor). Share briefly; we’ll take a next step."
                  : "I’m Saint Paul (Study). Choose Book, Chapter, and Verses, then press Send.",
            },
          ],
        }));
        setInitialized((s) => ({ ...s, [currentMode]: true }));
      }
    })();

    return () => {
      active = false;
    };
  }, [mounted, sessionIdByMode, currentMode, initialized, figure]);

  const onSend = async (text: string) => {
    const sid = sessionIdByMode[currentMode];
    if (!sid) return;

    setMessagesByMode((m) => ({
      ...m,
      [currentMode]: [...m[currentMode], { role: "user", content: text }],
    }));

    setLoading(true);
    try {
      const studyRef =
        currentMode === "study"
          ? `${studyBook || ""} ${studyChapter || ""}:${studyVerses || ""}`
          : undefined;

      if (currentMode === "study") {
        try {
          window.localStorage.setItem(
            STUDY_PREF_KEY,
            JSON.stringify({ ref: studyRef })
          );
        } catch {}
      }

      const profileData = (() => {
        try {
          const raw = window.localStorage.getItem(PROFILE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })();

      const res = await sendToBackend({
        sessionId: sid,
        text,
        figure,
        mode: currentMode,
        answerMode,
        study: currentMode === "study" ? { ref: studyRef } : undefined,
        profile: profileData,
      } as any);

      const reply = res?.reply ?? "(no reply)";
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
          { role: "assistant", content: `Oops: ${e?.message ?? "error"}` },
        ],
      }));
    } finally {
      setLoading(false);
    }
  };

  const studyRef = useMemo(
    () =>
      `${(studyBook || "").trim()} ${(studyChapter || "").trim()}:${(
        studyVerses || ""
      ).trim()}`,
    [studyBook, studyChapter, studyVerses]
  );

  const messages = messagesByMode[currentMode];
  const sidReady = mounted && !!sessionIdByMode[currentMode];

  if (!mounted) {
    return (
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.titleBox}>
              <h1 className={styles.title}>Frentor Chat</h1>
              <p className={styles.sub}>
                Persona: Saint Paul • Mode: FRIEND • Answer: Human POV
              </p>
            </div>
            <div className={styles.controls}>
              <span style={{ fontSize: 13, opacity: 0.7 }}>Profile</span>
            </div>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.loading}>Preparing session…</div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        {/* same header, controls, and study bar UI */}
        {/* unchanged UI logic */}
      </header>

      <main className={styles.main}>
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} />
        ))}
        {loading && <div className={styles.loading}>Thinking…</div>}
      </main>

      <ChatInput
        onSend={onSend}
        disabled={!sidReady}
        studyContext={{ mode: currentMode, ref: studyRef }}
      />
    </div>
  );
}

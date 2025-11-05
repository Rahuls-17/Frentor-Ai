// src/app/chat/ChatPageInner.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import ChatBubble from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import {
  sendToBackend,
  getHistory,
  saveLearningJournal,
  ChatTurn,
} from "@/lib/api";
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

  // Recap + Journal state
  const [recapping, setRecapping] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [journalText, setJournalText] = useState("");

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

      // ✅ NEW: Read profile from localStorage and include in payload
      let profile: any = null;
      try {
        const raw = window.localStorage.getItem(PROFILE_KEY);
        profile = raw ? JSON.parse(raw) : null;
      } catch {
        profile = null;
      }

      const res = await sendToBackend({
        sessionId: sid,
        text,
        figure,
        mode: currentMode,
        answerMode,
        study: currentMode === "study" ? { ref: studyRef } : undefined,
        profile, // 👈 included
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

  const onRecap = async () => {
    const sid = sessionIdByMode[currentMode];
    if (!sid || recapping) return;
    setRecapping(true);
    try {
      // Pass mode so server can do a mode-aware, second-person recap
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recap",
          sessionId: sid,
          mode: currentMode,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const recap = json?.recap || "No recap available.";

      // Show recap as the final assistant message
      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [{ role: "assistant", content: recap }],
      }));

      // Rotate to a new session id for this mode
      const newId = `${currentMode}-${Math.random().toString(36).slice(2, 8)}`;
      const next = { ...sessionIdByMode, [currentMode]: newId };
      setSessionIdByMode(next);
      try {
        window.localStorage.setItem(SID_KEY, JSON.stringify(next));
      } catch {}

      // After recap, show the journal card
      setShowJournal(true);
      setJournalText("");
    } catch (e: any) {
      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [
          ...m[currentMode],
          {
            role: "assistant",
            content: `Recap failed: ${e?.message ?? "error"}`,
          },
        ],
      }));
    } finally {
      setRecapping(false);
    }
  };

  const onSaveJournal = async () => {
    const sid = sessionIdByMode[currentMode]; // new session id (after recap)
    if (!sid || !journalText.trim()) {
      setShowJournal(false);
      return;
    }
    try {
      const studyRef =
        currentMode === "study"
          ? `${studyBook || ""} ${studyChapter || ""}:${studyVerses || ""}`
          : undefined;
      await saveLearningJournal({
        sessionId: sid,
        text: journalText.trim(),
        mode: currentMode,
        studyRef,
      });
      setShowJournal(false);
      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [
          ...m[currentMode],
          { role: "assistant", content: "Saved your learning & feelings. 🙏" },
        ],
      }));
    } catch (e: any) {
      setShowJournal(false);
      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [
          ...m[currentMode],
          {
            role: "assistant",
            content: `Couldn't save journal: ${e?.message ?? "error"}`,
          },
        ],
      }));
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
        <div className={styles.headerInner}>
          <div className={styles.titleBox}>
            <h1 className={styles.title}>Frentor Chat</h1>
            <p className={styles.sub}>
              Persona: Saint Paul • Mode: {currentMode.toUpperCase()} • Answer{" "}
              {answerMode === "human_pov" ? "Human POV" : "Biblical POV"}
            </p>
          </div>

          <div className={styles.controls}>
            <div className={styles.modeToggle} role="tablist">
              {(["friend", "mentor", "study"] as Mode[]).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={currentMode === m}
                  className={`${styles.toggleBtn} ${
                    currentMode === m ? styles.toggleBtnActive : ""
                  }`}
                  onClick={() => setCurrentMode(m)}
                >
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>

            <div className={styles.smallToggle}>
              <label>
                <input
                  type="checkbox"
                  checked={answerMode === "biblical"}
                  onChange={(e) =>
                    setAnswerMode(e.target.checked ? "biblical" : "human_pov")
                  }
                />{" "}
                Biblical POV
              </label>
            </div>

            {/* Recap button */}
            <button
              onClick={onRecap}
              disabled={!sidReady || recapping || loading}
              title="Summarize and close this session"
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid #d9dbe0",
                background: "#f7f9fc",
                fontSize: 13,
                fontWeight: 600,
                cursor:
                  !sidReady || recapping || loading ? "not-allowed" : "pointer",
                opacity: !sidReady || recapping || loading ? 0.6 : 1,
              }}
            >
              {recapping ? "Summarizing…" : "Recap"}
            </button>

            <Link href="/profile" className={styles.profileBtn}>
              <svg
                className={styles.profileIcon}
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M6 20c0-3.333 3-6 6-6s6 2.667 6 6"></path>
              </svg>
              <span className={styles.profileText}>Profile</span>
            </Link>
          </div>
        </div>

        {currentMode === "study" && (
          <div className={styles.studyBar}>
            <div className={styles.studyRow}>
              <input
                className={styles.studyInput}
                value={studyBook ?? ""}
                onChange={(e) => setStudyBook(e.target.value ?? "")}
                placeholder="Book (e.g., Philippians)"
              />
              <input
                className={styles.studyInputSmall}
                value={studyChapter ?? ""}
                onChange={(e) => setStudyChapter(e.target.value ?? "")}
                placeholder="Chapter (e.g., 2)"
              />
              <input
                className={styles.studyInputSmall}
                value={studyVerses ?? ""}
                onChange={(e) => setStudyVerses(e.target.value ?? "")}
                placeholder="Verse(s) (e.g., 1-11)"
              />
            </div>
            <div className={styles.studyHint}>
              Tip: Press Send with an empty box to start a study on {studyRef}.
            </div>
          </div>
        )}
      </header>

      <main className={styles.main}>
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} />
        ))}
        {(loading || recapping) && (
          <div className={styles.loading}>
            {loading ? "Thinking…" : "Wrapping up…"}
          </div>
        )}

        {/* Inline journal card shown only after a recap */}
        {showJournal && (
          <div
            style={{
              border: "1px solid #e6e8eb",
              borderRadius: 12,
              padding: 12,
              background: "#fafbfe",
              marginTop: 8,
              display: "flex",
              gap: 8,
              flexDirection: "column",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              What did you learn today, and how did it make you feel?
            </div>
            <textarea
              value={journalText}
              onChange={(e) => setJournalText(e.target.value ?? "")}
              placeholder="Write a short reflection…"
              rows={4}
              style={{
                width: "100%",
                border: "1px solid #d7dbe0",
                borderRadius: 10,
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 14,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onSaveJournal}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid #d9dbe0",
                  background: "#0b7a44",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                onClick={() => setShowJournal(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid #d9dbe0",
                  background: "#f7f9fc",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </main>

      <ChatInput
        onSend={onSend}
        disabled={!sidReady || recapping}
        studyContext={{ mode: currentMode, ref: studyRef }}
      />
    </div>
  );
}

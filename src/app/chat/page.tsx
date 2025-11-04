// C:\Users\singh\OneDrive\Desktop\farAlpha\Frentor-AI-nextjs-hybird\Frentor-Ai\src\app\chat\page.tsx
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
type StudyType = "sermon" | "qna";

const SID_KEY = "frentor.sessionIds";
const AUTOSPEAK_KEY = "frentor.autospeak";
const ANSWER_MODE_KEY = "frentor.answerMode";
const STUDY_PREF_KEY = "frentor.studyPref";

export default function ChatPage() {
  const search = useSearchParams();
  const figure = search?.get("figure") || "paul";

  // Hydration-safe mount gate
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [currentMode, setCurrentMode] = useState<Mode>("friend");

  const [sessionIdByMode, setSessionIdByMode] = useState<Record<Mode, string>>({
    friend: "",
    mentor: "",
    study: "",
  });

  const [answerMode, setAnswerMode] = useState<AnswerMode>("human_pov");

  const [autospeakByMode, setAutospeakByMode] = useState<Record<Mode, boolean>>(
    {
      friend: false,
      mentor: false,
      study: false,
    }
  );

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

  // Study controls (ALWAYS strings)
  const [studyBook, setStudyBook] = useState<string>("");
  const [studyChapter, setStudyChapter] = useState<string>("");
  const [studyVerses, setStudyVerses] = useState<string>("");
  const [studyType, setStudyType] = useState<StudyType>("qna");

  // After mount, read localStorage safely and coalesce to defaults
  useEffect(() => {
    if (!mounted) return;

    // session ids
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

    // answer mode
    try {
      const raw = window.localStorage.getItem(ANSWER_MODE_KEY);
      setAnswerMode(raw === "biblical" ? "biblical" : "human_pov");
    } catch {
      setAnswerMode("human_pov");
    }

    // autospeak
    try {
      const raw = window.localStorage.getItem(AUTOSPEAK_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      setAutospeakByMode({
        friend: !!obj.friend,
        mentor: !!obj.mentor,
        study: !!obj.study,
      });
    } catch {
      setAutospeakByMode({ friend: false, mentor: false, study: false });
    }

    // study prefs
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
        }
        if (p?.type === "sermon" || p?.type === "qna") setStudyType(p.type);
      } else {
        // defaults
        setStudyBook("Philippians");
        setStudyChapter("2");
        setStudyVerses("1-11");
        setStudyType("qna");
      }
    } catch {
      setStudyBook("Philippians");
      setStudyChapter("2");
      setStudyVerses("1-11");
      setStudyType("qna");
    }
  }, [mounted]);

  // persist toggles (client-only)
  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(
        AUTOSPEAK_KEY,
        JSON.stringify(autospeakByMode)
      );
    } catch {}
  }, [mounted, autospeakByMode]);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(ANSWER_MODE_KEY, answerMode);
    } catch {}
  }, [mounted, answerMode]);

  // Fetch history once per mode after we have SID
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
                      : "I’m Saint Paul (Study). Choose Book/Chapter/Verses + Sermon or Q&A, then press Send.",
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
                  : "I’m Saint Paul (Study). Choose Book/Chapter/Verses + Sermon or Q&A, then press Send.",
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

  // Last audio URL for footer replay
  const lastAudioUrl = useMemo(() => {
    const arr = messagesByMode[currentMode];
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = arr[i] as any;
      if (t.role === "assistant" && t.audioUrl) return t.audioUrl as string;
    }
    return null;
  }, [messagesByMode, currentMode]);

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
            JSON.stringify({ ref: studyRef, type: studyType })
          );
        } catch {}
      }

      const res = await sendToBackend({
        sessionId: sid,
        text,
        figure,
        mode: currentMode,
        answerMode,
        autospeak: autospeakByMode[currentMode],
        study:
          currentMode === "study"
            ? { ref: studyRef, type: studyType }
            : undefined,
      });

      const reply = res?.reply ?? "(no reply)";
      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [
          ...m[currentMode],
          { role: "assistant", content: reply, audioUrl: res?.audioUrl },
        ],
      }));

      if (autospeakByMode[currentMode] && res?.audioUrl) {
        try {
          await new Audio(res.audioUrl).play();
        } catch {}
      }
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
    // ---------- SHELL RENDER (pre-hydration) ----------
    // Keep inputs controlled to avoid uncontrolled→controlled flip after hydration. :contentReference[oaicite:4]{index=4}
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
              <div className={styles.modeToggle}>
                <button
                  className={`${styles.toggleBtn} ${styles.toggleBtnActive}`}
                >
                  Friend
                </button>
                <button className={styles.toggleBtn}>Mentor</button>
                <button className={styles.toggleBtn}>Study</button>
              </div>

              <div className={styles.smallToggle}>
                <label>
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => {}}
                    readOnly
                  />{" "}
                  Biblical POV
                </label>
              </div>

              <div className={styles.smallToggle}>
                <label>
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => {}}
                    readOnly
                  />{" "}
                  Autospeak
                </label>
              </div>

              <span style={{ fontSize: 13, opacity: 0.7 }}>Profile</span>
            </div>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.loading}>Preparing session…</div>
        </main>
        <div className={styles.footerShell}>
          <div className={styles.footerInputShell}>Preparing session…</div>
        </div>
      </div>
    );
  }

  // ---------- REAL RENDER (after mount) ----------
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.titleBox}>
            <h1 className={styles.title}>Frentor Chat</h1>
            <p className={styles.sub}>
              Persona: Saint Paul • Mode: {currentMode.toUpperCase()} • Answer:{" "}
              {answerMode === "human_pov" ? "Human POV" : "Biblical POV"}
            </p>
          </div>

          <div className={styles.controls}>
            <div
              className={styles.modeToggle}
              role="tablist"
              aria-label="Chat mode"
            >
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

            <div className={styles.smallToggle}>
              <label>
                <input
                  type="checkbox"
                  checked={!!autospeakByMode[currentMode]}
                  onChange={(e) =>
                    setAutospeakByMode((prev) => ({
                      ...prev,
                      [currentMode]: !!e.target.checked,
                    }))
                  }
                />{" "}
                Autospeak
              </label>
            </div>

            <Link href="/profile" style={{ fontSize: 13 }}>
              Profile
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
                aria-label="Book"
              />
              <input
                className={styles.studyInputSmall}
                value={studyChapter ?? ""}
                onChange={(e) => setStudyChapter(e.target.value ?? "")}
                placeholder="Ch"
                aria-label="Chapter"
              />
              <input
                className={styles.studyInputSmall}
                value={studyVerses ?? ""}
                onChange={(e) => setStudyVerses(e.target.value ?? "")}
                placeholder="Verses (e.g. 1-11)"
                aria-label="Verses"
              />

              <div className={styles.studyType}>
                <label>
                  <input
                    type="radio"
                    name="studyType"
                    checked={studyType === "qna"}
                    onChange={() => setStudyType("qna")}
                  />{" "}
                  Q&A
                </label>
                <label>
                  <input
                    type="radio"
                    name="studyType"
                    checked={studyType === "sermon"}
                    onChange={() => setStudyType("sermon")}
                  />{" "}
                  3-min Sermon
                </label>
              </div>
            </div>
            <div className={styles.studyHint}>
              Tip: Press Send with an empty box to start{" "}
              {studyType.toUpperCase()} on{" "}
              {`${(studyBook || "").trim()} ${(studyChapter || "").trim()}:${(
                studyVerses || ""
              ).trim()}`}
              .
            </div>
          </div>
        )}
      </header>

      <main className={styles.main}>
        {messages.map((m, i) => (
          <ChatBubble
            key={i}
            role={m.role}
            content={m.content}
            audioUrl={(m as any).audioUrl}
          />
        ))}
        {loading && <div className={styles.loading}>Thinking…</div>}
      </main>

      <ChatInput
        onSend={onSend}
        disabled={!sidReady}
        studyContext={{
          mode: currentMode,
          ref: studyRef,
          type: studyType,
        }}
        lastAudioUrl={lastAudioUrl}
      />
    </div>
  );
}

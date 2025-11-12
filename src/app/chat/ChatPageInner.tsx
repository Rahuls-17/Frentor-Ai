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

type Mode = "friend" | "mentor" | "study";

const SID_KEY = "frentor.sessionIds";
const PROFILE_KEY = "frentor.profile.v1";

const personas = [{ id: "paul", name: "Saint Paul" }];

type Verse = { verse: number; text: string };
type ChapterData = {
  book: string;
  chapter: number;
  translation: string;
  verses: Verse[];
};
type CommentaryNote = { range: string; excerpt: string };
type CommentaryData = {
  book: string;
  chapter: number;
  source: string;
  notes: CommentaryNote[];
};

function parseRef(
  ref: string | null
): { book: string; chapter: number; verses: number[] } | null {
  if (!ref) return null;
  const m = ref.match(/^(.+)\s+(\d+):([\d\-\,]+)$/);
  if (!m) return null;
  const book = m[1].trim();
  const chapter = parseInt(m[2], 10);
  const verseSpec = m[3].trim();
  const verses: number[] = [];
  verseSpec.split(",").forEach((part) => {
    const range = part.split("-").map((x) => parseInt(x, 10));
    if (range.length === 1 || isNaN(range[1])) {
      if (!isNaN(range[0])) verses.push(range[0]);
    } else {
      const [a, b] = range;
      for (let v = a; v <= b; v++) verses.push(v);
    }
  });
  return { book, chapter, verses };
}

function bookIdFromName(name: string): string {
  return name.toLowerCase();
}

function pickCommentaryForVerses(
  notes: CommentaryNote[],
  verses: number[]
): CommentaryNote[] {
  const result: CommentaryNote[] = [];
  for (const n of notes) {
    const [a, b] = n.range.split("-").map((x) => parseInt(x, 10));
    const start = isNaN(a) ? 0 : a;
    const end = isNaN(b) ? start : b;
    for (let x = start; x <= end; x++) {
      if (verses.includes(x)) {
        result.push(n);
        break;
      }
    }
  }
  return result.length ? result : notes.slice(0, 1);
}

export default function ChatPageInner() {
  const search = useSearchParams();

  // Persona can come from /study flow or be chosen in-chat
  const personaFromQuery = search?.get("persona") || undefined;
  const [figure, setFigure] = useState<string>(personaFromQuery || "paul");

  const modeFromQuery = (search?.get("mode") || "friend").toLowerCase() as Mode;
  const [currentMode, setCurrentMode] = useState<Mode>(
    modeFromQuery === "study" || modeFromQuery === "mentor"
      ? modeFromQuery
      : "friend"
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [sessionIdByMode, setSessionIdByMode] = useState<Record<Mode, string>>({
    friend: "",
    mentor: "",
    study: "",
  });

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

  // Interpretation card state (when ref/persona provided)
  const refParam = search?.get("ref") || null;
  const srcParam = (search?.get("source") || "web").toLowerCase();
  const commParam = (search?.get("commentary") || "henry").toLowerCase();

  const [verseData, setVerseData] = useState<Verse[] | null>(null);
  const [commentary, setCommentary] = useState<CommentaryNote[] | null>(null);
  const [interpLoading, setInterpLoading] = useState(false);

  // Reset messages when persona changes
  useEffect(() => {
    setInitialized({ friend: false, mentor: false, study: false });
    setMessagesByMode({ friend: [], mentor: [], study: [] });
  }, [figure]);

  // Basic client-side SID init
  useEffect(() => {
    if (!mounted) return;
    let ids: any = null;
    try {
      const raw = window.localStorage.getItem(SID_KEY);
      ids = raw ? JSON.parse(raw) : null;
    } catch {}
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
      window.localStorage.setItem(SID_KEY, JSON.stringify(ids));
    }
    setSessionIdByMode(ids);
  }, [mounted]);

  // Load chat history/greeting per mode/persona
  useEffect(() => {
    if (!mounted) return;
    const sid = sessionIdByMode[currentMode];
    if (!sid || initialized[currentMode]) return;

    let active = true;
    (async () => {
      try {
        const res = await getHistory(sid, figure, currentMode);
        if (!active) return;
        const personaName =
          personas.find((p) => p.id === figure)?.name || "Saint Paul";
        const recent: ChatTurn[] =
          Array.isArray(res?.recent) && res.recent.length
            ? res.recent
            : [
                {
                  role: "assistant",
                  content:
                    currentMode === "friend"
                      ? `Hi! I’m ${personaName} (Friend). What’s on your heart today?`
                      : currentMode === "mentor"
                      ? `I’m ${personaName} (Mentor). Share briefly; we’ll take a next step.`
                      : `I’m ${personaName} (Study). We’ll focus on the verse you selected from the Study page.`,
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
                  : "I’m Saint Paul (Study). We’ll focus on the verse you selected from the Study page.",
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

  // If arriving from /study with a ref, fetch verse + commentary and show an interpretation card
  useEffect(() => {
    if (!mounted) return;
    if (currentMode !== "study") return;
    const parsed = parseRef(refParam);
    if (!parsed) return;

    const { book, chapter, verses } = parsed;

    const load = async () => {
      setInterpLoading(true);
      try {
        const bookId = bookIdFromName(book);
        const verseRes = await fetch(
          `/data/bible/${srcParam}/${bookId}/${chapter}.json`
        );
        const verseJson = (await verseRes.json()) as ChapterData;
        const selectedVerses = verseJson.verses.filter((v) =>
          verses.includes(v.verse)
        );
        setVerseData(
          selectedVerses.length ? selectedVerses : verseJson.verses.slice(0, 1)
        );

        const commRes = await fetch(
          `/data/commentaries/${commParam}/${bookId}/${chapter}.json`
        );
        const commJson = (await commRes.json()) as CommentaryData;
        const notes = pickCommentaryForVerses(commJson.notes, verses);
        setCommentary(notes);
      } catch (e) {
        console.error("Interpretation load failed", e);
        setVerseData(null);
        setCommentary(null);
      } finally {
        setInterpLoading(false);
      }
    };
    load();
  }, [mounted, currentMode, refParam, srcParam, commParam]);

  const onSend = async (text: string) => {
    const sid = sessionIdByMode[currentMode];
    if (!sid) return;

    setMessagesByMode((m) => ({
      ...m,
      [currentMode]: [...m[currentMode], { role: "user", content: text }],
    }));

    setLoading(true);
    try {
      // Use the ref from the URL when in study mode
      const studyRef =
        currentMode === "study" ? refParam ?? undefined : undefined;

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
        study: currentMode === "study" ? { ref: studyRef } : undefined,
        profile,
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

      setMessagesByMode((m) => ({
        ...m,
        [currentMode]: [{ role: "assistant", content: recap }],
      }));

      const newId = `${currentMode}-${Math.random().toString(36).slice(2, 8)}`;
      const next = { ...sessionIdByMode, [currentMode]: newId };
      setSessionIdByMode(next);
      try {
        window.localStorage.setItem(SID_KEY, JSON.stringify(next));
      } catch {}

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
    const sid = sessionIdByMode[currentMode];
    if (!sid || !journalText.trim()) {
      setShowJournal(false);
      return;
    }
    try {
      await saveLearningJournal({
        sessionId: sid,
        text: journalText.trim(),
        mode: currentMode,
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

  const studyRef = useMemo(() => refParam ?? "", [refParam]);

  const messages = messagesByMode[currentMode];
  const sidReady = mounted && !!sessionIdByMode[currentMode];

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.titleBox}>
            <p className={styles.sub}>
              Persona:{" "}
              {personas.find((p) => p.id === figure)?.name || "Saint Paul"} •
              Mode: {currentMode.toUpperCase()}
            </p>
          </div>

          <div className={styles.controls}>
            {/* Persona picker inside Chat */}
            <div className={styles.personaPicker}>
              <label htmlFor="persona" className={styles.personaLabel}>
                Persona
              </label>
              <select
                id="persona"
                className={styles.personaSelect}
                value={figure}
                onChange={(e) => setFigure(e.target.value)}
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

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

            <button
              onClick={onRecap}
              disabled={!sidReady || recapping || loading}
              className={styles.recapBtn}
              title="Summarize and close this session"
            >
              {recapping ? "Summarizing…" : "Recap"}
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {/* Interpretation card if navigated from Study with a ref */}
        {currentMode === "study" && refParam && (
          <div
            style={{
              border: "1px solid #e6e8eb",
              borderRadius: 12,
              padding: 12,
              background: "#fafbfe",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {refParam} • {srcParam.toUpperCase()} • Guide:{" "}
              {personas.find((p) => p.id === figure)?.name || "Saint Paul"}
            </div>
            {interpLoading && (
              <div style={{ fontSize: 13, color: "#666" }}>
                Loading interpretation…
              </div>
            )}
            {!interpLoading && verseData && (
              <div style={{ display: "grid", gap: 6 }}>
                {verseData.map((v) => (
                  <div key={v.verse} style={{ fontSize: 14 }}>
                    <span style={{ fontWeight: 700, marginRight: 6 }}>
                      {v.verse}
                    </span>
                    <span>{v.text}</span>
                  </div>
                ))}
              </div>
            )}
            {!interpLoading && commentary && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                  Commentary (Henry, sample)
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {commentary.map((n, i) => (
                    <div
                      key={i}
                      style={{
                        border: "1px solid #e6e8eb",
                        borderRadius: 10,
                        background: "#fff",
                        padding: "8px 10px",
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Verses {n.range}
                      </div>
                      <div>{n.excerpt}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chat thread */}
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} />
        ))}
        {(loading || recapping) && (
          <div className={styles.loading}>
            {loading ? "Thinking…" : "Wrapping up…"}
          </div>
        )}

        {/* Post-recap journal */}
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

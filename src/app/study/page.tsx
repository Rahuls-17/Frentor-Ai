// src/app/study/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type BookMeta = {
  id: string;
  name: string;
  abbr: string;
  testament: "OT" | "NT";
  chapters: { number: number; verses: number }[];
};

type BooksFile = {
  translation: string;
  books: BookMeta[];
};

type Verse = { verse: number; text: string };
type ChapterData = {
  book: string;
  chapter: number;
  translation: string;
  verses: Verse[];
};

const PERSONAS = [{ id: "paul", name: "Saint Paul (guide)" }];

export default function StudyBrowser() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [booksFile, setBooksFile] = useState<BooksFile | null>(null);
  const [activeBook, setActiveBook] = useState<BookMeta | null>(null);
  const [activeChapter, setActiveChapter] = useState<number>(1);
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);

  // Action sheet state
  const [clickedVerse, setClickedVerse] = useState<Verse | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string>("paul");

  // Mobile detection (for conditional UI bits if needed)
  const [isMobile, setIsMobile] = useState<boolean>(false);
  useEffect(() => {
    const detect = () => setIsMobile(window.innerWidth <= 560);
    detect();
    window.addEventListener("resize", detect);
    return () => window.removeEventListener("resize", detect);
  }, []);

  // Load books meta
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/data/bible/meta/books.json");
        const json = (await res.json()) as BooksFile;
        if (!active) return;
        setBooksFile(json);
        const b = json.books[0];
        setActiveBook(b);
        setActiveChapter(1);
      } catch (e) {
        console.error("Failed to load books.json", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load chapter content
  useEffect(() => {
    if (!activeBook) return;
    let active = true;
    (async () => {
      try {
        const path = `/data/bible/web/${activeBook.id}/${activeChapter}.json`;
        const res = await fetch(path);
        const json = (await res.json()) as ChapterData;
        if (!active) return;
        setChapterData(json);
      } catch (e) {
        console.error("Failed to load chapter data", e);
        setChapterData(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [activeBook, activeChapter]);

  const books = booksFile?.books ?? [];
  const chapters = useMemo(
    () => activeBook?.chapters?.map((c) => c.number) ?? [],
    [activeBook]
  );

  const onClickVerse = (v: Verse) => {
    setClickedVerse(v);
    setShowActions(true);
    setShowPersonaPicker(false);
  };

  const onChooseInterpretation = () => {
    setShowActions(false);
    setShowPersonaPicker(true);
  };

  const onConfirmPersona = () => {
    if (!activeBook || !clickedVerse) return;
    const ref = `${activeBook.name} ${activeChapter}:${clickedVerse.verse}`;
    const persona = selectedPersona;
    const url = `/chat?mode=study&ref=${encodeURIComponent(
      ref
    )}&persona=${encodeURIComponent(persona)}&source=web&commentary=henry`;
    router.push(url);
  };

  return (
    <main className={styles.page}>
      <div className={styles.grid}>
        {/* Books (desktop sidebar) */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>Books</div>
          <div className={styles.sidebarScroll}>
            {loading && <div className={styles.loading}>Loading…</div>}
            {!loading &&
              books.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setActiveBook(b);
                    setActiveChapter(1);
                  }}
                  className={`${styles.bookBtn} ${
                    activeBook?.id === b.id ? styles.bookBtnActive : ""
                  }`}
                >
                  {b.name}
                </button>
              ))}
          </div>
        </aside>

        {/* Main: verses panel */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div className={styles.title}>
              {activeBook ? `${activeBook.name}` : "Verses"}
              {activeBook ? ` • Chapter ${activeChapter}` : ""}
              {activeBook ? " (WEB)" : ""}
            </div>

            {/* Desktop controls area */}
            <div className={styles.headerControls}>
              {/* On mobile, book select appears in the mobileControls below */}
              <select
                value={activeChapter}
                onChange={(e) => setActiveChapter(Number(e.target.value))}
                className={styles.select}
              >
                {chapters.map((n) => (
                  <option key={n} value={n}>
                    Ch. {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Mobile-only top controls */}
          <div className={styles.mobileControls}>
            <select
              value={activeBook?.id || ""}
              onChange={(e) => {
                const b = books.find((x) => x.id === e.target.value);
                if (!b) return;
                setActiveBook(b);
                setActiveChapter(1);
              }}
              className={styles.select}
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            <select
              value={activeChapter}
              onChange={(e) => setActiveChapter(Number(e.target.value))}
              className={styles.select}
            >
              {chapters.map((n) => (
                <option key={n} value={n}>
                  Ch. {n}
                </option>
              ))}
            </select>
          </div>

          {/* Verses list */}
          <div className={styles.verses}>
            {chapterData?.verses?.map((v) => (
              <div
                key={v.verse}
                onClick={() => onClickVerse(v)}
                className={styles.verseCard}
                title="Tap for options"
              >
                <span className={styles.verseNum}>{v.verse}</span>
                <span className={styles.verseText}>{v.text}</span>
              </div>
            ))}

            {!chapterData && (
              <div className={styles.empty}>
                No verses loaded. (Sample includes John 1 only.)
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Bottom sheet: verse actions */}
      {showActions && clickedVerse && (
        <div
          className={styles.sheetOverlay}
          onClick={() => setShowActions(false)}
        >
          <div
            className={`${styles.sheet} ${styles.sheetBottom}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetTitle}>Verse {clickedVerse.verse}</div>
            <div className={styles.sheetText}>{clickedVerse.text}</div>
            <button
              onClick={onChooseInterpretation}
              className={styles.ctaPrimary}
            >
              Interpretation
            </button>
            <div className={styles.sheetHint}>Tap outside to close</div>
          </div>
        </div>
      )}

      {/* Bottom sheet: persona picker */}
      {showPersonaPicker && clickedVerse && (
        <div
          className={styles.sheetOverlay}
          onClick={() => setShowPersonaPicker(false)}
        >
          <div
            className={`${styles.sheet} ${styles.sheetBottom}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetTitle}>Choose persona</div>

            <select
              value={selectedPersona}
              onChange={(e) => setSelectedPersona(e.target.value)}
              className={styles.selectWide}
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <button onClick={onConfirmPersona} className={styles.ctaSuccess}>
              Continue to Chat (Study)
            </button>

            <div className={styles.sheetHint}>Tap outside to close</div>
          </div>
        </div>
      )}
    </main>
  );
}

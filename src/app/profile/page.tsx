"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type ProfileData = {
  name: string;
  age: string; // keep as string for easy input handling
  country: string;
  journaling: string;
  goals: string[]; // one goal per line
  pastActivities: string[]; // one activity per line
};

const LS_KEY = "frentor.profile.v1";

const DEFAULT_PROFILE: ProfileData = {
  name: "John Doe",
  age: "28",
  country: "India",
  journaling:
    "I want to grow in patience and learn to love others like Christ. Help me build a daily habit.",
  goals: [
    "Read 1 chapter daily",
    "Weekly reflection on purpose",
    "Pray morning & evening",
  ],
  pastActivities: [
    "Mentor chat (Paul) — Purpose of life",
    "Study — Philippians 2:1-11 (Q&A)",
    "Friend chat — dealing with stress",
  ],
};

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setData({
          name: parsed?.name ?? DEFAULT_PROFILE.name,
          age: parsed?.age ?? DEFAULT_PROFILE.age,
          country: parsed?.country ?? DEFAULT_PROFILE.country,
          journaling: parsed?.journaling ?? DEFAULT_PROFILE.journaling,
          goals: Array.isArray(parsed?.goals)
            ? parsed.goals
            : DEFAULT_PROFILE.goals,
          pastActivities: Array.isArray(parsed?.pastActivities)
            ? parsed.pastActivities
            : DEFAULT_PROFILE.pastActivities,
        });
      }
    } catch {
      // ignore, stick to defaults
    } finally {
      setLoaded(true);
    }
  }, []);

  function save() {
    setSaving(true);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      // nice little saved tick
      setSavedTick((x) => x + 1);
    } finally {
      setSaving(false);
    }
  }

  // controlled inputs
  const setField = <K extends keyof ProfileData>(
    key: K,
    value: ProfileData[K]
  ) => {
    setData((d) => ({ ...d, [key]: value }));
  };

  // textarea <-> array helpers
  const goalsText = (data.goals || []).join("\n");
  const activitiesText = (data.pastActivities || []).join("\n");

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.titleBox}>
            <h1 className={styles.title}>Profile</h1>
            <p className={styles.sub}>
              These are the only profile fields stored. You can edit and save
              anytime.
            </p>
          </div>

          <div className={styles.actions}>
            <Link href="/chat?figure=paul" className={styles.backBtn}>
              ← Back to Chat
            </Link>
            <button
              className={styles.saveBtn}
              onClick={save}
              disabled={!loaded || saving}
              aria-live="polite"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>Basics</h3>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input
                className={styles.input}
                value={data.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Your name"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Age</label>
              <input
                className={styles.input}
                inputMode="numeric"
                value={data.age}
                onChange={(e) => {
                  // keep only digits
                  const onlyDigits = e.target.value.replace(/[^\d]/g, "");
                  setField("age", onlyDigits);
                }}
                placeholder="Age"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Country</label>
              <select
                className={styles.select}
                value={data.country}
                onChange={(e) => setField("country", e.target.value)}
              >
                {/* small, safe list — extend later if needed */}
                <option>India</option>
                <option>United States</option>
                <option>United Kingdom</option>
                <option>Singapore</option>
                <option>Canada</option>
                <option>Australia</option>
                <option>Other</option>
              </select>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>Journaling</h3>
          <textarea
            className={styles.textarea}
            rows={6}
            value={data.journaling}
            onChange={(e) => setField("journaling", e.target.value)}
            placeholder="Your personal reflections, prayers, or faith journey notes…"
          />
        </section>

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>Goals</h3>
          <p className={styles.help}>
            Enter one goal per line. (Only these are saved.)
          </p>
          <textarea
            className={styles.textarea}
            rows={5}
            value={goalsText}
            onChange={(e) =>
              setField(
                "goals",
                (e.target.value || "")
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            placeholder={`e.g.\nRead 1 chapter daily\nWeekly reflection on purpose\nPray morning & evening`}
          />
        </section>

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>Past Activities (Review)</h3>
          <p className={styles.help}>
            Enter one item per line. You can paste session titles you want to
            remember.
          </p>
          <textarea
            className={styles.textarea}
            rows={5}
            value={activitiesText}
            onChange={(e) =>
              setField(
                "pastActivities",
                (e.target.value || "")
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            placeholder={`e.g.\nMentor chat — Purpose of life\nStudy — Philippians 2:1-11 (Q&A)\nFriend chat — dealing with stress`}
          />
        </section>

        <div className={styles.savedRow} aria-live="polite">
          {savedTick > 0 && <span className={styles.savedPill}>Saved</span>}
        </div>
      </main>
    </div>
  );
}

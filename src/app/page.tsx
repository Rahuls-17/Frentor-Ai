// src/app/page.tsx
// src/app/page.tsx
"use client";

import { useRouter } from "next/navigation";
import styles from "./page.module.css";

const characters = [
  { id: "paul", name: "Saint Paul", tagline: "Apostle and mentor in Christ" },
  // later: load from Postgres; for now hardcoded
];

export default function LandingPage() {
  const router = useRouter();
  const choose = (id: string) =>
    router.push(`/chat?figure=${encodeURIComponent(id)}`);

  return (
    <main className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.titleBox}>
            <h1 className={styles.title}>Choose your mentor</h1>
            <p className={styles.sub}>
              Start a conversation (Saint Paul available now)
            </p>
          </div>
        </div>
      </header>

      <section className={styles.grid}>
        {characters.map((c) => (
          <article key={c.id} className={styles.card}>
            <div className={styles.cardText}>
              <div className={styles.cardTitle}>{c.name}</div>
              <div className={styles.cardSub}>{c.tagline}</div>
            </div>
            <button className={styles.chooseBtn} onClick={() => choose(c.id)}>
              Choose
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}

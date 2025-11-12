// src/app/discover/page.tsx
"use client";

import Link from "next/link";

export default function DiscoverPage() {
  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Discover</h1>
      <p style={{ color: "#555" }}>
        Curated plans, prompts, and themes will appear here soon.
      </p>
      <p>Want to start now? Try a chat with Saint Paul:</p>
      <p>
        <Link href="/chat" style={{ textDecoration: "underline" }}>
          Open Chat
        </Link>
      </p>
    </main>
  );
}

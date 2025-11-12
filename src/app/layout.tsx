// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Frentor AI – Saint Paul Chat",
  description: "Faith-based conversational mentor powered by GPT-5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Navbar height is 56px; add body padding so sticky headers don't overlap
  return (
    <html lang="en">
      <body style={{ backgroundColor: "#f7f7f8", paddingTop: "56px" }}>
        <NavBar />
        {children}
      </body>
    </html>
  );
}

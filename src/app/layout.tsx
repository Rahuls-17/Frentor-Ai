import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Frentor AI – Saint Paul Chat",
  description: "Faith-based conversational mentor powered by GPT-5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: "#f7f7f8" }}>{children}</body>
    </html>
  );
}

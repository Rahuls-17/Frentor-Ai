// src/components/NavBar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./NavBar.module.css";

function NavItem({
  href,
  label,
  isActive,
}: {
  href: string;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${styles.navItem} ${isActive ? styles.active : ""}`}
      aria-current={isActive ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const active = (path: string) => pathname === path;

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          Frentor AI
        </Link>

        <div className={styles.center}>
          <NavItem href="/" label="Home" isActive={active("/")} />
          <NavItem href="/study" label="Study" isActive={active("/study")} />
          <NavItem
            href="/discover"
            label="Discover"
            isActive={active("/discover")}
          />
          <NavItem href="/chat" label="Chat" isActive={active("/chat")} />
        </div>

        <Link
          href="/profile"
          className={styles.profileBtn}
          aria-label="Profile"
        >
          <svg
            className={styles.profileIcon}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M6 20c0-3.333 3-6 6-6s6 2.667 6 6" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}

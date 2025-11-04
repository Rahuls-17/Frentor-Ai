// src/app/profile/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Profile = {
  id?: string;
  name: string;
  age_range: string;
  country: string;
  denom_pref: string;
  goals: string[]; // stored as array; edited as comma-separated string
};

const DEFAULT_PROFILE: Profile = {
  id: "demo-user",
  name: "Rahul Singh",
  age_range: "25–34",
  country: "India",
  denom_pref: "Evangelical",
  goals: ["Understand purpose of life", "Grow in gratitude"],
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local editable string for goals to avoid uncontrolled flips
  const goalsString = useMemo(
    () =>
      profile.goals && Array.isArray(profile.goals)
        ? profile.goals.join(", ")
        : "",
    [profile.goals]
  );

  // Keep an AbortController to cancel in-flight requests on unmount / route change
  const loadControllerRef = useRef<AbortController | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const controller = new AbortController();
    loadControllerRef.current = controller;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/history?profile=true", {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) throw new Error(await res.text());
        const p = (await res.json()) as Partial<Profile> | null;

        if (!mountedRef.current) return;

        // Merge with defaults to guarantee controlled values
        const merged: Profile = {
          ...DEFAULT_PROFILE,
          ...(p ?? {}),
          // normalize shapes
          name: (p?.name ?? DEFAULT_PROFILE.name) as string,
          age_range: (p?.age_range ?? DEFAULT_PROFILE.age_range) as string,
          country: (p?.country ?? DEFAULT_PROFILE.country) as string,
          denom_pref: (p?.denom_pref ?? DEFAULT_PROFILE.denom_pref) as string,
          goals: Array.isArray(p?.goals)
            ? (p!.goals as string[])
            : typeof (p as any)?.goals === "string"
            ? ((p as any).goals as string)
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : DEFAULT_PROFILE.goals,
        };

        setProfile(merged);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (!mountedRef.current) return;
        setError(e?.message || "Failed to load profile");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
      try {
        loadControllerRef.current?.abort();
      } catch {}
    };
  }, []);

  async function onSave() {
    if (saving) return;

    const controller = new AbortController();
    saveControllerRef.current = controller;

    try {
      setSaving(true);
      setError(null);

      // Normalize to a clean payload
      const payload: Profile = {
        id: profile.id ?? "demo-user",
        name: profile.name ?? "",
        age_range: profile.age_range ?? "",
        country: profile.country ?? "",
        denom_pref: profile.denom_pref ?? "",
        goals: Array.isArray(profile.goals)
          ? profile.goals
          : (profile.goals as any)
              ?.toString()
              ?.split(",")
              ?.map((s: string) => s.trim()) ?? [],
      };

      const res = await fetch("/api/history?profile=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(await res.text());
      // Optionally show a subtle confirmation
      alert("Profile saved.");
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Profile</h1>
        <Link href="/chat">← Back to chat</Link>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            border: "1px solid #f1c0c0",
            background: "#fff5f5",
            color: "#a11212",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: 10,
          background: "#fff",
          border: "1px solid #e6e8eb",
          padding: 14,
          borderRadius: 12,
          opacity: loading ? 0.7 : 1,
          pointerEvents: loading ? "none" : "auto",
        }}
      >
        <label>
          <div style={{ marginBottom: 4 }}>Name</div>
          <input
            type="text"
            value={profile.name ?? ""} // controlled fallback
            onChange={(e) =>
              setProfile((p) => ({ ...p, name: e.target.value }))
            }
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: "1px solid #d7dbe0",
            }}
          />
        </label>

        <label>
          <div style={{ marginBottom: 4 }}>Age range</div>
          <input
            type="text"
            value={profile.age_range ?? ""} // controlled fallback
            onChange={(e) =>
              setProfile((p) => ({ ...p, age_range: e.target.value }))
            }
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: "1px solid #d7dbe0",
            }}
          />
        </label>

        <label>
          <div style={{ marginBottom: 4 }}>Country</div>
          <input
            type="text"
            value={profile.country ?? ""} // controlled fallback
            onChange={(e) =>
              setProfile((p) => ({ ...p, country: e.target.value }))
            }
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: "1px solid #d7dbe0",
            }}
          />
        </label>

        <label>
          <div style={{ marginBottom: 4 }}>Denomination preference</div>
          <input
            type="text"
            value={profile.denom_pref ?? ""} // controlled fallback
            onChange={(e) =>
              setProfile((p) => ({ ...p, denom_pref: e.target.value }))
            }
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: "1px solid #d7dbe0",
            }}
          />
        </label>

        <label>
          <div style={{ marginBottom: 4 }}>Goals (comma-separated)</div>
          <input
            type="text"
            value={goalsString ?? ""} // controlled fallback
            onChange={(e) =>
              setProfile((p) => ({
                ...p,
                goals: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: "1px solid #d7dbe0",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              background: "#1663eb",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <button
            onClick={() => {
              // Reset the form to last saved (or defaults during first load)
              setProfile((prev) => ({
                ...(prev?.id ? prev : DEFAULT_PROFILE),
                name: prev?.name ?? DEFAULT_PROFILE.name,
                age_range: prev?.age_range ?? DEFAULT_PROFILE.age_range,
                country: prev?.country ?? DEFAULT_PROFILE.country,
                denom_pref: prev?.denom_pref ?? DEFAULT_PROFILE.denom_pref,
                goals:
                  Array.isArray(prev?.goals) && prev.goals.length
                    ? prev.goals
                    : DEFAULT_PROFILE.goals,
              }));
            }}
            type="button"
            style={{
              border: "1px solid #d7dbe0",
              borderRadius: 10,
              padding: "10px 14px",
              background: "#fff",
              color: "#111",
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </main>
  );
}

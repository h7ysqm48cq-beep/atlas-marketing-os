"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ContentHistory.module.css";

type Analysis = {
  summary?: string;
  viralScore?: number;
  discussionScore?: number;
  shareabilityScore?: number;
  brandFitScore?: number;
  bestPostingTime?: string;
};

type HistoryRecord = {
  id: string;
  topic: string;
  platforms: string[];
  style: string;
  language: string;
  facebook: string;
  telegram: string;
  reels: string;
  imagePrompt: string;
  analysis: Analysis;
  isFavorite: boolean;
  createdAt: string;
  brand: {
    id: string;
    name: string;
    workspace: {
      id: string;
      name: string;
      slug: string;
    };
  };
};

type OutputKey = "facebook" | "telegram" | "reels" | "imagePrompt";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function ContentHistory() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selected, setSelected] = useState<HistoryRecord | null>(null);
  const [activeOutput, setActiveOutput] =
    useState<OutputKey>("facebook");
  const [query, setQuery] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [status, setStatus] = useState("Loading generation history...");

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch =
        !cleanQuery ||
        record.topic.toLowerCase().includes(cleanQuery) ||
        record.brand.name.toLowerCase().includes(cleanQuery) ||
        record.style.toLowerCase().includes(cleanQuery);

      const matchesFavorite = !onlyFavorites || record.isFavorite;

      return matchesSearch && matchesFavorite;
    });
  }, [records, query, onlyFavorites]);

  async function load() {
    try {
      const response = await fetch(`${API_BASE_URL}/history`);
      const data = (await response.json()) as
        | HistoryRecord[]
        | { message?: string };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.message
            ? data.message
            : "Unable to load history.",
        );
      }

      setRecords(data);
      setSelected((current) => current || data[0] || null);
      setStatus(
        data.length === 0
          ? "No saved generations yet."
          : `${data.length} saved generation${data.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to load history.",
      );
    }
  }

  async function toggleFavorite(record: HistoryRecord) {
    const response = await fetch(
      `${API_BASE_URL}/history/${record.id}/favorite`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isFavorite: !record.isFavorite,
        }),
      },
    );

    if (!response.ok) return;

    setRecords((current) =>
      current.map((item) =>
        item.id === record.id
          ? { ...item, isFavorite: !item.isFavorite }
          : item,
      ),
    );

    setSelected((current) =>
      current?.id === record.id
        ? { ...current, isFavorite: !current.isFavorite }
        : current,
    );
  }

  async function remove(record: HistoryRecord) {
    const confirmed = window.confirm(
      `Delete "${record.topic}" from history?`,
    );

    if (!confirmed) return;

    const response = await fetch(`${API_BASE_URL}/history/${record.id}`, {
      method: "DELETE",
    });

    if (!response.ok) return;

    const remaining = records.filter((item) => item.id !== record.id);
    setRecords(remaining);

    if (selected?.id === record.id) {
      setSelected(remaining[0] || null);
    }
  }

  function getOutput(record: HistoryRecord) {
    return record[activeOutput];
  }

  async function copySelected() {
    if (!selected) return;
    await navigator.clipboard.writeText(getOutput(selected));
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Content History</p>
          <h1>Every Atlas generation, saved and reusable.</h1>
          <p>
            Review past content, copy outputs, mark strong ideas as favorites
            and remove versions you no longer need.
          </p>
        </div>

        <div className={styles.countCard}>
          <span>Saved records</span>
          <strong>{records.length}</strong>
          <small>{status}</small>
        </div>
      </section>

      <section className={styles.toolbar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search topic, brand or style..."
        />
        <button
          className={onlyFavorites ? styles.activeFilter : ""}
          onClick={() => setOnlyFavorites((current) => !current)}
        >
          ★ Favorites
        </button>
        <button onClick={load}>Refresh</button>
      </section>

      <section className={styles.layout}>
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No matching generations</strong>
              <span>Generate new content in AI Studio.</span>
            </div>
          ) : (
            filtered.map((record) => (
              <button
                key={record.id}
                className={`${styles.historyCard} ${
                  selected?.id === record.id ? styles.selectedCard : ""
                }`}
                onClick={() => setSelected(record)}
              >
                <div className={styles.cardTop}>
                  <span className={styles.brandBadge}>
                    {record.brand.name}
                  </span>
                  <span>{record.isFavorite ? "★" : "☆"}</span>
                </div>
                <h2>{record.topic}</h2>
                <p>
                  {record.style} · {record.language}
                </p>
                <div className={styles.platforms}>
                  {record.platforms.map((platform) => (
                    <span key={platform}>{platform}</span>
                  ))}
                </div>
                <small>{formatDate(record.createdAt)}</small>
              </button>
            ))
          )}
        </div>

        <div className={styles.viewer}>
          {!selected ? (
            <div className={styles.emptyViewer}>
              Select a generation to inspect it.
            </div>
          ) : (
            <>
              <div className={styles.viewerHeader}>
                <div>
                  <span className={styles.brandBadge}>
                    {selected.brand.name}
                  </span>
                  <h2>{selected.topic}</h2>
                  <p>{selected.analysis.summary || "Saved AI generation"}</p>
                </div>
                <div className={styles.actions}>
                  <button onClick={() => toggleFavorite(selected)}>
                    {selected.isFavorite ? "★ Favorited" : "☆ Favorite"}
                  </button>
                  <button onClick={copySelected}>Copy</button>
                  <button
                    className={styles.deleteButton}
                    onClick={() => remove(selected)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className={styles.scoreGrid}>
                <Score
                  label="Viral"
                  value={selected.analysis.viralScore}
                />
                <Score
                  label="Discussion"
                  value={selected.analysis.discussionScore}
                />
                <Score
                  label="Shareability"
                  value={selected.analysis.shareabilityScore}
                />
                <Score
                  label="Brand Fit"
                  value={selected.analysis.brandFitScore}
                />
              </div>

              <div className={styles.tabs}>
                {[
                  ["facebook", "Facebook"],
                  ["telegram", "Telegram"],
                  ["reels", "Reels"],
                  ["imagePrompt", "Image Prompt"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={
                      activeOutput === key ? styles.activeTab : ""
                    }
                    onClick={() => setActiveOutput(key as OutputKey)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <textarea
                className={styles.output}
                readOnly
                value={getOutput(selected)}
              />

              <div className={styles.meta}>
                <span>
                  Best time:{" "}
                  {selected.analysis.bestPostingTime || "Not provided"}
                </span>
                <span>{formatDate(selected.createdAt)}</span>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Score({
  label,
  value,
}: {
  label: string;
  value?: number;
}) {
  return (
    <div className={styles.score}>
      <strong>{value ?? 0}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

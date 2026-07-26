"use client";

import {
  useState,
} from "react";
import styles from "./AiTopicSuggestions.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001";

type Suggestion = {
  title: string;
  angle: string;
  hook: string;
  reason: string;
};

type Props = {
  style: string;
  language: string;
  platforms: string[];
  campaignId?: string;
  onSelect: (topic: string) => void;
  onMessage?: (message: string) => void;
};

export function AiTopicSuggestions({
  style,
  language,
  platforms,
  campaignId,
  onSelect,
  onMessage,
}: Props) {
  const [open, setOpen] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [direction, setDirection] =
    useState("");

  const [suggestions, setSuggestions] =
    useState<Suggestion[]>([]);

  const [error, setError] =
    useState("");

  async function loadSuggestions() {
    setError("");
    setLoading(true);

    onMessage?.(
      "Generating fresh topic ideas...",
    );

    try {
      const response = await fetch(
        `${API_BASE_URL}/ai/topic-suggestions`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            campaignId:
              campaignId || undefined,
            style,
            language,
            platforms,
            count: 8,
            direction:
              direction.trim() ||
              undefined,
          }),
        },
      );

      const data =
        (await response.json()) as
          | {
              suggestions: Suggestion[];
              count: number;
            }
          | {
              message?: string;
            };

      if (
        !response.ok ||
        !("suggestions" in data)
      ) {
        throw new Error(
          "message" in data &&
          data.message
            ? data.message
            : "Unable to generate topic suggestions.",
        );
      }

      setSuggestions(
        data.suggestions,
      );

      setOpen(true);

      onMessage?.(
        `${data.count} topic ideas generated.`,
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to generate topic suggestions.";

      setError(message);
      onMessage?.(message);
    } finally {
      setLoading(false);
    }
  }

  function chooseSuggestion(
    suggestion: Suggestion,
  ) {
    onSelect(suggestion.title);
    setOpen(false);

    onMessage?.(
      `Topic selected: ${suggestion.title}`,
    );
  }

  return (
    <section className={styles.wrapper}>
      <div className={styles.controls}>
        <input
          value={direction}
          onChange={(event) =>
            setDirection(
              event.target.value,
            )
          }
          placeholder="Optional direction, e.g. Malaysian lifestyle, nostalgia..."
        />

        <button
          type="button"
          onClick={() =>
            void loadSuggestions()
          }
          disabled={
            loading ||
            !platforms.length
          }
        >
          {loading
            ? "Thinking..."
            : "✦ Suggest topics"}
        </button>
      </div>

      {error ? (
        <p className={styles.error}>
          {error}
        </p>
      ) : null}

      {open ? (
        <div
          className={styles.backdrop}
          onClick={() =>
            setOpen(false)
          }
        >
          <section
            className={styles.modal}
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <header>
              <div>
                <p>AI topic generator</p>
                <h2>
                  Choose your next topic
                </h2>
                <span>
                  Based on Brand Brain,
                  campaign context and recent
                  history.
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
              >
                ×
              </button>
            </header>

            <div className={styles.grid}>
              {suggestions.map(
                (suggestion, index) => (
                  <button
                    type="button"
                    key={`${suggestion.title}-${index}`}
                    className={
                      styles.suggestion
                    }
                    onClick={() =>
                      chooseSuggestion(
                        suggestion,
                      )
                    }
                  >
                    <span>
                      {String(
                        index + 1,
                      ).padStart(2, "0")}
                    </span>

                    <div>
                      <h3>
                        {suggestion.title}
                      </h3>

                      <strong>
                        {suggestion.angle}
                      </strong>

                      <p>
                        {suggestion.hook}
                      </p>

                      <small>
                        {suggestion.reason}
                      </small>
                    </div>
                  </button>
                ),
              )}
            </div>

            <footer>
              <button
                type="button"
                onClick={() =>
                  void loadSuggestions()
                }
                disabled={loading}
              >
                {loading
                  ? "Generating..."
                  : "Generate new ideas"}
              </button>

              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

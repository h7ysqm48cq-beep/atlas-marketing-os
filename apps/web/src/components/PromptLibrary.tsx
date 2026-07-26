"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import styles from "./PromptLibrary.module.css";

type PromptCategory =
  | "Strategy"
  | "Facebook"
  | "Telegram"
  | "Reels"
  | "Image"
  | "SEO"
  | "General";

type SavedPrompt = {
  id: string;
  title: string;
  category: PromptCategory;
  content: string;
  createdAt: string;
};

const STORAGE_KEY = "atlas-prompt-library-v1";

const starterPrompts: SavedPrompt[] = [
  {
    id: "starter-strategy",
    title: "7-Day Marketing Campaign",
    category: "Strategy",
    content:
      "为这个主题生成一个完整的7天营销方案，包括目标受众、内容支柱、Facebook、Telegram、Reels、图片提示词和发布排期。",
    createdAt: new Date(0).toISOString(),
  },
  {
    id: "starter-facebook",
    title: "Facebook Discussion Post",
    category: "Facebook",
    content:
      "把这个主题写成一篇适合马来西亚华人的Facebook互动帖文。语气自然、有共鸣，并在结尾加入一个容易让人留言的问题。",
    createdAt: new Date(0).toISOString(),
  },
  {
    id: "starter-telegram",
    title: "Telegram Short Copy",
    category: "Telegram",
    content:
      "把这段内容改成简短、有节奏、适合Telegram发布的版本。不要太像广告，并加入自然的行动引导。",
    createdAt: new Date(0).toISOString(),
  },
  {
    id: "starter-reels",
    title: "Reels Script",
    category: "Reels",
    content:
      "为这个主题写一个15至30秒Reels脚本，包括前三秒Hook、画面安排、字幕和结尾CTA。",
    createdAt: new Date(0).toISOString(),
  },
  {
    id: "starter-image",
    title: "Cinematic Image Prompt",
    category: "Image",
    content:
      "根据这个主题生成一个详细英文图片提示词。要求电影感、真实摄影、高级广告构图、清楚描述主体、环境、灯光与镜头，并避免真实品牌Logo和名人肖像。",
    createdAt: new Date(0).toISOString(),
  },
];

const categories: Array<"All" | PromptCategory> = [
  "All",
  "Strategy",
  "Facebook",
  "Telegram",
  "Reels",
  "Image",
  "SEO",
  "General",
];

export function PromptLibrary() {
  const router = useRouter();

  const [prompts, setPrompts] =
    useState<SavedPrompt[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] =
    useState<"All" | PromptCategory>("All");
  const [showForm, setShowForm] =
    useState(false);
  const [title, setTitle] = useState("");
  const [newCategory, setNewCategory] =
    useState<PromptCategory>("General");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState(
    "Prompt Library is ready.",
  );

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        STORAGE_KEY,
      );

      if (!stored) {
        setPrompts(starterPrompts);
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(starterPrompts),
        );
        return;
      }

      const parsed = JSON.parse(stored);

      setPrompts(
        Array.isArray(parsed)
          ? parsed
          : starterPrompts,
      );
    } catch {
      setPrompts(starterPrompts);
      setStatus(
        "Unable to load saved prompts. Starter prompts were restored.",
      );
    }
  }, []);

  function persist(next: SavedPrompt[]) {
    setPrompts(next);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(next),
    );
  }

  const filtered = useMemo(() => {
    const normalized = query
      .toLowerCase()
      .trim();

    return prompts.filter((prompt) => {
      const matchesCategory =
        category === "All" ||
        prompt.category === category;

      const matchesQuery =
        !normalized ||
        prompt.title
          .toLowerCase()
          .includes(normalized) ||
        prompt.content
          .toLowerCase()
          .includes(normalized);

      return matchesCategory && matchesQuery;
    });
  }, [prompts, query, category]);

  function createPrompt(event: FormEvent) {
    event.preventDefault();

    const cleanTitle = title.trim();
    const cleanContent = content.trim();

    if (!cleanTitle || !cleanContent) {
      setStatus(
        "Title and prompt content are required.",
      );
      return;
    }

    const nextPrompt: SavedPrompt = {
      id:
        typeof crypto !== "undefined" &&
        "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`,
      title: cleanTitle,
      category: newCategory,
      content: cleanContent,
      createdAt: new Date().toISOString(),
    };

    persist([nextPrompt, ...prompts]);

    setTitle("");
    setContent("");
    setNewCategory("General");
    setShowForm(false);
    setStatus(`Saved: ${cleanTitle}`);
  }

  async function copyPrompt(
    prompt: SavedPrompt,
  ) {
    await navigator.clipboard.writeText(
      prompt.content,
    );

    setStatus(`Copied: ${prompt.title}`);
  }

  function useInCopilot(
    prompt: SavedPrompt,
  ) {
    window.localStorage.setItem(
      "atlas-copilot-draft",
      prompt.content,
    );

    router.push(
      `/copilot?prompt=${encodeURIComponent(
        prompt.content,
      )}`,
    );
  }

  function deletePrompt(
    prompt: SavedPrompt,
  ) {
    const confirmed = window.confirm(
      `Delete "${prompt.title}"?`,
    );

    if (!confirmed) {
      return;
    }

    persist(
      prompts.filter(
        (item) => item.id !== prompt.id,
      ),
    );

    setStatus(`Deleted: ${prompt.title}`);
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            Prompt System
          </p>

          <h1>Prompt Library</h1>

          <p>
            Save reusable instructions and send them
            directly into Elena Copilot.
          </p>
        </div>

        <button
          className={styles.primaryButton}
          type="button"
          onClick={() =>
            setShowForm((current) => !current)
          }
        >
          {showForm ? "Close" : "+ New Prompt"}
        </button>
      </section>

      {showForm ? (
        <form
          className={styles.editor}
          onSubmit={createPrompt}
        >
          <div className={styles.editorGrid}>
            <label>
              <span>Title</span>
              <input
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value)
                }
                placeholder="Example: Facebook nostalgia post"
              />
            </label>

            <label>
              <span>Category</span>
              <select
                value={newCategory}
                onChange={(event) =>
                  setNewCategory(
                    event.target
                      .value as PromptCategory,
                  )
                }
              >
                {categories
                  .filter(
                    (item) => item !== "All",
                  )
                  .map((item) => (
                    <option
                      key={item}
                      value={item}
                    >
                      {item}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <label>
            <span>Prompt</span>
            <textarea
              value={content}
              onChange={(event) =>
                setContent(event.target.value)
              }
              placeholder="Write the reusable prompt instruction..."
            />
          </label>

          <div className={styles.editorActions}>
            <small>{status}</small>

            <button type="submit">
              Save Prompt
            </button>
          </div>
        </form>
      ) : null}

      <section className={styles.toolbar}>
        <input
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
          placeholder="Search prompts..."
        />

        <div className={styles.categories}>
          {categories.map((item) => (
            <button
              type="button"
              key={item}
              className={
                category === item
                  ? styles.activeCategory
                  : ""
              }
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <div className={styles.status}>
        {status}
      </div>

      <section className={styles.grid}>
        {filtered.map((prompt) => (
          <article
            className={styles.card}
            key={prompt.id}
          >
            <header>
              <span>{prompt.category}</span>

              <button
                type="button"
                aria-label={`Delete ${prompt.title}`}
                onClick={() =>
                  deletePrompt(prompt)
                }
              >
                ×
              </button>
            </header>

            <h2>{prompt.title}</h2>

            <p>{prompt.content}</p>

            <footer>
              <button
                type="button"
                onClick={() =>
                  void copyPrompt(prompt)
                }
              >
                Copy
              </button>

              <button
                type="button"
                className={styles.useButton}
                onClick={() =>
                  useInCopilot(prompt)
                }
              >
                Use in Copilot
              </button>
            </footer>
          </article>
        ))}

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            No prompts match your search.
          </div>
        ) : null}
      </section>
    </div>
  );
}

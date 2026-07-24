"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./KnowledgeLibrary.module.css";
import type {
  KnowledgeDocument,
  KnowledgeForm,
} from "./knowledge.types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const emptyForm: KnowledgeForm = {
  title: "",
  category: "Brand Voice",
  content: "",
  tags: "",
};

const suggestedCategories = [
  "Brand Voice",
  "Target Audience",
  "Product",
  "Marketing SOP",
  "Platform Rules",
  "Writing Style",
  "Competitor",
  "Prompt Template",
  "Custom",
];

function tagsToText(tags: string[]) {
  return tags.join(", ");
}

function textToTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

export function KnowledgeLibrary() {
  const [documents, setDocuments] =
    useState<KnowledgeDocument[]>([]);
  const [selected, setSelected] =
    useState<KnowledgeDocument | null>(null);
  const [form, setForm] = useState<KnowledgeForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState("ALL");
  const [message, setMessage] =
    useState("Loading knowledge documents...");
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const categories = useMemo(
    () =>
      Array.from(
        new Set([
          ...suggestedCategories,
          ...documents.map((document) => document.category),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [documents],
  );

  const filtered = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return documents.filter((document) => {
      const matchesSearch =
        !cleanSearch ||
        [
          document.title,
          document.category,
          document.content,
          ...document.tags,
        ]
          .join(" ")
          .toLowerCase()
          .includes(cleanSearch);

      const matchesCategory =
        categoryFilter === "ALL" ||
        document.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [categoryFilter, documents, search]);

  async function load(preferredId?: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/knowledge`, {
        cache: "no-store",
      });

      const data = (await response.json()) as
        | KnowledgeDocument[]
        | { message?: string };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.message
            ? data.message
            : "Unable to load knowledge.",
        );
      }

      setDocuments(data);

      const nextSelected =
        data.find((item) => item.id === preferredId) ||
        data.find((item) => item.id === selected?.id) ||
        data[0] ||
        null;

      selectDocument(nextSelected);

      setMessage(
        data.length
          ? `${data.length} knowledge document${
              data.length === 1 ? "" : "s"
            } loaded.`
          : "No knowledge documents yet.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load knowledge.",
      );
    }
  }

  function selectDocument(document: KnowledgeDocument | null) {
    setSelected(document);
    setIsCreating(false);

    setForm(
      document
        ? {
            title: document.title,
            category: document.category,
            content: document.content,
            tags: tagsToText(document.tags),
          }
        : emptyForm,
    );
  }

  function startCreate() {
    setSelected(null);
    setForm(emptyForm);
    setIsCreating(true);
    setMessage("Creating a new knowledge document.");
  }

  function updateField(
    key: keyof KnowledgeForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !form.title.trim() ||
      !form.category.trim() ||
      !form.content.trim()
    ) {
      setMessage("Title, category and content are required.");
      return;
    }

    setIsSaving(true);
    setMessage(
      selected
        ? "Updating knowledge document..."
        : "Saving knowledge document...",
    );

    try {
      const response = await fetch(
        selected
          ? `${API_BASE_URL}/knowledge/${selected.id}`
          : `${API_BASE_URL}/knowledge`,
        {
          method: selected ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: form.title.trim(),
            category: form.category.trim(),
            content: form.content.trim(),
            tags: textToTags(form.tags),
          }),
        },
      );

      const data = (await response.json()) as
        | KnowledgeDocument
        | { message?: string };

      if (!response.ok || !("id" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to save knowledge.",
        );
      }

      await load(data.id);
      setIsCreating(false);
      setMessage(
        selected
          ? "Knowledge document updated."
          : "Knowledge document created.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save knowledge.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function remove() {
    if (!selected) return;

    const confirmed = window.confirm(
      `Delete "${selected.title}"?`,
    );

    if (!confirmed) return;

    const response = await fetch(
      `${API_BASE_URL}/knowledge/${selected.id}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      setMessage("Unable to delete knowledge document.");
      return;
    }

    setSelected(null);
    await load();
    setMessage("Knowledge document deleted.");
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Knowledge Library</p>
          <h1>Give Atlas the context behind every decision.</h1>
          <p>
            Store brand rules, audience knowledge, platform guidance,
            reusable prompts and marketing procedures in one source of truth.
          </p>
        </div>

        <button
          className={styles.primaryButton}
          type="button"
          onClick={startCreate}
        >
          + New document
        </button>
      </section>

      <section className={styles.toolbar}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, category, tag or content..."
        />

        <select
          value={categoryFilter}
          onChange={(event) =>
            setCategoryFilter(event.target.value)
          }
        >
          <option value="ALL">All categories</option>

          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </section>

      <p className={styles.message}>{message}</p>

      <section className={styles.layout}>
        <aside className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.emptyList}>
              <strong>No matching knowledge</strong>
              <span>Create a document or adjust the filters.</span>
            </div>
          ) : (
            filtered.map((document) => (
              <button
                type="button"
                key={document.id}
                className={`${styles.documentCard} ${
                  selected?.id === document.id
                    ? styles.selectedCard
                    : ""
                }`}
                onClick={() => selectDocument(document)}
              >
                <div>
                  <span>{document.category}</span>
                  <small>{formatDate(document.updatedAt)}</small>
                </div>

                <h2>{document.title}</h2>
                <p>{document.content}</p>

                <div className={styles.tags}>
                  {document.tags.slice(0, 4).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>

                <div className={styles.documentMetrics}>
                  <span>{document.tags.length} tags</span>
                  <span>{countWords(document.content)} words</span>
                  <span>
                    Used {document.usageCount || 0} times
                  </span>
                </div>

                <div className={styles.usageMeta}>
                  <span>Last used</span>
                  <strong>
                    {document.lastUsedAt
                      ? formatDateTime(document.lastUsedAt)
                      : "Never"}
                  </strong>
                </div>
              </button>
            ))
          )}
        </aside>

        <form className={styles.editor} onSubmit={save}>
          <header className={styles.editorHeader}>
            <div>
              <span>
                {selected
                  ? "Edit knowledge"
                  : isCreating
                    ? "New knowledge"
                    : "Knowledge editor"}
              </span>

              <h2>
                {selected?.title ||
                  (isCreating
                    ? "Untitled knowledge document"
                    : "Select a document")}
              </h2>

              {selected ? (
                <p className={styles.editorMeta}>
                  {selected.category} ·{" "}
                  {countWords(selected.content)} words · Updated{" "}
                  {formatDate(selected.updatedAt)}
                </p>
              ) : null}
            </div>
          </header>

          <div className={styles.twoColumns}>
            <label
              className={`${styles.field} ${styles.titleField}`}
            >
              <span>Title</span>
              <input
                value={form.title}
                onChange={(event) =>
                  updateField("title", event.target.value)
                }
                disabled={!selected && !isCreating}
              />
            </label>

            <label
              className={`${styles.field} ${styles.categoryField}`}
            >
              <span>Category</span>
              <input
                list="knowledge-categories"
                value={form.category}
                onChange={(event) =>
                  updateField("category", event.target.value)
                }
                disabled={!selected && !isCreating}
              />

              <datalist id="knowledge-categories">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </label>
          </div>

          <label className={styles.field}>
            <span>Tags</span>
            <input
              value={form.tags}
              onChange={(event) =>
                updateField("tags", event.target.value)
              }
              placeholder="Malaysia, Facebook, Tone"
              disabled={!selected && !isCreating}
            />
          </label>

          <label className={styles.field}>
            <span>Knowledge content</span>
            <textarea
              value={form.content}
              onChange={(event) =>
                updateField("content", event.target.value)
              }
              placeholder="Write the rules, context or source material Atlas should remember..."
              disabled={!selected && !isCreating}
            />
          </label>

          <footer className={styles.editorFooter}>
            <span>
              {selected
                ? `${countWords(form.content)} words`
                : "Not saved yet"}
            </span>

            <div className={styles.footerActions}>
              {selected ? (
                <button
                  className={styles.deleteButton}
                  type="button"
                  onClick={() => void remove()}
                >
                  Delete
                </button>
              ) : null}

              <button
                className={styles.primaryButton}
                type="submit"
                disabled={
                  isSaving || (!selected && !isCreating)
                }
              >
                {isSaving
                  ? "Saving..."
                  : selected
                    ? "Save changes"
                    : "Create document"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function countWords(value: string) {
  const cleanValue = value.trim();

  if (!cleanValue) return 0;

  const latinWords =
    cleanValue.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)
      ?.length || 0;

  const chineseCharacters =
    cleanValue.match(/[\u3400-\u9fff]/g)?.length || 0;

  return latinWords + chineseCharacters;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
  }).format(new Date(value));
}

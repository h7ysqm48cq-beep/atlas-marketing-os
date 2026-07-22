"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./BrandBrain.module.css";

type Brand = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  country: string;
  primaryLanguage: string;
  targetAudience: string;
  brandVoice: string;
  visualStyle: string;
  contentGoals: string;
  callsToAction: string[];
  keywords: string[];
  forbiddenWords: string[];
  brandRules: string[];
  examplePosts: string[];
  updatedAt: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function listToText(items: string[]) {
  return items.join("\n");
}

function textToList(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function BrandBrain() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [form, setForm] = useState({
    name: "",
    website: "",
    industry: "",
    country: "Malaysia",
    primaryLanguage: "",
    targetAudience: "",
    brandVoice: "",
    visualStyle: "",
    contentGoals: "",
    callsToAction: "",
    keywords: "",
    forbiddenWords: "",
    brandRules: "",
    examplePosts: "",
  });
  const [status, setStatus] = useState("Loading brand memory...");
  const [isSaving, setIsSaving] = useState(false);

  const completion = useMemo(() => {
    const values = Object.values(form);
    const completed = values.filter((value) => value.trim().length > 0).length;
    return Math.round((completed / values.length) * 100);
  }, [form]);

  useEffect(() => {
    void loadBrand();
  }, []);

  async function loadBrand() {
    try {
      const response = await fetch(`${API_BASE_URL}/brands`);
      const brands = (await response.json()) as Brand[];

      if (!response.ok || brands.length === 0) {
        throw new Error("No brand found.");
      }

      const current = brands[0];
      setBrand(current);
      setForm({
        name: current.name,
        website: current.website || "",
        industry: current.industry || "",
        country: current.country,
        primaryLanguage: current.primaryLanguage,
        targetAudience: current.targetAudience,
        brandVoice: current.brandVoice,
        visualStyle: current.visualStyle,
        contentGoals: current.contentGoals,
        callsToAction: listToText(current.callsToAction),
        keywords: listToText(current.keywords),
        forbiddenWords: listToText(current.forbiddenWords),
        brandRules: listToText(current.brandRules),
        examplePosts: listToText(current.examplePosts),
      });
      setStatus("Brand memory loaded from PostgreSQL.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to load Brand Brain.",
      );
    }
  }

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function save() {
    if (!brand) return;

    setIsSaving(true);
    setStatus("Saving brand memory...");

    try {
      const response = await fetch(`${API_BASE_URL}/brands/${brand.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          website: form.website,
          industry: form.industry,
          country: form.country,
          primaryLanguage: form.primaryLanguage,
          targetAudience: form.targetAudience,
          brandVoice: form.brandVoice,
          visualStyle: form.visualStyle,
          contentGoals: form.contentGoals,
          callsToAction: textToList(form.callsToAction),
          keywords: textToList(form.keywords),
          forbiddenWords: textToList(form.forbiddenWords),
          brandRules: textToList(form.brandRules),
          examplePosts: textToList(form.examplePosts),
        }),
      });

      const data = (await response.json()) as Brand | { message?: string };

      if (!response.ok) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to save brand.",
        );
      }

      setBrand(data as Brand);
      setStatus("Saved. Atlas will use these rules in future generations.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to save Brand Brain.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Brand Brain</p>
          <h1>Teach Atlas how your brand thinks, writes and looks.</h1>
          <p>
            This memory will become the source of truth for future content,
            prompts and campaign recommendations.
          </p>
        </div>

        <div className={styles.completionCard}>
          <span>Memory completeness</span>
          <strong>{completion}%</strong>
          <div>
            <i style={{ width: `${completion}%` }} />
          </div>
        </div>
      </section>

      <section className={styles.layout}>
        <div className={styles.editor}>
          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <span>01</span>
                <h2>Brand identity</h2>
              </div>
              <p>Core business and market information.</p>
            </div>

            <div className={styles.twoColumns}>
              <Field
                label="Brand name"
                value={form.name}
                onChange={(value) => updateField("name", value)}
              />
              <Field
                label="Website"
                value={form.website}
                onChange={(value) => updateField("website", value)}
              />
              <Field
                label="Industry"
                value={form.industry}
                onChange={(value) => updateField("industry", value)}
              />
              <Field
                label="Country"
                value={form.country}
                onChange={(value) => updateField("country", value)}
              />
              <Field
                label="Primary language"
                value={form.primaryLanguage}
                onChange={(value) =>
                  updateField("primaryLanguage", value)
                }
              />
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <span>02</span>
                <h2>Audience and strategy</h2>
              </div>
              <p>Who the brand serves and what content must achieve.</p>
            </div>

            <Area
              label="Target audience"
              value={form.targetAudience}
              onChange={(value) => updateField("targetAudience", value)}
            />
            <Area
              label="Content goals"
              value={form.contentGoals}
              onChange={(value) => updateField("contentGoals", value)}
            />
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <span>03</span>
                <h2>Voice and visual direction</h2>
              </div>
              <p>How Atlas should write and design.</p>
            </div>

            <Area
              label="Brand voice"
              value={form.brandVoice}
              onChange={(value) => updateField("brandVoice", value)}
            />
            <Area
              label="Visual style"
              value={form.visualStyle}
              onChange={(value) => updateField("visualStyle", value)}
            />
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}>
              <div>
                <span>04</span>
                <h2>Rules and reusable memory</h2>
              </div>
              <p>Enter one item per line.</p>
            </div>

            <div className={styles.twoColumns}>
              <Area
                label="Brand rules"
                value={form.brandRules}
                onChange={(value) => updateField("brandRules", value)}
              />
              <Area
                label="Forbidden words"
                value={form.forbiddenWords}
                onChange={(value) => updateField("forbiddenWords", value)}
              />
              <Area
                label="Calls to action"
                value={form.callsToAction}
                onChange={(value) => updateField("callsToAction", value)}
              />
              <Area
                label="Keywords"
                value={form.keywords}
                onChange={(value) => updateField("keywords", value)}
              />
            </div>

            <Area
              label="Example posts"
              value={form.examplePosts}
              onChange={(value) => updateField("examplePosts", value)}
            />
          </section>
        </div>

        <aside className={styles.summary}>
          <div className={styles.summaryCard}>
            <span className={styles.badge}>Live memory</span>
            <h2>{form.name || "Unnamed brand"}</h2>
            <p>{form.brandVoice || "Add a brand voice."}</p>

            <div className={styles.summaryBlock}>
              <strong>Audience</strong>
              <span>{form.targetAudience || "Not configured"}</span>
            </div>

            <div className={styles.summaryBlock}>
              <strong>Visual system</strong>
              <span>{form.visualStyle || "Not configured"}</span>
            </div>

            <div className={styles.summaryBlock}>
              <strong>Key rules</strong>
              <ul>
                {textToList(form.brandRules)
                  .slice(0, 5)
                  .map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
              </ul>
            </div>
          </div>

          <div className={styles.saveCard}>
            <p>{status}</p>
            <button onClick={save} disabled={!brand || isSaving}>
              {isSaving ? "Saving..." : "Save Brand Brain"}
            </button>
          </div>
        </aside>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

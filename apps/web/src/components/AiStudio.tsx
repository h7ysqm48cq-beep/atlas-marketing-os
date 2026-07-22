"use client";

import { useMemo, useState } from "react";
import styles from "./AiStudio.module.css";

type OutputKey = "facebook" | "telegram" | "reels" | "image";

type Analysis = {
  summary: string;
  viralScore: number;
  discussionScore: number;
  shareabilityScore: number;
  brandFitScore: number;
  bestPostingTime: string;
};

type GeneratedPackage = {
  facebook: string;
  telegram: string;
  reels: string;
  image: string;
  analysis: Analysis;
};

type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";
type ImageQuality = "low" | "medium" | "high";

const defaultOutputs: Record<OutputKey, string> = {
  facebook: "Generate a topic to create the Facebook post.",
  telegram: "Generate a topic to create the Telegram post.",
  reels: "Generate a topic to create the Reels script.",
  image: "Generate a topic to create the image prompt.",
};

const defaultAnalysis: Analysis = {
  summary: "Enter a topic and click Generate content.",
  viralScore: 0,
  discussionScore: 0,
  shareabilityScore: 0,
  brandFitScore: 0,
  bestPostingTime: "—",
};

const tabs: { key: OutputKey; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "telegram", label: "Telegram" },
  { key: "reels", label: "Reels Script" },
  { key: "image", label: "Image Studio" },
];

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function AiStudio() {
  const [topic, setTopic] = useState("港剧怀旧");
  const [platforms, setPlatforms] = useState([
    "Facebook",
    "Telegram",
    "Reels",
    "Image Prompt",
  ]);
  const [style, setStyle] = useState("Nostalgia");
  const [language, setLanguage] = useState("Chinese");
  const [activeTab, setActiveTab] = useState<OutputKey>("facebook");
  const [outputs, setOutputs] =
    useState<Record<OutputKey, string>>(defaultOutputs);
  const [analysis, setAnalysis] = useState<Analysis>(defaultAnalysis);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize>("1024x1536");
  const [imageQuality, setImageQuality] =
    useState<ImageQuality>("low");
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const scores = useMemo(
    () => [
      ["Viral Score", analysis.viralScore],
      ["Discussion", analysis.discussionScore],
      ["Shareability", analysis.shareabilityScore],
      ["Brand Fit", analysis.brandFitScore],
    ],
    [analysis],
  );

  function togglePlatform(platform: string) {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    );
  }

  async function generate() {
    const cleanTopic = topic.trim();

    if (!cleanTopic) {
      setError("Please enter a topic.");
      return;
    }

    if (platforms.length === 0) {
      setError("Select at least one platform.");
      return;
    }

    setError("");
    setImageError("");
    setImageDataUrl("");
    setIsGenerating(true);

    try {
      const response = await fetch(`${API_BASE_URL}/ai/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: cleanTopic,
          platforms,
          style,
          language,
        }),
      });

      const data = (await response.json()) as
        | GeneratedPackage
        | { message?: string | string[] };

      if (!response.ok) {
        const message = "message" in data ? data.message : "Generation failed.";
        throw new Error(
          Array.isArray(message)
            ? message.join(", ")
            : message || "Generation failed.",
        );
      }

      const generated = data as GeneratedPackage;

      setOutputs({
        facebook: generated.facebook,
        telegram: generated.telegram,
        reels: generated.reels,
        image: generated.image,
      });
      setAnalysis(generated.analysis);
      setHistory((current) =>
        [cleanTopic, ...current.filter((item) => item !== cleanTopic)].slice(
          0,
          6,
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to connect to Atlas API.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function generateImage() {
    const prompt = outputs.image.trim();

    if (!prompt || prompt.startsWith("Generate a topic")) {
      setImageError("Generate the content package first.");
      return;
    }

    setImageError("");
    setIsGeneratingImage(true);

    try {
      const response = await fetch(`${API_BASE_URL}/images/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          size: imageSize,
          quality: imageQuality,
        }),
      });

      const data = (await response.json()) as {
        imageDataUrl?: string;
        message?: string | string[];
      };

      if (!response.ok || !data.imageDataUrl) {
        const message = data.message || "Image generation failed.";
        throw new Error(
          Array.isArray(message) ? message.join(", ") : message,
        );
      }

      setImageDataUrl(data.imageDataUrl);
    } catch (requestError) {
      setImageError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to generate the image.",
      );
    } finally {
      setIsGeneratingImage(false);
    }
  }

  async function copyOutput() {
    await navigator.clipboard.writeText(outputs[activeTab]);
  }

  function downloadImage() {
    if (!imageDataUrl) return;

    const link = document.createElement("a");
    const safeName =
      topic.trim().replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-|-$/g, "") ||
      "atlas-image";

    link.href = imageDataUrl;
    link.download = `${safeName}-${imageSize}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <div className={styles.studio}>
      <section className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Atlas AI Studio</p>
          <h1>Turn one topic into a complete content package.</h1>
          <p>
            Generate platform content and create a campaign-ready image from
            the same workspace.
          </p>
        </div>
        <div className={styles.version}>Sprint 2.3 · Live image</div>
      </section>

      <section className={styles.layout}>
        <aside className={styles.controls}>
          <div className={styles.section}>
            <label className={styles.label} htmlFor="topic">
              Topic
            </label>
            <textarea
              id="topic"
              className={styles.topicInput}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：港剧怀旧、足球人生、马来西亚生活梗"
            />
          </div>

          <div className={styles.section}>
            <div className={styles.label}>Platform</div>
            <div className={styles.chipGrid}>
              {["Facebook", "Telegram", "Reels", "Image Prompt"].map(
                (platform) => (
                  <button
                    key={platform}
                    className={`${styles.chip} ${
                      platforms.includes(platform) ? styles.selected : ""
                    }`}
                    onClick={() => togglePlatform(platform)}
                    type="button"
                  >
                    {platforms.includes(platform) ? "✓ " : ""}
                    {platform}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className={styles.section}>
            <label className={styles.label} htmlFor="style">
              Style
            </label>
            <select
              id="style"
              className={styles.select}
              value={style}
              onChange={(event) => setStyle(event.target.value)}
            >
              <option>Nostalgia</option>
              <option>Funny</option>
              <option>Motivation</option>
              <option>Lifestyle</option>
              <option>Soft Sell</option>
            </select>
          </div>

          <div className={styles.section}>
            <label className={styles.label} htmlFor="language">
              Language
            </label>
            <select
              id="language"
              className={styles.select}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option>Chinese</option>
              <option>English</option>
              <option>Bilingual</option>
            </select>
          </div>

          <div className={styles.section}>
            <div className={styles.label}>Brand memory</div>
            <div className={styles.brandMemory}>
              <strong>MGMBETMYR</strong>
              <span>
                Black-gold · Natural · Discussion-led · No hard sell
              </span>
            </div>
          </div>

          {error ? <div className={styles.errorBox}>{error}</div> : null}

          <button
            className={styles.generateButton}
            onClick={generate}
            disabled={isGenerating}
          >
            {isGenerating ? "Atlas is thinking..." : "✦ Generate content"}
          </button>
        </aside>

        <div className={styles.workspace}>
          <article className={styles.analysisCard}>
            <div className={styles.cardHeading}>
              <div>
                <span className={styles.badge}>AI analysis</span>
                <h2>{analysis.summary}</h2>
              </div>
              <div className={styles.scoreCircle}>
                <strong>{analysis.viralScore}</strong>
                <span>/100</span>
              </div>
            </div>

            <p className={styles.analysisCopy}>
              Recommended posting time:{" "}
              <strong>{analysis.bestPostingTime}</strong>
            </p>

            <div className={styles.scoreGrid}>
              {scores.map(([label, value]) => (
                <div className={styles.scoreItem} key={label}>
                  <div className={styles.scoreTop}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                  <div className={styles.scoreBar}>
                    <span style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className={styles.outputCard}>
            <div className={styles.outputHeader}>
              <div>
                <span className={styles.badge}>Generated workspace</span>
                <h2>{topic || "Untitled topic"}</h2>
              </div>
              <button className={styles.copyButton} onClick={copyOutput}>
                Copy output
              </button>
            </div>

            <div className={styles.tabs}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  className={`${styles.tab} ${
                    activeTab === tab.key ? styles.activeTab : ""
                  }`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab !== "image" ? (
              <textarea
                className={styles.outputEditor}
                value={outputs[activeTab]}
                onChange={(event) =>
                  setOutputs((current) => ({
                    ...current,
                    [activeTab]: event.target.value,
                  }))
                }
              />
            ) : (
              <div className={styles.imageStudio}>
                <div className={styles.imagePromptSection}>
                  <label className={styles.label} htmlFor="imagePrompt">
                    Image prompt
                  </label>
                  <textarea
                    id="imagePrompt"
                    className={styles.outputEditor}
                    value={outputs.image}
                    onChange={(event) =>
                      setOutputs((current) => ({
                        ...current,
                        image: event.target.value,
                      }))
                    }
                  />

                  <div className={styles.imageOptions}>
                    <label>
                      <span>Size</span>
                      <select
                        value={imageSize}
                        onChange={(event) =>
                          setImageSize(event.target.value as ImageSize)
                        }
                      >
                        <option value="1024x1536">Portrait · 1024×1536</option>
                        <option value="1024x1024">Square · 1024×1024</option>
                        <option value="1536x1024">Landscape · 1536×1024</option>
                      </select>
                    </label>

                    <label>
                      <span>Quality</span>
                      <select
                        value={imageQuality}
                        onChange={(event) =>
                          setImageQuality(
                            event.target.value as ImageQuality,
                          )
                        }
                      >
                        <option value="low">Low · Fast draft</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                  </div>

                  {imageError ? (
                    <div className={styles.errorBox}>{imageError}</div>
                  ) : null}

                  <button
                    className={styles.generateImageButton}
                    onClick={generateImage}
                    disabled={isGeneratingImage}
                  >
                    {isGeneratingImage
                      ? "Generating image..."
                      : "◈ Generate image"}
                  </button>
                </div>

                <div className={styles.imagePreview}>
                  {imageDataUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageDataUrl} alt={`Generated visual for ${topic}`} />
                      <button
                        className={styles.downloadButton}
                        onClick={downloadImage}
                      >
                        Download PNG
                      </button>
                    </>
                  ) : (
                    <div className={styles.imagePlaceholder}>
                      <span>◈</span>
                      <strong>Image preview</strong>
                      <small>
                        Generate the content package, then create the image.
                      </small>
                    </div>
                  )}
                </div>
              </div>
            )}
          </article>
        </div>

        <aside className={styles.history}>
          <div className={styles.historyHeading}>
            <span className={styles.badge}>History</span>
            <h2>Recent generations</h2>
          </div>

          <div className={styles.historyList}>
            {history.length === 0 ? (
              <p className={styles.emptyHistory}>No generations yet.</p>
            ) : (
              history.map((item, index) => (
                <button
                  key={`${item}-${index}`}
                  className={styles.historyItem}
                  onClick={() => setTopic(item)}
                >
                  <span>{item}</span>
                  <small>{index === 0 ? "Just now" : "Earlier"}</small>
                </button>
              ))
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}

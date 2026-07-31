"use client";

import { useEffect, useState } from "react";
import { AiWorkspace, WorkspaceResult } from "./AiWorkspace";
import { AiTopicSuggestions } from "./AiTopicSuggestions";
import styles from "./AiStudio.module.css";

import { API_URL } from "@/lib/api";
const platformOptions = [
  "Facebook",
  "Telegram",
  "Reels",
  "Image Prompt",
] as const;

type StudioPlatform = (typeof platformOptions)[number];

type StudioAsset = {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  collection: string | null;
  remark: string | null;
  aiEnabled: boolean;
};

export function AiStudio() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState("Nostalgia");
  const [language, setLanguage] = useState("Chinese");
  const [platforms, setPlatforms] = useState<StudioPlatform[]>([
    ...platformOptions,
  ]);
  const [campaignId, setCampaignId] = useState("");
  const [ideaId, setIdeaId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [result, setResult] = useState<WorkspaceResult | null>(null);
  const [availableAssets, setAvailableAssets] = useState<StudioAsset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<StudioAsset[]>([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState(
    "Enter a topic and click Generate content.",
  );

  useEffect(() => {
    let cancelled = false;

    async function initialiseWorkspace() {
      const params = new URLSearchParams(window.location.search);

      const topicParam = params.get("topic") || "";
      const styleParam = params.get("style") || "";
      const languageParam = params.get("language") || "";
      const campaignParam = params.get("campaignId") || "";
      const ideaParam = params.get("ideaId") || "";
      const campaignNameParam = params.get("campaignName") || "";
      const ideaTitleParam = params.get("ideaTitle") || "";
      const historyParam = params.get("historyId") || "";

      if (topicParam) setTopic(topicParam);
      if (styleParam) setStyle(styleParam);
      if (languageParam) setLanguage(languageParam);
      if (campaignParam) setCampaignId(campaignParam);
      if (ideaParam) setIdeaId(ideaParam);
      if (campaignNameParam) setCampaignName(campaignNameParam);
      if (ideaTitleParam) setIdeaTitle(ideaTitleParam);

      if (!historyParam) {
        if (campaignParam || ideaParam) {
          setMessage("Campaign context loaded. Ready to generate.");
        }

        return;
      }

      setMessage("Restoring saved AI workspace...");

      try {
        const response = await fetch(`${API_URL}/history/${historyParam}`, {
          cache: "no-store",
        });

        const record = (await response.json()) as {
          id: string;
          topic: string;
          style: string;
          language: string;
          facebook: string;
          telegram: string;
          reels: string;
          imagePrompt: string;
          analysis: WorkspaceResult["analysis"];
          campaign: {
            id: string;
            name: string;
          } | null;
          idea: {
            id: string;
            title: string;
          } | null;
          message?: string;
        };

        if (!response.ok || !record.id) {
          throw new Error(record.message || "Unable to restore workspace.");
        }

        if (cancelled) return;

        setTopic(record.topic);
        setStyle(record.style);
        setLanguage(record.language);

        if (record.campaign) {
          setCampaignId(record.campaign.id);
          setCampaignName(record.campaign.name);
        }

        if (record.idea) {
          setIdeaId(record.idea.id);
          setIdeaTitle(record.idea.title);
        }

        const restoredResult: WorkspaceResult = {
          facebook: record.facebook,
          telegram: record.telegram,
          reels: record.reels,
          image: record.imagePrompt,
          analysis: record.analysis,
          historyId: record.id,
          ...(record.campaign
            ? {
                campaignUsed: {
                  id: record.campaign.id,
                  name: record.campaign.name,
                },
              }
            : {}),
          ...(record.idea
            ? {
                ideaUsed: {
                  id: record.idea.id,
                  title: record.idea.title,
                },
              }
            : {}),
        };

        setResult(restoredResult);
        setMessage(
          record.campaign
            ? `Workspace restored · Linked to ${record.campaign.name}`
            : "Workspace restored from Content History.",
        );
      } catch (error) {
        if (cancelled) return;

        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to restore workspace.",
        );
      }
    }

    void initialiseWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

  function togglePlatform(platform: StudioPlatform) {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        if (current.length === 1) {
          setMessage("Select at least one platform.");

          return current;
        }

        return current.filter((item) => item !== platform);
      }

      return [...current, platform];
    });
  }

  async function openAssetPicker() {
    setIsAssetPickerOpen(true);

    if (availableAssets.length) {
      return;
    }

    setIsLoadingAssets(true);

    try {
      const response = await fetch(`${API_URL}/assets?type=IMAGE`, {
        cache: "no-store",
      });

      const data = (await response.json()) as
        | StudioAsset[]
        | {
            message?: string;
          };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.message
            ? data.message
            : "Unable to load Asset Library.",
        );
      }

      setAvailableAssets(data.filter((asset) => asset.aiEnabled));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Asset Library.",
      );
    } finally {
      setIsLoadingAssets(false);
    }
  }

  function toggleAsset(asset: StudioAsset) {
    setSelectedAssets((current) => {
      const exists = current.some((item) => item.id === asset.id);

      if (exists) {
        return current.filter((item) => item.id !== asset.id);
      }

      if (current.length >= 4) {
        setMessage("You can attach up to 4 assets.");
        return current;
      }

      return [...current, asset];
    });
  }

  function removeSelectedAsset(assetId: string) {
    setSelectedAssets((current) =>
      current.filter((asset) => asset.id !== assetId),
    );
  }

  async function generateContent() {
    if (!topic.trim()) {
      setMessage("Topic is required.");
      return;
    }

    if (!platforms.length) {
      setMessage("Select at least one platform.");
      return;
    }

    setIsGenerating(true);
    setMessage("Reading Brand Brain and Campaign context...");

    try {
      const response = await fetch(`${API_URL}/ai/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: topic.trim(),
          platforms,
          style,
          language,
          campaignId: campaignId || undefined,
          ideaId: ideaId || undefined,
          assetIds: selectedAssets.map((asset) => asset.id),
        }),
      });

      setMessage("Building platform-specific outputs...");

      const data = (await response.json()) as
        WorkspaceResult | { message?: string };

      if (!response.ok || !("facebook" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to generate content.",
        );
      }

      setResult(data);
      setMessage(
        data.campaignUsed
          ? `Workspace complete · Saved to ${data.campaignUsed.name}`
          : "Workspace complete · Saved to Content History",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to generate content.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>AI Studio</p>
          <h1>Build a complete marketing workspace.</h1>
          <p>
            Generate, compare and manage every platform output without leaving
            one unified workspace.
          </p>
        </div>

        {campaignId ? (
          <div className={styles.contextCard}>
            <div className={styles.contextHeading}>
              <span>Campaign context</span>
              <strong>{campaignName || "Selected campaign"}</strong>
              <small>{ideaTitle || topic || "Selected content idea"}</small>
            </div>

            <div className={styles.contextActions}>
              <a href={`/campaigns/${encodeURIComponent(campaignId)}`}>
                Back to campaign
              </a>

              <a
                href={`/campaigns/${encodeURIComponent(campaignId)}?tab=assets`}
              >
                Campaign assets
              </a>

              {result?.historyId ? (
                <a
                  href={`/content-history?historyId=${encodeURIComponent(
                    result.historyId,
                  )}`}
                >
                  Open history
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.layout}>
        <aside className={styles.formCard}>
          <label className={styles.field}>
            <span>Topic</span>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Enter a content topic..."
            />
          </label>

          <AiTopicSuggestions
            style={style}
            language={language}
            platforms={platforms}
            campaignId={campaignId || undefined}
            onSelect={setTopic}
            onMessage={setMessage}
          />

          <div className={styles.platforms}>
            <span>Platforms</span>
            <div>
              {platformOptions.map((platform) => {
                const selected = platforms.includes(platform);

                return (
                  <button
                    type="button"
                    key={platform}
                    aria-pressed={selected}
                    className={
                      selected ? styles.activePlatform : styles.inactivePlatform
                    }
                    onClick={() => togglePlatform(platform)}
                  >
                    <span>{selected ? "✓" : "+"}</span>
                    {platform}
                  </button>
                );
              })}
            </div>
          </div>

          <label className={styles.field}>
            <span>Style</span>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value)}
            >
              <option>Nostalgia</option>
              <option>Funny</option>
              <option>Motivation</option>
              <option>Lifestyle</option>
              <option>Soft Sell</option>
              <option>Educational</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Language</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option>Chinese</option>
              <option>English</option>
              <option>Bilingual</option>
            </select>
          </label>

          <div className={styles.assetSection}>
            <div className={styles.assetSectionHeader}>
              <div>
                <span>Attached assets</span>
                <small>Choose up to 4 AI-enabled images.</small>
              </div>

              <button type="button" onClick={() => void openAssetPicker()}>
                + Choose assets
              </button>
            </div>

            {selectedAssets.length ? (
              <div className={styles.selectedAssets}>
                {selectedAssets.map((asset) => (
                  <div className={styles.selectedAsset} key={asset.id}>
                    <img
                      src={asset.thumbnailUrl || asset.url}
                      alt={asset.name}
                    />

                    <div>
                      <strong>{asset.name}</strong>
                      <small>{asset.collection || "No collection"}</small>
                    </div>

                    <button
                      type="button"
                      aria-label={`Remove ${asset.name}`}
                      onClick={() => removeSelectedAsset(asset.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.noAssets}>No assets attached.</p>
            )}
          </div>

          {campaignId ? (
            <div className={styles.linkedContext}>
              <span>Linked workflow</span>
              <strong>{campaignName || campaignId}</strong>
              <small>
                {ideaTitle || ideaId || "Campaign-level generation"}
              </small>

              <div className={styles.linkedMeta}>
                <span>
                  Campaign
                  <strong>{campaignId}</strong>
                </span>

                <span>
                  Idea
                  <strong>{ideaId || "Campaign-level"}</strong>
                </span>

                <span>
                  History
                  <strong>
                    {result?.historyId ? "Saved" : "Created after generation"}
                  </strong>
                </span>
              </div>
            </div>
          ) : null}

          <button
            className={styles.generateButton}
            onClick={() => void generateContent()}
            disabled={isGenerating}
          >
            {isGenerating ? "Generating workspace..." : "✦ Generate workspace"}
          </button>

          <p className={styles.message}>{message}</p>
        </aside>

        <AiWorkspace
          topic={topic}
          result={result}
          campaignId={campaignId || undefined}
          publishTopic={topic}
          publishCampaignId={campaignId || undefined}
          isGenerating={isGenerating}
          statusMessage={message}
          onMessage={setMessage}
          onResultChange={setResult}
        />
      </section>
      {isAssetPickerOpen ? (
        <div
          className={styles.assetModalBackdrop}
          onMouseDown={() => setIsAssetPickerOpen(false)}
        >
          <div
            className={styles.assetModal}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.assetModalHeader}>
              <div>
                <p className={styles.eyebrow}>Asset Library</p>
                <h2>Choose AI assets</h2>
              </div>

              <button
                type="button"
                onClick={() => setIsAssetPickerOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <input
              className={styles.assetSearch}
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              placeholder="Search asset name, collection or remark..."
            />

            <p className={styles.assetPickerStatus}>
              {selectedAssets.length}/4 selected
            </p>

            {isLoadingAssets ? (
              <p className={styles.assetPickerMessage}>
                Loading Asset Library...
              </p>
            ) : (
              <div className={styles.assetPickerGrid}>
                {availableAssets
                  .filter((asset) => {
                    const query = assetSearch.trim().toLowerCase();

                    if (!query) return true;

                    return [
                      asset.name,
                      asset.collection || "",
                      asset.remark || "",
                    ].some((value) => value.toLowerCase().includes(query));
                  })
                  .map((asset) => {
                    const selected = selectedAssets.some(
                      (item) => item.id === asset.id,
                    );

                    return (
                      <button
                        className={
                          selected
                            ? styles.assetPickerCardSelected
                            : styles.assetPickerCard
                        }
                        type="button"
                        key={asset.id}
                        onClick={() => toggleAsset(asset)}
                      >
                        <img
                          src={asset.thumbnailUrl || asset.url}
                          alt={asset.name}
                        />

                        <div>
                          <strong>{asset.name}</strong>
                          <small>{asset.collection || "No collection"}</small>
                          <p>{asset.remark || "No AI remark saved."}</p>
                        </div>

                        <span>{selected ? "✓" : "+"}</span>
                      </button>
                    );
                  })}
              </div>
            )}

            <div className={styles.assetModalActions}>
              <button type="button" onClick={() => setSelectedAssets([])}>
                Clear
              </button>

              <button
                className={styles.generateButton}
                type="button"
                onClick={() => setIsAssetPickerOpen(false)}
              >
                Use selected assets
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

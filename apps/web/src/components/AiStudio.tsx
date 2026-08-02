"use client";

import { useEffect, useState } from "react";
import { AiWorkspace, WorkspaceResult } from "./AiWorkspace";
import { AiTopicSuggestions } from "./AiTopicSuggestions";
import styles from "./AiStudio.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
import { waitForBackgroundJob } from "@/lib/background-job";
const AI_STUDIO_JOB_KEY = "atlas-ai-studio-background-job";
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
  const { language: interfaceLanguage } = usePreferences();

  function ui(en: string, zh: string) {
    return interfaceLanguage === "zh" ? zh : en;
  }

  function styleLabel(value: string) {
    const labels: Record<string, [string, string]> = {
      Nostalgia: ["Nostalgia", "怀旧"],
      Funny: ["Funny", "搞笑"],
      Motivation: ["Motivation", "励志"],
      Lifestyle: ["Lifestyle", "生活方式"],
      "Soft Sell": ["Soft Sell", "软性推广"],
      Educational: ["Educational", "教育内容"],
    };

    const matched = labels[value];
    return matched ? ui(matched[0], matched[1]) : value;
  }

  function contentLanguageLabel(value: string) {
    const labels: Record<string, [string, string]> = {
      Chinese: ["Chinese", "中文"],
      English: ["English", "英文"],
      Bilingual: ["Bilingual", "中英双语"],
    };

    const matched = labels[value];
    return matched ? ui(matched[0], matched[1]) : value;
  }

  function platformLabel(value: StudioPlatform) {
    if (value === "Image Prompt") {
      return ui("Image Prompt", "图片提示词");
    }

    return value;
  }

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
    ui("Enter a topic and click Generate content.", "输入主题后点击生成内容。"),
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
          setMessage(
            ui(
              "Campaign context loaded. Ready to generate.",
              "已载入营销活动背景，可以开始生成。",
            ),
          );
        }

        return;
      }

      setMessage(
        ui("Restoring saved AI workspace...", "正在恢复已保存的 AI 工作区……"),
      );

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
          throw new Error(
            record.message ||
              ui("Unable to restore workspace.", "无法恢复 AI 工作区。"),
          );
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
            ? ui(
                `Workspace restored · Linked to ${record.campaign.name}`,
                `工作区已恢复 · 已关联 ${record.campaign.name}`,
              )
            : ui(
                "Workspace restored from Content History.",
                "已从内容历史恢复工作区。",
              ),
        );
      } catch (error) {
        if (cancelled) return;

        setMessage(
          error instanceof Error
            ? error.message
            : ui("Unable to restore workspace.", "无法恢复 AI 工作区。"),
        );
      }
    }

    void initialiseWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const pendingJobId = window.localStorage.getItem(AI_STUDIO_JOB_KEY);
    if (!pendingJobId) return;

    setIsGenerating(true);
    setMessage("Restoring AI task running in the background...");
    void completeJob(pendingJobId);
  }, []);

  async function completeJob(jobId: string) {
    try {
      const data = await waitForBackgroundJob<WorkspaceResult>(
        `${API_URL}/ai/jobs/${jobId}`,
      );
      window.localStorage.removeItem(AI_STUDIO_JOB_KEY);
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
      if (
        !(error instanceof Error) ||
        !error.message.includes("still running")
      ) {
        window.localStorage.removeItem(AI_STUDIO_JOB_KEY);
      }
    } finally {
      setIsGenerating(false);
    }
  }

  function togglePlatform(platform: StudioPlatform) {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        if (current.length === 1) {
          setMessage(
            ui("Select at least one platform.", "请至少选择一个平台。"),
          );

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
            : ui("Unable to load Asset Library.", "无法加载素材库。"),
        );
      }

      setAvailableAssets(data.filter((asset) => asset.aiEnabled));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : ui("Unable to load Asset Library.", "无法加载素材库。"),
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
        setMessage(
          ui("You can attach up to 4 assets.", "最多可附加 4 个素材。"),
        );
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
      setMessage(ui("Topic is required.", "请填写主题。"));
      return;
    }

    if (!platforms.length) {
      setMessage(ui("Select at least one platform.", "请至少选择一个平台。"));
      return;
    }

    setIsGenerating(true);
    setMessage(
      ui(
        "Reading Brand Brain and Campaign context...",
        "正在读取品牌大脑与营销活动背景……",
      ),
    );

    try {
      const response = await fetch(`${API_URL}/ai/jobs`, {
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

      const job = (await response.json()) as {
        id?: string;
        message?: string;
      };

      if (!response.ok || !job.id) {
        throw new Error(
          job.message
            ? job.message
            : ui("Unable to generate content.", "无法生成内容。"),
        );
      }
      window.localStorage.setItem(AI_STUDIO_JOB_KEY, job.id);
      setMessage(
        ui(
          "AI task is running safely in the background...",
          "AI 任务正在后台安全运行……",
        ),
      );
      await completeJob(job.id);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : ui("Unable to generate content.", "无法生成内容。"),
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{ui("AI Studio", "AI 工作室")}</p>
          <h1>
            {ui(
              "Build a complete marketing workspace.",
              "建立完整的营销工作区。",
            )}
          </h1>
          <p>
            {ui(
              "Generate, compare and manage every platform output without leaving one unified workspace.",
              "在统一工作区内生成、比较并管理各个平台的内容。",
            )}
          </p>
        </div>

        {campaignId ? (
          <div className={styles.contextCard}>
            <div className={styles.contextHeading}>
              <span>{ui("Campaign context", "营销活动背景")}</span>
              <strong>
                {campaignName || ui("Selected campaign", "已选择的营销活动")}
              </strong>
              <small>
                {ideaTitle ||
                  topic ||
                  ui("Selected content idea", "已选择的内容创意")}
              </small>
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
            <span>{ui("Topic", "主题")}</span>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={ui("Enter a content topic...", "输入内容主题……")}
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
            <span>{ui("Platforms", "平台")}</span>
            <div>
              {platformOptions.map((platform) => {
                const selected = platforms.includes(platform);

                return (
                  <button
                    type="button"
                    key={platformLabel(platform)}
                    aria-pressed={selected}
                    className={
                      selected ? styles.activePlatform : styles.inactivePlatform
                    }
                    onClick={() => togglePlatform(platform)}
                  >
                    <span>{selected ? "✓" : "+"}</span>
                    {platformLabel(platform)}
                  </button>
                );
              })}
            </div>
          </div>

          <label className={styles.field}>
            <span>{ui("Style", "风格")}</span>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value)}
            >
              <option value="Nostalgia">{styleLabel("Nostalgia")}</option>
              <option value="Funny">{styleLabel("Funny")}</option>
              <option value="Motivation">{styleLabel("Motivation")}</option>
              <option value="Lifestyle">{styleLabel("Lifestyle")}</option>
              <option value="Soft Sell">{styleLabel("Soft Sell")}</option>
              <option value="Educational">{styleLabel("Educational")}</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>{ui("Language", "内容语言")}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="Chinese">{contentLanguageLabel("Chinese")}</option>
              <option value="English">{contentLanguageLabel("English")}</option>
              <option value="Bilingual">
                {contentLanguageLabel("Bilingual")}
              </option>
            </select>
          </label>

          <div className={styles.assetSection}>
            <div className={styles.assetSectionHeader}>
              <div>
                <span>{ui("Attached assets", "附加素材")}</span>
                <small>
                  {ui(
                    "Choose up to 4 AI-enabled images.",
                    "最多选择 4 张已启用 AI 的图片。",
                  )}
                </small>
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
                      <small>
                        {asset.collection || ui("No collection", "未分类")}
                      </small>
                    </div>

                    <button
                      type="button"
                      aria-label={ui(
                        `Remove ${asset.name}`,
                        `移除 ${asset.name}`,
                      )}
                      onClick={() => removeSelectedAsset(asset.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.noAssets}>
                {ui("No assets attached.", "尚未附加素材。")}
              </p>
            )}
          </div>

          {campaignId ? (
            <div className={styles.linkedContext}>
              <span>{ui("Linked workflow", "关联工作流程")}</span>
              <strong>{campaignName || campaignId}</strong>
              <small>
                {ideaTitle ||
                  ideaId ||
                  ui("Campaign-level generation", "营销活动层级生成")}
              </small>

              <div className={styles.linkedMeta}>
                <span>
                  {ui("Campaign", "营销活动")}
                  <strong>{campaignId}</strong>
                </span>

                <span>
                  Idea
                  <strong>{ideaId || "Campaign-level"}</strong>
                </span>

                <span>
                  {ui("History", "历史记录")}
                  <strong>
                    {result?.historyId
                      ? ui("Saved", "已保存")
                      : ui("Created after generation", "生成后创建")}
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
            {isGenerating
              ? ui("Generating workspace...", "正在生成工作区……")
              : ui("✦ Generate workspace", "✦ 生成工作区")}
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
                <p className={styles.eyebrow}>
                  {ui("Asset Library", "素材库")}
                </p>
                <h2>{ui("Choose AI assets", "选择 AI 素材")}</h2>
              </div>

              <button
                type="button"
                onClick={() => setIsAssetPickerOpen(false)}
                aria-label={ui("Close", "关闭")}
              >
                ×
              </button>
            </div>

            <input
              className={styles.assetSearch}
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              placeholder={ui(
                "Search asset name, collection or remark...",
                "搜索素材名称、分类或备注……",
              )}
            />

            <p className={styles.assetPickerStatus}>
              {selectedAssets.length}/4 {ui("selected", "已选择")}
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
                          <small>
                            {asset.collection || ui("No collection", "未分类")}
                          </small>
                          <p>
                            {asset.remark ||
                              ui("No AI remark saved.", "尚未保存 AI 备注。")}
                          </p>
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

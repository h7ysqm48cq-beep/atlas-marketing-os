"use client";

import { useEffect, useState, useRef } from "react";
import { AiWorkspace, WorkspaceResult } from "./AiWorkspace";
import { AiTopicSuggestions } from "./AiTopicSuggestions";
import { RuntimeImage } from "./RuntimeImage";
import styles from "./AiStudio.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
import { waitForBackgroundJob } from "@/lib/background-job";
import { useAtlasWorkspace } from "./ai-workspace-context";
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

type RecentHistory = {
  id: string;
  topic: string;
  style: string;
  language: string;
  status: string;
  createdAt: string;
  brand: {
    name: string;
  };
};

export type ExternalGenerationRequest = {
  requestId: number;
  mode: "prompt" | "image";
};

export type ExternalGenerationEvent = {
  requestId: number;
  mode: "prompt" | "image";
  phase: "workspace" | "image" | "done" | "error";
  message?: string;
};

export function AiStudio({
  externalGenerateRequest,
  onExternalGenerationEvent,
}: {
  externalGenerateRequest?: ExternalGenerationRequest | null;

  onExternalGenerationEvent?: (event: ExternalGenerationEvent) => void;
}) {
  const workspace = useAtlasWorkspace();

  const lastRestoreCommandRef = useRef<number | null>(null);

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

  const topic = workspace.topic;
  const setTopic = workspace.setTopic;
  const [style, setStyle] = useState("Nostalgia");
  const [language, setLanguage] = useState("Chinese");
  const [platforms, setPlatforms] = useState<StudioPlatform[]>(["Facebook"]);
  const campaignId = workspace.campaignId;
  const setCampaignId = workspace.setCampaignId;
  const ideaId = workspace.ideaId;
  const setIdeaId = workspace.setIdeaId;
  const [campaignName, setCampaignName] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [result, setResult] = useState<WorkspaceResult | null>(null);

  /*
   * ELENA_TO_STUDIO_REVERSE_SYNC
   *
   * Elena updates AtlasWorkspace draft.
   * This effect applies those changes to
   * the real AI Studio result.
   */
  useEffect(() => {
    if (!result) {
      return;
    }

    const nextFacebook = workspace.draft.facebook ?? result.facebook;

    const nextTelegram = workspace.draft.telegram ?? result.telegram;

    const nextReels = workspace.draft.reels ?? result.reels;

    const nextImage = workspace.draft.imagePrompt ?? result.image;

    const changed =
      nextFacebook !== result.facebook ||
      nextTelegram !== result.telegram ||
      nextReels !== result.reels ||
      nextImage !== result.image;

    if (!changed) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Mirror the shared workspace draft into this editor when it changes externally.
    setResult((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,

        facebook: workspace.draft.facebook ?? current.facebook,

        telegram: workspace.draft.telegram ?? current.telegram,

        reels: workspace.draft.reels ?? current.reels,

        image: workspace.draft.imagePrompt ?? current.image,
      };
    });
  }, [
    workspace.draft.facebook,
    workspace.draft.telegram,
    workspace.draft.reels,
    workspace.draft.imagePrompt,
    result,
  ]);

  /*
   * Keep Atlas Workspace synchronized with the
   * current Studio state.
   *
   * Elena reads this shared context directly.
   */
  useEffect(() => {
    workspace.setStyle(style);
  }, [style]); // eslint-disable-line react-hooks/exhaustive-deps -- Workspace setter identity is stable; style is the synchronization trigger.

  useEffect(() => {
    workspace.setLanguage(language);
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps -- Workspace setter identity is stable; language is the synchronization trigger.

  useEffect(() => {
    if (!result) {
      return;
    }

    workspace.setHistoryId(result.historyId || "");

    workspace.setDraft({
      facebook: result.facebook || undefined,

      telegram: result.telegram || undefined,

      reels: result.reels || undefined,

      imagePrompt: result.image || undefined,
    });
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps -- Workspace setters are stable and result is the synchronization trigger.

  const [availableAssets, setAvailableAssets] = useState<StudioAsset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<StudioAsset[]>([]);

  /*
   * ELENA_RESTORE_HISTORY_COMMAND
   *
   * Restore a previous GenerationHistory item
   * directly into the current AI Studio.
   */
  useEffect(() => {
    const command = workspace.command;

    if (!command || command.type !== "restore-history") {
      return;
    }

    if (lastRestoreCommandRef.current === command.id) {
      return;
    }

    lastRestoreCommandRef.current = command.id;

    let cancelled = false;

    const restoreCommand = command;

    async function restoreHistory() {
      try {
        setMessage(
          ui(
            "Restoring previous AI Studio work...",
            "正在恢复之前的 AI Studio 内容……",
          ),
        );

        const response = await fetch(
          `${API_URL}/history/${restoreCommand.historyId}`,
          {
            cache: "no-store",
          },
        );

        const record = await response.json();

        if (!response.ok || !record?.id) {
          throw new Error(
            record?.message || "Unable to restore Studio history.",
          );
        }

        if (cancelled) {
          return;
        }

        setTopic(record.topic || "");

        setStyle(record.style || "Nostalgia");

        setLanguage(record.language || "Chinese");

        setCampaignId(record.campaign?.id || "");

        setCampaignName(record.campaign?.name || "");

        setIdeaId(record.idea?.id || "");

        setIdeaTitle(record.idea?.title || "");

        setResult({
          facebook: record.facebook || "",

          telegram: record.telegram || "",

          reels: record.reels || "",

          image: record.imagePrompt || "",

          analysis: record.analysis,

          historyId: record.id,

          campaignUsed: record.campaign
            ? {
                id: record.campaign.id,
                name: record.campaign.name,
              }
            : undefined,

          ideaUsed: record.idea
            ? {
                id: record.idea.id,
                title: record.idea.title,
              }
            : undefined,
        });

        workspace.setHistoryId(record.id);

        workspace.setTopic(record.topic || "");

        workspace.setStyle(record.style || "");

        workspace.setLanguage(record.language || "");

        workspace.setCampaignId(record.campaign?.id || "");

        workspace.setIdeaId(record.idea?.id || "");

        workspace.setDraft({
          facebook: record.facebook || undefined,

          telegram: record.telegram || undefined,

          reels: record.reels || undefined,

          imagePrompt: record.imagePrompt || undefined,
        });

        workspace.addActivity({
          type: "restore",
          label: "Restore completed",
          detail: `${record.topic || "Previous Studio work"} · ${record.id}`,
          status: "success",
        });

        setMessage(ui(`Restored: ${record.topic}`, `已恢复：${record.topic}`));
      } catch (error) {
        const restoreActivityError =
          error instanceof Error
            ? error.message
            : "Unable to restore Studio history.";

        workspace.addActivity({
          type: "restore",
          label: "Restore failed",
          detail: restoreActivityError,
          status: "error",
        });
        if (cancelled) {
          return;
        }

        setMessage(
          error instanceof Error
            ? error.message
            : ui(
                "Unable to restore Studio history.",
                "无法恢复 AI Studio 历史内容。",
              ),
        );
      }
    }

    void restoreHistory();

    return () => {
      cancelled = true;
    };
  }, [workspace.command]); // eslint-disable-line react-hooks/exhaustive-deps -- Commands are intentionally processed once by command identity.

  useEffect(() => {
    workspace.setAssetIds(selectedAssets.map((asset) => asset.id));
  }, [selectedAssets]); // eslint-disable-line react-hooks/exhaustive-deps -- Workspace setter identity is stable; asset selection is the synchronization trigger.

  const [assetSearch, setAssetSearch] = useState("");
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isUploadingStudioPhotos, setIsUploadingStudioPhotos] =
    useState(false);
  const studioPhotoInputRef = useRef<HTMLInputElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [imageGenerateRequestId, setImageGenerateRequestId] = useState<
    number | null
  >(null);

  const lastExternalRequestRef = useRef<number | null>(null);
  const [recentHistory, setRecentHistory] = useState<RecentHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
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
      const assetParam = params.get("assetId") || "";

      if (topicParam) setTopic(topicParam);
      if (styleParam) setStyle(styleParam);
      if (languageParam) setLanguage(languageParam);
      if (campaignParam) setCampaignId(campaignParam);
      if (ideaParam) setIdeaId(ideaParam);
      if (campaignNameParam) setCampaignName(campaignNameParam);
      if (ideaTitleParam) setIdeaTitle(ideaTitleParam);

      if (assetParam) {
        try {
          const assetResponse = await fetch(`${API_URL}/assets/${assetParam}`, {
            cache: "no-store",
          });
          const asset = (await assetResponse.json()) as StudioAsset & {
            message?: string;
          };

          if (!assetResponse.ok || !asset.id) {
            throw new Error(asset.message || "Unable to attach asset.");
          }

          if (!cancelled) {
            setSelectedAssets([asset]);
            setMessage(
              ui(
                `“${asset.name}” attached from Asset Library.`,
                `已从素材库附加“${asset.name}”。`,
              ),
            );
          }
        } catch (error) {
          if (!cancelled) {
            setMessage(
              error instanceof Error
                ? error.message
                : ui("Unable to attach asset.", "无法附加素材。"),
            );
          }
        }
      }

      if (!historyParam) {
        if ((campaignParam || ideaParam) && !assetParam) {
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- Initial browser workspace restoration runs once on mount.

  useEffect(() => {
    let cancelled = false;

    async function loadRecentHistory() {
      try {
        const response = await fetch(`${API_URL}/history`, {
          cache: "no-store",
        });
        const data = (await response.json()) as
          RecentHistory[] | { message?: string };

        if (!response.ok || !Array.isArray(data)) {
          throw new Error("Unable to load history.");
        }

        if (!cancelled) setRecentHistory(data.slice(0, 6));
      } catch {
        if (!cancelled) setRecentHistory([]);
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    }

    void loadRecentHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const pendingJobId = window.localStorage.getItem(AI_STUDIO_JOB_KEY);
    if (!pendingJobId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore a browser-persisted background job on mount.
    setIsGenerating(true);
    setMessage("Restoring AI task running in the background...");
    void completeJob(pendingJobId).catch(() => undefined);
  }, []);

  async function completeJob(jobId: string): Promise<WorkspaceResult> {
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

      return data;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to generate content.";

      setMessage(errorMessage);

      if (
        !(error instanceof Error) ||
        !error.message.includes("still running")
      ) {
        window.localStorage.removeItem(AI_STUDIO_JOB_KEY);
      }

      throw error;
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
      const response = await fetch(`${API_URL}/assets?type=IMAGE&aiEnabled=true&view=studio`, {
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

  async function uploadStudioPhotos(
    files: File[],
  ) {
    const remainingSlots =
      Math.max(
        0,
        4 -
          selectedAssets.length,
      );

    if (!remainingSlots) {
      setMessage(
        ui(
          "You already attached 4 assets.",
          "已经附加 4 个素材。",
        ),
      );
      return;
    }

    const validFiles =
      files
        .filter(
          (file) =>
            [
              "image/jpeg",
              "image/png",
              "image/webp",
            ].includes(
              file.type,
            ) &&
            file.size <=
              10 *
                1024 *
                1024,
        )
        .slice(
          0,
          remainingSlots,
        );

    if (!validFiles.length) {
      setMessage(
        ui(
          "Choose JPG, PNG or WEBP photos up to 10MB each.",
          "请选择每张不超过 10MB 的 JPG、PNG 或 WEBP 图片。",
        ),
      );
      return;
    }

    setIsUploadingStudioPhotos(
      true,
    );

    setMessage(
      ui(
        `Uploading ${validFiles.length} photo${validFiles.length === 1 ? "" : "s"}...`,
        `正在上传 ${validFiles.length} 张照片……`,
      ),
    );

    const uploaded:
      StudioAsset[] = [];

    try {
      for (
        const file
        of validFiles
      ) {
        const formData =
          new FormData();

        formData.append(
          "file",
          file,
        );

        formData.append(
          "name",
          file.name,
        );

        formData.append(
          "collection",
          "Studio Uploads",
        );

        /*
         * Studio reference images must be
         * AI Ready or AssetContextService
         * intentionally ignores them.
         */
        formData.append(
          "aiEnabled",
          "true",
        );

        const response =
          await fetch(
            `${API_URL}/assets/upload`,
            {
              method: "POST",
              body: formData,
            },
          );

        const data =
          (await response.json()) as
            | StudioAsset
            | {
                message?:
                  | string
                  | string[];
              };

        if (
          !response.ok ||
          !("id" in data)
        ) {
          const detail =
            "message" in data
              ? Array.isArray(
                  data.message,
                )
                ? data.message.join(
                    " ",
                  )
                : data.message
              : undefined;

          throw new Error(
            detail ||
              `Unable to upload ${file.name}.`,
          );
        }

        uploaded.push(data);
      }

      setAvailableAssets(
        (current) => {
          const merged =
            new Map(
              current.map(
                (asset) => [
                  asset.id,
                  asset,
                ],
              ),
            );

          for (
            const asset
            of uploaded
          ) {
            merged.set(
              asset.id,
              asset,
            );
          }

          return Array.from(
            merged.values(),
          );
        },
      );

      setSelectedAssets(
        (current) => {
          const merged =
            [...current];

          for (
            const asset
            of uploaded
          ) {
            if (
              merged.length >= 4
            ) {
              break;
            }

            if (
              !merged.some(
                (item) =>
                  item.id ===
                  asset.id,
              )
            ) {
              merged.push(
                asset,
              );
            }
          }

          return merged;
        },
      );

      setMessage(
        ui(
          `${uploaded.length} phone photo${uploaded.length === 1 ? "" : "s"} attached and AI Ready.`,
          `已加入 ${uploaded.length} 张手机照片，并自动设为 AI Ready。`,
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : ui(
              "Unable to upload phone photos.",
              "无法上传手机照片。",
            ),
      );
    } finally {
      setIsUploadingStudioPhotos(
        false,
      );
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

  async function generateContent(
    platformOverride?: StudioPlatform[],
    externalRequest?: ExternalGenerationRequest,
  ) {
    const requestedPlatforms = platformOverride?.length
      ? platformOverride
      : platforms;

    if (!topic.trim()) {
      const errorMessage = ui("Topic is required.", "请填写主题。");

      setMessage(errorMessage);

      if (externalRequest) {
        onExternalGenerationEvent?.({
          requestId: externalRequest.requestId,

          mode: externalRequest.mode,

          phase: "error",

          message: errorMessage,
        });
      }

      return;
    }

    if (!requestedPlatforms.length) {
      const errorMessage = ui(
        "Select at least one platform.",
        "请至少选择一个平台。",
      );

      setMessage(errorMessage);

      if (externalRequest) {
        onExternalGenerationEvent?.({
          requestId: externalRequest.requestId,

          mode: externalRequest.mode,

          phase: "error",

          message: errorMessage,
        });
      }

      return;
    }

    setIsGenerating(true);

    setMessage(
      ui(
        "Reading Brand Brain and Campaign context...",
        "正在读取品牌大脑与营销活动背景……",
      ),
    );

    if (externalRequest) {
      onExternalGenerationEvent?.({
        requestId: externalRequest.requestId,

        mode: externalRequest.mode,

        phase: "workspace",
      });
    }

    try {
      const response = await fetch(`${API_URL}/ai/jobs`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          topic: topic.trim(),

          platforms: requestedPlatforms,

          style,

          language,

          campaignId: campaignId || undefined,

          ideaId: ideaId || undefined,

          assetIds: selectedAssets.map((asset) => asset.id),
        }),
      });

      const job = (await response.json()) as {
        id?: string;
        status?: string;
        message?: string;
        error?: string;
      };

      if (!response.ok || !job.id) {
        throw new Error(
          job.message || job.error || "Unable to create AI background job.",
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

      if (externalRequest?.mode === "image") {
        /*
         * Content job has completed.
         * result.image + result.historyId now exist.
         *
         * AiWorkspace will mount ImageAssetPanel and
         * ImageAssetPanel will invoke the real image job.
         */
        setImageGenerateRequestId(externalRequest.requestId);

        onExternalGenerationEvent?.({
          requestId: externalRequest.requestId,

          mode: "image",

          phase: "image",
        });
      } else if (externalRequest) {
        onExternalGenerationEvent?.({
          requestId: externalRequest.requestId,

          mode: externalRequest.mode,

          phase: "done",
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : ui("Unable to generate content.", "无法生成内容。");

      setMessage(errorMessage);

      if (externalRequest) {
        onExternalGenerationEvent?.({
          requestId: externalRequest.requestId,

          mode: externalRequest.mode,

          phase: "error",

          message: errorMessage,
        });
      }
    } finally {
      setIsGenerating(false);
    }
  }

  /*
   * External MobileShell generation request.
   *
   * Prompt:
   * use currently selected platforms.
   *
   * Image:
   * generate Image Prompt first, then real image.
   */
  useEffect(() => {
    const request = externalGenerateRequest;

    if (!request || lastExternalRequestRef.current === request.requestId) {
      return;
    }

    lastExternalRequestRef.current = request.requestId;

    if (request.mode === "image") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Execute an explicit generation command received from the parent workspace.
      void generateContent(["Image Prompt"], request);

      return;
    }

    void generateContent(undefined, request);
  }, [externalGenerateRequest?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps -- External requests are intentionally deduplicated by request id.

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

      <section className={styles.recentSection}>
        <div className={styles.recentHeader}>
          <div>
            <p className={styles.eyebrow}>{ui("Recent work", "最近生成")}</p>
            <h2>{ui("Continue from history", "继续之前的内容")}</h2>
          </div>
          <a href="/content-history">
            {ui("View all history", "查看全部历史")} →
          </a>
        </div>

        {isLoadingHistory ? (
          <p className={styles.recentMessage}>
            {ui("Loading history...", "正在加载历史记录……")}
          </p>
        ) : recentHistory.length ? (
          <div className={styles.recentList}>
            {recentHistory.map((record) => (
              <a
                className={`${styles.recentCard} ${result?.historyId === record.id ? styles.activeRecentCard : ""}`}
                href={`/ai-studio?historyId=${encodeURIComponent(record.id)}`}
                key={record.id}
              >
                <div>
                  <span>{record.brand.name}</span>
                  <small>{record.status}</small>
                </div>
                <strong>{record.topic}</strong>
                <p>
                  {styleLabel(record.style)} ·{" "}
                  {contentLanguageLabel(record.language)}
                </p>
                <time dateTime={record.createdAt}>
                  {new Intl.DateTimeFormat(
                    interfaceLanguage === "zh" ? "zh-CN" : "en-MY",
                    {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  ).format(new Date(record.createdAt))}
                </time>
              </a>
            ))}
          </div>
        ) : (
          <p className={styles.recentMessage}>
            {ui("No previous generations yet.", "还没有之前的生成记录。")}
          </p>
        )}
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

              <div className={styles.assetSectionActions}>
                <input
                  ref={studioPhotoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  disabled={isUploadingStudioPhotos}
                  onChange={(event) => {
                    const files = Array.from(
                      event.target.files ?? [],
                    );

                    if (files.length) {
                      void uploadStudioPhotos(files);
                    }

                    event.target.value = "";
                  }}
                />

                <button
                  type="button"
                  disabled={isUploadingStudioPhotos}
                  onClick={() =>
                    studioPhotoInputRef.current?.click()
                  }
                >
                  {isUploadingStudioPhotos
                    ? ui("Uploading...", "上传中...")
                    : ui(
                        "📱 Phone photos",
                        "📱 手机 / 设备照片",
                      )}
                </button>

                <button
                  type="button"
                  onClick={() => void openAssetPicker()}
                >
                  + {ui("Choose assets", "选择素材")}
                </button>
              </div>
            </div>

            {selectedAssets.length ? (
              <div className={styles.selectedAssets}>
                {selectedAssets.map((asset) => (
                  <div className={styles.selectedAsset} key={asset.id}>
                    <RuntimeImage
                      src={asset.thumbnailUrl || asset.url}
                      alt={asset.name}
                      loading="lazy"
                      sizes="46px"
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

          imageGenerateRequestId={imageGenerateRequestId ?? undefined}

          onImageGenerateSettled={({
            requestId,
            success,
            message: imageMessage,
          }) => {
            if (requestId !== imageGenerateRequestId) {
              return;
            }

            setImageGenerateRequestId(null);

            onExternalGenerationEvent?.({
              requestId,

              mode: "image",

              phase: success ? "done" : "error",

              message: imageMessage,
            });
          }}
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
                        <RuntimeImage
                          src={asset.thumbnailUrl || asset.url}
                          alt={asset.name}
                          loading="lazy"
                          sizes="(max-width: 560px) 100vw, (max-width: 820px) 50vw, 300px"
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

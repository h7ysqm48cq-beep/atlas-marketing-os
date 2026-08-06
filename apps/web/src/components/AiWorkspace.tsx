"use client";

import { useEffect, useMemo, useState } from "react";
import { AtlasCopilot } from "./AtlasCopilot";
import { marketingCopilotPipeline } from "./copilot-sdk";
import { AiPublishCard } from "./AiPublishCard";
import { AiAutoQueueCard } from "./AiAutoQueueCard";
import { ImageAssetPanel } from "./ImageAssetPanel";
import { ImageEditorV2 } from "./ImageEditorV2";
import { PlatformCard } from "./PlatformCard";
import { PromptInspector } from "./prompt-inspector/PromptInspector";
import styles from "./AiWorkspace.module.css";

import { API_URL } from "@/lib/api";

export type ContentStatus =
  | "DRAFT"
  | "AI_IMPROVED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "PUBLISHED";

export type ApprovalState = {
  status: ContentStatus;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
};

export type WorkspaceResult = {
  facebook: string;
  telegram: string;
  reels: string;
  image: string;
  analysis: {
    summary: string;
    viralScore: number;
    discussionScore: number;
    shareabilityScore: number;
    brandFitScore: number;
    bestPostingTime: string;
  };
  factualGuard?: {
    passed: boolean;
    revised: boolean;
    factualRiskScore: number;
    entityRiskScore: number;
    promotionalRiskScore: number;
    detectedIssues: string[];
    corrections: string[];
    reviewer: "AI" | "FALLBACK";
  };
  qualityGate?: {
    passed: boolean;
    revised: boolean;
    overallScore: number;
    brandFitScore: number;
    platformFitScore: number;
    clarityScore: number;
    engagementScore: number;
    safetyScore: number;
    issues: string[];
    improvements: string[];
    reviewer: "AI" | "FALLBACK";
  };
  campaignUsed?: { id: string; name: string };
  ideaUsed?: { id: string; title: string };
  historyId?: string;
  promptChain?: {
    loadedSourceCount: number;
    totalSourceCount: number;
    sources: Array<{
      key: string;
      label: string;
      loaded: boolean;
      summary: string;
    }>;
    knowledgeUsed?: Array<{
      id: string;
      title: string;
      category: string;
      tags: string[];
      summary: string;
    }>;
    mergedPrompt?: string;
  };
};

type WorkspaceTab = "content" | "analysis" | "image" | "prompt";

export function AiWorkspace({
  topic,
  result,
  campaignId,
  publishTopic,
  publishCampaignId,
  isGenerating,
  statusMessage,
  onMessage,
  onResultChange,
}: {
  topic: string;
  result: WorkspaceResult | null;
  campaignId?: string;
  publishTopic: string;
  publishCampaignId?: string;
  isGenerating: boolean;
  statusMessage: string;
  onMessage: (message: string) => void;
  onResultChange: (result: WorkspaceResult) => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("content");
  const [copilotRequest, setCopilotRequest] = useState<{
    platform: "Facebook" | "Telegram" | "Reels Script" | "Image Prompt";
    action: "improve" | "shorter" | "rewrite";
    nonce: number;
  } | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [approval, setApproval] = useState<ApprovalState>({ status: "DRAFT" });

  useEffect(() => {
    if (!result?.historyId) {
      setApproval({ status: "DRAFT" });
      return;
    }

    let cancelled = false;
    void fetch(`${API_URL}/history/${result.historyId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((record: ApprovalState) => {
        if (!cancelled && record?.status) setApproval(record);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [result?.historyId]);

  type WorkspaceCard = readonly [
  title: string,
  description: string,
  key: "facebook" | "telegram" | "reels" | "image",
  score: number | undefined,
];

const cards = useMemo<WorkspaceCard[]>(
  () => {
    if (!result) {
      return [];
    }

    const candidates: WorkspaceCard[] = [
      [
        "Facebook",
        "Long-form discussion-led social post.",
        "facebook",
        result.analysis.discussionScore,
      ],
      [
        "Telegram",
        "Shorter conversational community post.",
        "telegram",
        result.analysis.shareabilityScore,
      ],
      [
        "Reels Script",
        "Scene-by-scene short-form video structure.",
        "reels",
        result.analysis.viralScore,
      ],
      [
        "Image Prompt",
        "Production-ready visual direction in English.",
        "image",
        result.analysis.brandFitScore,
      ],
    ];

    return candidates.filter(([, , key]) =>
      Boolean(result[key]?.trim()),
    );
  },
  [result],
);

const hasContent = cards.some(([, , key]) => key !== "image");
  const hasImage = Boolean(result?.image?.trim());
  const imageOnly = hasImage && !hasContent;
  const availableTabs = useMemo<WorkspaceTab[]>(() => {
    if (!result) return [];
    if (imageOnly) return ["image", "prompt"];

    const next: WorkspaceTab[] = [];
    if (cards.length) next.push("content");
    if (hasContent) next.push("analysis");
    if (hasImage) next.push("image", "prompt");
    return next;
  }, [cards.length, hasContent, hasImage, imageOnly, result]);

  useEffect(() => {
    if (!availableTabs.length) return;
    if (!availableTabs.includes(tab)) setTab(availableTabs[0]);
  }, [availableTabs, tab]);

  function replace(key: "facebook" | "telegram" | "reels" | "image", content: string) {
    if (!result) return;
    onResultChange({ ...result, [key]: content });
  }

  if (!result) {
    return isGenerating ? (
      <section className={styles.workspace}>
        <AtlasCopilot
          pipeline={marketingCopilotPipeline}
          result={null}
          isGenerating
          statusMessage={statusMessage}
          onAction={() => undefined}
        />
      </section>
    ) : null;
  }

  const fullyLoaded =
    result.promptChain?.loadedSourceCount === result.promptChain?.totalSourceCount;

  const hasPublishableContent = Boolean(
    result?.facebook?.trim() ||
      result?.telegram?.trim() ||
      result?.reels?.trim(),
  );

  const isImageOnly = Boolean(
    result?.image?.trim() &&
      !result?.facebook?.trim() &&
      !result?.telegram?.trim() &&
      !result?.reels?.trim(),
  );

  useEffect(() => {
    if (!result) {
      return;
    }

    setTab(isImageOnly ? "image" : "content");
  }, [result?.historyId, isImageOnly]);

  if (!result) {
    return null;
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.workspaceHeader}>
        <div className={styles.tabs}>
          {availableTabs.map((value) => (
            <button
              type="button"
              key={value}
              className={tab === value ? styles.activeTab : ""}
              onClick={() => setTab(value)}
            >
              {value === "image"
                ? "AI Image"
                : value === "prompt"
                  ? "Prompt"
                  : value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {result.promptChain && !imageOnly ? (
        <section className={styles.knowledgePanel}>
          <button
            type="button"
            className={styles.knowledgeHeader}
            onClick={() => setKnowledgeOpen((value) => !value)}
          >
            <div>
              <p className={styles.eyebrow}>Knowledge Engine</p>
              <h3>
                {result.promptChain.loadedSourceCount} / {result.promptChain.totalSourceCount} sources loaded
              </h3>
            </div>
            <div className={styles.knowledgeControls}>
              <span className={fullyLoaded ? styles.readyStatus : styles.partialStatus}>
                {fullyLoaded ? "Ready" : "Partial"}
              </span>
              <span className={styles.chevron}>{knowledgeOpen ? "Hide" : "Show"}</span>
            </div>
          </button>

          {knowledgeOpen ? (
            <div className={styles.sourceGrid}>
              {result.promptChain.sources.map((source) => (
                <article
                  key={source.key}
                  className={source.loaded ? styles.loadedSource : styles.missingSource}
                >
                  <strong>{source.loaded ? "✓" : "○"} {source.label}</strong>
                  <p>{source.summary}</p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {!isImageOnly ? (
        <AtlasCopilot
          pipeline={marketingCopilotPipeline}
          result={result}
          isGenerating={isGenerating}
          statusMessage={statusMessage}
          onAction={(platform, action) => {
            setTab("content");
            setCopilotRequest({
              platform,
              action,
              nonce: Date.now(),
            });
          }}
        />
      ) : null}

      {tab === "content" ? (
        <div className={styles.cards}>
          {cards.map(([title, description, key, score]) => (
            <PlatformCard
              key={key}
              title={title}
              description={description}
              content={result[key]}
              score={score}
              campaignId={result.campaignUsed?.id || campaignId}
              historyId={result.historyId}
              approval={approval}
              onApprovalChange={setApproval}
              copilotRequest={copilotRequest?.platform === title ? copilotRequest : null}
              onReplace={(content) => replace(key, content)}
              onMessage={onMessage}
            />
          ))}
        </div>
      ) : null}

      {tab === "analysis" ? (
        <div className={styles.analysis}>
          <div className={styles.summary}>
            <p className={styles.eyebrow}>AI Coach Summary</p>
            <h3>{result.analysis.summary}</h3>
            <p>Recommended posting time: <strong>{result.analysis.bestPostingTime || "—"}</strong></p>
          </div>
          <div className={styles.scoreGrid}>
            <Score label="Viral" value={result.analysis.viralScore || 0} />
            <Score label="Discussion" value={result.analysis.discussionScore || 0} />
            <Score label="Shareability" value={result.analysis.shareabilityScore || 0} />
            <Score label="Brand fit" value={result.analysis.brandFitScore || 0} />
          </div>
        </div>
      ) : null}

      {tab === "image" ? (
        <>
          <ImageAssetPanel
            prompt={result.image}
            topic={topic}
            campaignId={result.campaignUsed?.id || campaignId}
            historyId={result.historyId}
          />
          <ImageEditorV2 />
        </>
      ) : null}

      {tab === "prompt" ? (
        <PromptInspector
  promptChain={
    result.promptChain
      ? {
          ...result.promptChain,
          knowledgeUsed:
            result.promptChain.knowledgeUsed?.map(
              (item) => ({
                id: item.id,
                title: item.title,
                category: item.category,
                tags: item.tags,
                summary: item.summary,

                similarity: 0,
                similarityPercent: 0,
                hybridScore: 0,

                scoreBreakdown: {
                  semantic: 0,
                  keyword: 0,
                  usage: 0,
                  freshness: 0,
                  quality: 0,
                },

                matchedTerms: [],
                matchedQueries: [],
                reasons: [],

                embeddingModel: "unknown",
                embeddingDimensions: 0,
                embeddedAt: new Date().toISOString(),
              }),
            ),
        }
      : undefined
  }
  onMessage={onMessage}
/>
      ) : null}

      {hasPublishableContent ? (
        <>
          <AiAutoQueueCard
            result={result}
            campaignId={publishCampaignId}
            topic={publishTopic}
            onMessage={onMessage}
          />
          <AiPublishCard
            result={result}
            campaignId={publishCampaignId}
            topic={publishTopic}
            onMessage={onMessage}
            onResultChange={onResultChange}
          />
        </>
      ) : null}
    </section>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.scoreCard}>
      <div><span>{label}</span><strong>{value}</strong></div>
      <div className={styles.scoreTrack}><i style={{ width: `${value}%` }} /></div>
    </div>
  );
}

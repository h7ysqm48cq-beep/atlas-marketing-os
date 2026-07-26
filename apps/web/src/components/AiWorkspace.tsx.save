"use client";

import { useEffect, useMemo, useState } from "react";
import { AtlasCopilot } from "./AtlasCopilot";
import { ImageAssetPanel } from "./ImageAssetPanel";
import { PlatformCard } from "./PlatformCard";
import styles from "./AiWorkspace.module.css";

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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
  };
};

export function AiWorkspace({
  topic,
  result,
  campaignId,
  isGenerating,
  statusMessage,
  onMessage,
  onResultChange,
}: {
  topic: string;
  result: WorkspaceResult | null;
  campaignId?: string;
  isGenerating: boolean;
  statusMessage: string;
  onMessage: (message: string) => void;
  onResultChange: (result: WorkspaceResult) => void;
}) {
  const [tab, setTab] = useState<"content" | "analysis" | "image">("content");

  const [copilotRequest, setCopilotRequest] = useState<{
    platform: "Facebook" | "Telegram" | "Reels Script" | "Image Prompt";
    action: "improve" | "shorter" | "rewrite";
    nonce: number;
  } | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(true);
  const [approval, setApproval] = useState<ApprovalState>({ status: "DRAFT" });

  useEffect(() => {
    if (!result?.historyId) {
      setApproval({ status: "DRAFT" });
      return;
    }

    let cancelled = false;
    void fetch(`${API_BASE_URL}/history/${result.historyId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((record: ApprovalState) => {
        if (!cancelled && record?.status) setApproval(record);
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [result?.historyId]);

  const cards = useMemo(
    () =>
      [
        ["Facebook", "Long-form discussion-led social post.", "facebook", result?.analysis.discussionScore],
        ["Telegram", "Shorter conversational community post.", "telegram", result?.analysis.shareabilityScore],
        ["Reels Script", "Scene-by-scene short-form video structure.", "reels", result?.analysis.viralScore],
        ["Image Prompt", "Production-ready visual direction in English.", "image", result?.analysis.brandFitScore],
      ] as const,
    [result],
  );

  function replace(key: "facebook" | "telegram" | "reels" | "image", content: string) {
    if (!result) return;
    onResultChange({ ...result, [key]: content });
  }

  const fullyLoaded =
    result?.promptChain?.loadedSourceCount === result?.promptChain?.totalSourceCount;

  return (
    <section className={styles.workspace}>
      <div className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>AI Workspace</p>
          <h2>{topic || "Untitled content workspace"}</h2>
          <p>
            {result?.campaignUsed
              ? `Linked to ${result.campaignUsed.name}`
              : "Generate content to activate the complete workspace."}
          </p>
        </div>

        <div className={styles.tabs}>
          {(["content", "analysis", "image"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={tab === value ? styles.activeTab : ""}
              onClick={() => setTab(value)}
            >
              {value === "image"
                ? "AI Image"
                : value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {result?.promptChain ? (
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
            <>
              <div className={styles.sourceGrid}>
                {result.promptChain.sources.map((source) => (
                  <article
                    key={source.key}
                    className={
                      source.loaded
                        ? styles.loadedSource
                        : styles.missingSource
                    }
                  >
                    <strong>
                      {source.loaded ? "✓" : "○"} {source.label}
                    </strong>
                    <p>{source.summary}</p>
                  </article>
                ))}
              </div>

              {result.promptChain.knowledgeUsed?.length ? (
                <div className={styles.knowledgeUsed}>
                  <div className={styles.knowledgeUsedHeader}>
                    <span>Knowledge used</span>
                    <strong>
                      {result.promptChain.knowledgeUsed.length} documents
                    </strong>
                  </div>

                  <div className={styles.knowledgeDocumentGrid}>
                    {result.promptChain.knowledgeUsed.map((document) => (
                      <article key={document.id}>
                        <div>
                          <span>{document.category}</span>
                          <a href="/knowledge">Open library</a>
                        </div>

                        <h4>{document.title}</h4>
                        <p>{document.summary}</p>

                        <div>
                          {document.tags.slice(0, 5).map((tag) => (
                            <small key={tag}>{tag}</small>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <AtlasCopilot
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

      {tab === "content" ? (
        <div className={styles.cards}>
          {cards.map(([title, description, key, score]) => (
            <PlatformCard
              key={key}
              title={title}
              description={description}
              content={result?.[key] || `Generate content to create the ${title} version.`}
              score={score}
              campaignId={result?.campaignUsed?.id || campaignId}
              historyId={result?.historyId}
              approval={approval}
              onApprovalChange={setApproval}
              copilotRequest={
                copilotRequest?.platform === title
                  ? copilotRequest
                  : null
              }
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
            <h3>{result?.analysis.summary || "Generate content to receive strategic analysis."}</h3>
            <p>
              Recommended posting time: <strong>{result?.analysis.bestPostingTime || "—"}</strong>
            </p>
          </div>

          <div className={styles.scoreGrid}>
            <Score label="Viral" value={result?.analysis.viralScore || 0} />
            <Score label="Discussion" value={result?.analysis.discussionScore || 0} />
            <Score label="Shareability" value={result?.analysis.shareabilityScore || 0} />
            <Score label="Brand fit" value={result?.analysis.brandFitScore || 0} />
          </div>
        </div>
      ) : null}

      {tab === "image" ? (
        <ImageAssetPanel
          prompt={result?.image || ""}
          topic={topic}
          campaignId={result?.campaignUsed?.id || campaignId}
          historyId={result?.historyId}
        />
      ) : null}
    </section>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.scoreCard}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className={styles.scoreTrack}>
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

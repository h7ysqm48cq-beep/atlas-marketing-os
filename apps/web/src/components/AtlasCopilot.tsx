"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceResult } from "./AiWorkspace";
import styles from "./AtlasCopilot.module.css";

type TimelineStage = {
  label: string;
  description: string;
};

type CopilotAction = {
  id: string;
  label: string;
  detail: string;
  platform?: "Facebook" | "Telegram" | "Reels Script" | "Image Prompt";
  action?: "improve" | "shorter" | "rewrite";
};

const generationStages: TimelineStage[] = [
  {
    label: "Reading Brand Brain",
    description: "Applying voice, rules and positioning.",
  },
  {
    label: "Reading Audience",
    description: "Matching tone and cultural relevance.",
  },
  {
    label: "Reading Campaign",
    description: "Aligning the content with the current objective.",
  },
  {
    label: "Planning Platforms",
    description: "Structuring Facebook, Telegram, Reels and Image Prompt.",
  },
  {
    label: "Writing Content",
    description: "Generating platform-specific outputs.",
  },
  {
    label: "Scoring Results",
    description: "Reviewing discussion, shareability and brand fit.",
  },
];

export function AtlasCopilot({
  result,
  isGenerating,
  statusMessage,
  onAction,
}: {
  result: WorkspaceResult | null;
  isGenerating: boolean;
  statusMessage: string;
  onAction: (
    platform: "Facebook" | "Telegram" | "Reels Script" | "Image Prompt",
    action: "improve" | "shorter" | "rewrite",
  ) => void;
}) {
  const [activeStage, setActiveStage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    if (!isGenerating) {
      setActiveStage(result ? generationStages.length : 0);
      return;
    }

    setActiveStage(1);
    const timer = window.setInterval(() => {
      setActiveStage((current) =>
        Math.min(current + 1, generationStages.length - 1),
      );
    }, 900);

    return () => window.clearInterval(timer);
  }, [isGenerating, result]);

  const confidence = useMemo(() => {
    if (!result) return 0;
    const values = [
      result.analysis.viralScore,
      result.analysis.discussionScore,
      result.analysis.shareabilityScore,
      result.analysis.brandFitScore,
    ];
    return Math.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
  }, [result]);

  const progress = isGenerating
    ? Math.max(
        12,
        Math.round((activeStage / generationStages.length) * 100),
      )
    : result
      ? 100
      : 0;

  const suggestions = useMemo<CopilotAction[]>(() => {
    if (!result) {
      return [
        {
          id: "idle-topic",
          label: "Add a clear topic",
          detail: "Enter a focused idea to activate Atlas recommendations.",
        },
        {
          id: "idle-campaign",
          label: "Link campaign context",
          detail: "Campaign context improves strategic alignment.",
        },
      ];
    }

    const items: CopilotAction[] = [];

    items.push(
      result.analysis.discussionScore >= 80
        ? {
            id: "facebook-strong",
            label: "Facebook discussion potential is strong",
            detail: "The hook and question are already suitable for comments.",
          }
        : {
            id: "facebook-improve",
            label: "Strengthen the Facebook discussion hook",
            detail: "Atlas can improve the opening and closing question.",
            platform: "Facebook",
            action: "improve",
          },
    );

    items.push(
      result.analysis.shareabilityScore >= 80
        ? {
            id: "telegram-strong",
            label: "Telegram is ready for community sharing",
            detail: "The post is concise and easy to forward.",
          }
        : {
            id: "telegram-shorter",
            label: "Make Telegram more shareable",
            detail: "Shorten the opening and make the CTA more conversational.",
            platform: "Telegram",
            action: "shorter",
          },
    );

    items.push(
      result.analysis.viralScore >= 80
        ? {
            id: "reels-strong",
            label: "Reels opening has strong recall",
            detail: "The first scene already supports attention retention.",
          }
        : {
            id: "reels-improve",
            label: "Sharpen the first three seconds",
            detail: "Atlas can rewrite the Reels opening for stronger retention.",
            platform: "Reels Script",
            action: "improve",
          },
    );

    items.push(
      result.analysis.brandFitScore >= 85
        ? {
            id: "image-strong",
            label: "Visual direction fits the Brand Brain",
            detail: "The image prompt aligns with the current visual system.",
          }
        : {
            id: "image-rewrite",
            label: "Improve visual brand consistency",
            detail: "Rewrite the image prompt using stronger brand direction.",
            platform: "Image Prompt",
            action: "rewrite",
          },
    );

    return items;
  }, [result]);

  const sourceCount = result?.promptChain?.loadedSourceCount || 0;
  const totalSources = result?.promptChain?.totalSourceCount || 0;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Atlas AI Copilot</p>
          <h3>
            {isGenerating
              ? "Atlas is building your workspace"
              : result
                ? "Workspace analysis complete"
                : "Ready to analyse your next idea"}
          </h3>
          <p className={styles.status}>{statusMessage}</p>
        </div>

        <div className={styles.headerActions}>
          <span
            className={
              isGenerating
                ? styles.thinkingBadge
                : result
                  ? styles.completeBadge
                  : styles.idleBadge
            }
          >
            {isGenerating ? "Thinking" : result ? "Completed" : "Idle"}
          </span>
          {result ? (
            <button type="button" onClick={() => setExplainOpen(true)}>
              Explain scores
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </header>

      {!collapsed ? (
        <div className={styles.body}>
          <div className={styles.progressSection}>
            <div className={styles.progressHeading}>
              <span>AI progress</span>
              <strong>{progress}%</strong>
            </div>
            <div className={styles.progressTrack}>
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className={styles.contentGrid}>
            <div className={styles.timeline}>
              <div className={styles.sectionHeading}>
                <span>Thinking timeline</span>
                <strong>
                  {isGenerating
                    ? `${Math.min(activeStage + 1, generationStages.length)} / ${generationStages.length}`
                    : result
                      ? `${generationStages.length} / ${generationStages.length}`
                      : `0 / ${generationStages.length}`}
                </strong>
              </div>

              <div className={styles.stageList}>
                {generationStages.map((stage, index) => {
                  const completed = Boolean(result) || index < activeStage;
                  const active = isGenerating && index === activeStage;

                  return (
                    <article
                      key={stage.label}
                      className={
                        active
                          ? styles.activeStage
                          : completed
                            ? styles.completedStage
                            : styles.pendingStage
                      }
                    >
                      <span>{completed ? "✓" : active ? "●" : "○"}</span>
                      <div>
                        <strong>{stage.label}</strong>
                        <p>{stage.description}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className={styles.insights}>
              <div className={styles.metrics}>
                <Metric label="Confidence" value={confidence} suffix="%" />
                <Metric
                  label="Brand Match"
                  value={result?.analysis.brandFitScore || 0}
                  suffix="%"
                />
                <Metric
                  label="Context Loaded"
                  value={sourceCount}
                  suffix={totalSources ? `/${totalSources}` : "/0"}
                />
              </div>

              <div className={styles.suggestions}>
                <div className={styles.sectionHeading}>
                  <span>Atlas suggestions</span>
                  <strong>{suggestions.length}</strong>
                </div>

                <div className={styles.suggestionList}>
                  {suggestions.map((suggestion) => (
                    <article key={suggestion.id}>
                      <span>✓</span>
                      <div>
                        <strong>{suggestion.label}</strong>
                        <p>{suggestion.detail}</p>
                      </div>
                      {suggestion.platform && suggestion.action ? (
                        <button
                          type="button"
                          onClick={() =>
                            onAction(
                              suggestion.platform!,
                              suggestion.action!,
                            )
                          }
                        >
                          Improve
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {explainOpen && result ? (
        <div
          className={styles.modalBackdrop}
          onClick={() => setExplainOpen(false)}
        >
          <section
            className={styles.explainModal}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>AI score explanation</span>
                <h3>Why Atlas gave these scores</h3>
              </div>
              <button type="button" onClick={() => setExplainOpen(false)}>
                Close
              </button>
            </header>

            <div className={styles.scoreExplanationGrid}>
              <ScoreExplanation
                label="Viral"
                value={result.analysis.viralScore}
                text="Measures hook strength, memorability, emotional contrast and short-form attention potential."
              />
              <ScoreExplanation
                label="Discussion"
                value={result.analysis.discussionScore}
                text="Measures how easy the content is to respond to, debate or personalise in comments."
              />
              <ScoreExplanation
                label="Shareability"
                value={result.analysis.shareabilityScore}
                text="Measures relatability, usefulness and whether audiences would forward the content."
              />
              <ScoreExplanation
                label="Brand Fit"
                value={result.analysis.brandFitScore}
                text="Measures alignment with Brand Brain voice, audience, campaign objective and visual direction."
              />
            </div>

            <div className={styles.explainSummary}>
              <span>Atlas summary</span>
              <p>{result.analysis.summary}</p>
              <strong>
                Recommended posting time:{" "}
                {result.analysis.bestPostingTime}
              </strong>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
    </article>
  );
}

function ScoreExplanation({
  label,
  value,
  text,
}: {
  label: string;
  value: number;
  text: string;
}) {
  return (
    <article className={styles.scoreExplanation}>
      <div>
        <span>{label}</span>
        <strong>{value}/100</strong>
      </div>
      <div className={styles.scoreBar}>
        <i style={{ width: `${value}%` }} />
      </div>
      <p>{text}</p>
    </article>
  );
}

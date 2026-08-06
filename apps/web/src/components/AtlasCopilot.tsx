"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceResult } from "./AiWorkspace";
import {
  marketingCopilotPipeline,
  type CopilotMetric,
  type CopilotPipeline,
  type CopilotPipelineAction,
  type CopilotRuntimeView,
  type CopilotSuggestion,
} from "./copilot-sdk";
import styles from "./AtlasCopilot.module.css";

type CopilotAction = CopilotSuggestion & {
  platform?: "Facebook" | "Telegram" | "Reels Script" | "Image Prompt";
  action?: "improve" | "shorter" | "rewrite";
};

export function AtlasCopilot({
  result,
  isGenerating,
  statusMessage,
  onAction,
  onSuggestionAction,
  onPipelineAction,
  pipeline = marketingCopilotPipeline,
  runtimeView,
  actions = [],
}: {
  result: WorkspaceResult | null;
  isGenerating: boolean;
  statusMessage: string;
  pipeline?: CopilotPipeline;
  runtimeView?: CopilotRuntimeView;
  actions?: CopilotPipelineAction[];
  onPipelineAction?: (
    actionId: string,
  ) => void | Promise<void>;
  onAction?: (
    platform: "Facebook" | "Telegram" | "Reels Script" | "Image Prompt",
    action: "improve" | "shorter" | "rewrite",
  ) => void;
  onSuggestionAction?: (
    actionId: string,
  ) => void;
}) {
  const [activeStage, setActiveStage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  const [runningActionId, setRunningActionId] =
    useState<string | null>(null);

  async function runPipelineAction(
    action: CopilotPipelineAction,
  ) {
    if (
      action.disabled ||
      action.loading ||
      runningActionId ||
      !onPipelineAction
    ) {
      return;
    }

    if (
      action.requiresConfirmation
      && !window.confirm(
        action.confirmationMessage ||
          `Continue with ${action.label}?`,
      )
    ) {
      return;
    }

    setRunningActionId(action.id);

    try {
      await onPipelineAction(action.id);
    } finally {
      setRunningActionId(null);
    }
  }

  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const resetTimer = window.setTimeout(() => {
      setActiveStage(
        Math.min(
          1,
          Math.max(
            pipeline.stages.length - 1,
            0,
          ),
        ),
      );
    }, 0);

    const progressTimer = window.setInterval(() => {
      setActiveStage((current) =>
        Math.min(
          current + 1,
          Math.max(
            pipeline.stages.length - 1,
            0,
          ),
        ),
      );
    }, 900);

    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(progressTimer);
    };
  }, [
    isGenerating,
    pipeline.stages.length,
  ]);

  const runtimeStatus = runtimeView?.status;

  const effectiveGenerating =
    runtimeStatus === "thinking"
      ? true
      : runtimeStatus
        ? false
        : isGenerating;

  const effectiveCompleted =
    runtimeStatus === "completed"
      ? true
      : runtimeStatus
        ? false
        : Boolean(result);

  const effectiveFailed =
    runtimeStatus === "failed";

  const visibleActiveStage =
    runtimeView?.activeStage !== undefined
      ? Math.max(
          0,
          Math.min(
            runtimeView.activeStage,
            pipeline.stages.length,
          ),
        )
      : effectiveGenerating
        ? activeStage
        : effectiveCompleted
          ? pipeline.stages.length
          : 0;

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

  const metrics: CopilotMetric[] =
    runtimeView?.metrics || [
      {
        id: "confidence",
        label: "Confidence",
        value: confidence,
        suffix: "%",
      },
      {
        id: "brand-match",
        label: "Brand Match",
        value:
          result?.analysis.brandFitScore || 0,
        suffix: "%",
      },
      {
        id: "context-loaded",
        label: "Context Loaded",
        value:
          result?.promptChain
            ?.loadedSourceCount || 0,
        suffix: result?.promptChain
          ?.totalSourceCount
          ? `/${result.promptChain.totalSourceCount}`
          : "/0",
      },
    ];

  const progress = effectiveGenerating
    ? Math.max(
        12,
        Math.round((visibleActiveStage / Math.max(pipeline.stages.length, 1)) * 100),
      )
    : effectiveCompleted
      ? 100
      : 0;

  const visibleProgress =
    runtimeView?.progress !== undefined
      ? Math.max(
          0,
          Math.min(runtimeView.progress, 100),
        )
      : progress;

  const suggestions = useMemo<CopilotAction[]>(() => {
    if (runtimeView?.suggestions) {
      return runtimeView.suggestions;
    }

    if (!result) {
      return (
        pipeline.emptySuggestions?.map(
          (suggestion) => ({
            id: suggestion.id,
            label: suggestion.label,
            detail: suggestion.detail,
          }),
        ) || []
      );
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
  }, [
    result,
    pipeline.emptySuggestions,
    runtimeView?.suggestions,
  ]);


  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{pipeline.eyebrow}</p>
          <h3>
            {effectiveFailed
              ? pipeline.failedTitle ||
                "Atlas could not complete the task"
              : effectiveGenerating
                ? pipeline.activeTitle
                : effectiveCompleted
                  ? pipeline.completedTitle
                  : pipeline.idleTitle}
          </h3>
          <p className={styles.status}>
            {runtimeView?.statusMessage || statusMessage}
          </p>
        </div>

        <div className={styles.headerActions}>
          <span
            className={
              effectiveGenerating
                ? styles.thinkingBadge
                : effectiveCompleted
                  ? styles.completeBadge
                  : styles.idleBadge
            }
          >
            {effectiveFailed
              ? "Failed"
              : effectiveGenerating
                ? "Thinking"
                : effectiveCompleted
                  ? "Completed"
                  : "Idle"}
          </span>
          {result && pipeline.agentType === "marketing" ? (
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
              <strong>{visibleProgress}%</strong>
            </div>
            <div className={styles.progressTrack}>
              <i style={{ width: `${visibleProgress}%` }} />
            </div>
          </div>

          <div className={styles.contentGrid}>
            <div className={styles.timeline}>
              <div className={styles.sectionHeading}>
                <span>Thinking timeline</span>
                <strong>
                  {effectiveGenerating
                    ? `${Math.min(visibleActiveStage + 1, pipeline.stages.length)} / ${pipeline.stages.length}`
                    : effectiveCompleted
                      ? `${pipeline.stages.length} / ${pipeline.stages.length}`
                      : `0 / ${pipeline.stages.length}`}
                </strong>
              </div>

              <div className={styles.stageList}>
                {pipeline.stages.map((stage, index) => {
                  const completed =
                    effectiveCompleted ||
                    index < visibleActiveStage;
                  const active =
                    effectiveGenerating &&
                    index === visibleActiveStage;

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
                {metrics.map((metric) => (
                  <Metric
                    key={metric.id}
                    label={metric.label}
                    value={metric.value}
                    suffix={metric.suffix || ""}
                  />
                ))}
              </div>

              {runtimeView?.gitReview ? (
                <section className={styles.gitPanel}>
                  <div className={styles.sectionHeading}>
                    <span>Git Review</span>
                    <strong>
                      {
                        runtimeView.gitReview
                          .changedFiles
                      }
                    </strong>
                  </div>

                  <div className={styles.gitCard}>
                    <p>
                      Branch
                    </p>

                    <strong>
                      {
                        runtimeView.gitReview
                          .branch
                      }
                    </strong>
                  </div>

                  <div className={styles.gitCard}>
                    <p>
                      Commit Preview
                    </p>

                    <strong>
                      {
                        runtimeView.gitReview
                          .commitMessage
                      }
                    </strong>
                  </div>

                  <div className={styles.gitCard}>
                    <p>
                      Summary
                    </p>

                    <span>
                      {
                        runtimeView.gitReview
                          .summary
                      }
                    </span>
                  </div>
                </section>
              ) : null}


              {runtimeView?.diffPreviews?.length ? (
                <section className={styles.diffPanel}>
                  <div className={styles.sectionHeading}>
                    <span>Diff Preview</span>
                    <strong>
                      {runtimeView.diffPreviews.length}
                    </strong>
                  </div>

                  {runtimeView.diffPreviews.map(
                    (diff) => (
                      <article
                        key={diff.filePath}
                        className={styles.diffFile}
                      >
                        <strong>
                          {diff.filePath}
                        </strong>

                        <pre>
                          {diff.lines.map(
                            (line, index) => (
                              <span
                                key={index}
                                data-type={line.type}
                              >
                                {line.text}
                                {"\n"}
                              </span>
                            ),
                          )}
                        </pre>
                      </article>
                    ),
                  )}
                </section>
              ) : null}


              {runtimeView?.editProposals?.length ? (
                <section className={styles.editPanel}>
                  <div className={styles.sectionHeading}>
                    <span>Proposed changes</span>
                    <strong>
                      {runtimeView.editProposals.length}
                    </strong>
                  </div>

                  <div className={styles.editList}>
                    {runtimeView.editProposals.map(
                      (proposal) => (
                        <article key={proposal.id}>
                          <div>
                            <strong>
                              {proposal.filePath}
                            </strong>

                            <p>
                              {proposal.action.toUpperCase()}
                              {" · "}
                              {proposal.reason}
                            </p>
                          </div>

                          <span>
                            {proposal.risk}
                          </span>
                        </article>
                      ),
                    )}
                  </div>

                  <button
                    type="button"
                    className={styles.approveButton}
                  >
                    Approve Changes
                  </button>
                </section>
              ) : null}


              {runtimeView?.dependencyGraph?.nodes.length ? (
                <section className={styles.dependencyPanel}>
                  <div className={styles.sectionHeading}>
                    <span>
                      {runtimeView.dependencyGraph.title}
                    </span>

                    <strong>
                      {
                        runtimeView.dependencyGraph
                          .nodes.length
                      }
                    </strong>
                  </div>

                  <div className={styles.dependencyGraph}>
                    {runtimeView.dependencyGraph.nodes.map(
                      (node, index) => (
                        <div
                          key={node.id}
                          className={styles.dependencyNode}
                        >
                          <article>
                            <span>
                              {node.role || "file"}
                            </span>

                            <strong>{node.label}</strong>

                            {node.detail ? (
                              <p>{node.detail}</p>
                            ) : null}
                          </article>

                          {index <
                          runtimeView.dependencyGraph!.nodes.length - 1 ? (
                            <div
                              className={
                                styles.dependencyArrow
                              }
                            >
                              <i />
                              <span>↓</span>
                            </div>
                          ) : null}
                        </div>
                      ),
                    )}
                  </div>
                </section>
              ) : null}

              {runtimeView?.reasoningSteps?.length ? (
                <section className={styles.reasoningPanel}>
                  <div className={styles.sectionHeading}>
                    <span>Atlas reasoning</span>
                    <strong>
                      {runtimeView.reasoningSteps.length}
                    </strong>
                  </div>

                  <div className={styles.reasoningList}>
                    {runtimeView.reasoningSteps.map(
                      (step, index) => (
                        <article
                          key={step.id}
                          data-status={
                            step.status || "pending"
                          }
                        >
                          <div className={styles.reasoningMarker}>
                            <span>{index + 1}</span>
                            {index <
                            runtimeView.reasoningSteps!.length - 1 ? (
                              <i />
                            ) : null}
                          </div>

                          <div>
                            <strong>{step.title}</strong>
                            <p>{step.detail}</p>
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                </section>
              ) : null}

              {runtimeView?.contextSections?.length ? (
                <div className={styles.contextPanel}>
                  {runtimeView.contextSections.map(
                    (section) => (
                      <section
                        key={section.id}
                        className={styles.contextSection}
                      >
                        <div className={styles.sectionHeading}>
                          <span>{section.title}</span>

                          {section.count !== undefined ? (
                            <strong>{section.count}</strong>
                          ) : null}
                        </div>

                        <div className={styles.contextList}>
                          {section.items.map((item) => (
                            <article
                              key={item.id}
                              data-tone={
                                item.tone || "default"
                              }
                            >
                              <div>
                                <strong>
                                  {item.label}
                                </strong>

                                {item.detail ? (
                                  <p>{item.detail}</p>
                                ) : null}
                              </div>

                              {item.badge ? (
                                <span>{item.badge}</span>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </section>
                    ),
                  )}
                </div>
              ) : null}

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
                      {suggestion.actionId &&
                      suggestion.actionLabel &&
                      onSuggestionAction ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSuggestionAction(
                              suggestion.actionId!,
                            )
                          }
                        >
                          {suggestion.actionLabel}
                        </button>
                      ) : suggestion.platform &&
                        suggestion.action &&
                        onAction ? (
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

      {actions.length > 0 ? (
        <footer className={styles.actionBar}>
          <div className={styles.actionSummary}>
            <span>Available actions</span>
            <strong>{actions.length}</strong>
          </div>

          <div className={styles.pipelineActions}>
            {actions.map((action) => {
              const running =
                runningActionId === action.id;

              const disabled =
                action.disabled ||
                action.loading ||
                Boolean(
                  runningActionId &&
                    !running,
                ) ||
                !onPipelineAction;

              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={disabled}
                  className={
                    action.variant === "primary"
                      ? styles.primaryAction
                      : action.variant === "danger"
                        ? styles.dangerAction
                        : action.variant === "ghost"
                          ? styles.ghostAction
                          : styles.secondaryAction
                  }
                  title={action.description}
                  onClick={() =>
                    void runPipelineAction(action)
                  }
                >
                  {running || action.loading
                    ? "Working..."
                    : action.label}
                </button>
              );
            })}
          </div>
        </footer>
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

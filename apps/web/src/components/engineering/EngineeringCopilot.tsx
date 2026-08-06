"use client";

import {
  FormEvent,
  useMemo,
  useState,
} from "react";

import {
  API_URL,
} from "@/lib/api";

import {
  AtlasCopilot,
} from "../AtlasCopilot";

import {
  engineeringCopilotPipeline,
  engineeringReviewActions,
  type CopilotRuntimeView,
} from "../copilot-sdk";

import type {
  EngineeringAnalysisResponse,
  EngineeringPlan,
  EngineeringRisk,
} from "./engineering.types";

import styles from "./EngineeringCopilot.module.css";


const EXAMPLE_PROMPTS = [
  {
    icon: "◫",
    title: "Improve Dashboard UI",
    prompt:
      "把 Dashboard 重新设计，减少杂乱感，增加留白，并优化手机版布局",
  },
  {
    icon: "▣",
    title: "Optimize Mobile",
    prompt:
      "检查整个 Web 手机版 UI，找出布局、按钮和滚动体验的问题",
  },
  {
    icon: "✦",
    title: "Improve AI Studio",
    prompt:
      "重新设计 AI Studio，突出 Prompt Generate 和 Image Generate",
  },
  {
    icon: "⌁",
    title: "Investigate Publisher",
    prompt:
      "分析 Facebook Publisher 最近失败的原因，并列出相关文件和风险",
  },
];


const IDLE_RUNTIME: CopilotRuntimeView = {
  status: "idle",
  statusMessage:
    "Repository context is ready.",
  progress: 0,
};


function riskScore(
  risk: EngineeringRisk,
): number {
  if (risk === "high") {
    return 5;
  }

  if (risk === "medium") {
    return 3;
  }

  return 1;
}


function buildRuntimeView(
  plan: EngineeringPlan,
): CopilotRuntimeView {
  return {
    status: "completed",
    statusMessage: plan.summary,
    progress: 100,
    activeStage:
      engineeringCopilotPipeline
        .stages.length,
    metrics: [
      {
        id: "confidence",
        label: "Confidence",
        value: Math.round(
          plan.confidence * 100,
        ),
        suffix: "%",
      },
      {
        id: "risk",
        label: "Risk",
        value: riskScore(
          plan.risk,
        ),
        suffix: "/5",
      },
      {
        id: "files",
        label: "Affected Files",
        value:
          plan.impact.affected_files,
      },
    ],
    suggestions:
      plan.recommended_actions.map(
        (action, index) => ({
          id: `step-${index}`,
          label:
            index === 0
              ? "Recommended first step"
              : `Step ${index + 1}`,
          detail: action,
          completed: true,
        }),
      ),
  };
}


export function EngineeringCopilot() {
  const [input, setInput] =
    useState("");

  const [lastPrompt, setLastPrompt] =
    useState("");

  const [analysis, setAnalysis] =
    useState<EngineeringAnalysisResponse | null>(
      null,
    );

  const [runtimeView, setRuntimeView] =
    useState<CopilotRuntimeView>(
      IDLE_RUNTIME,
    );

  const [busy, setBusy] =
    useState(false);

  const [decision, setDecision] =
    useState<
      "pending" |
      "approved" |
      "rejected"
    >("pending");

  const [message, setMessage] =
    useState(
      "Describe a change to begin repository analysis.",
    );


  const plan =
    analysis?.engineering_plan || null;


  const actions = useMemo(() => {
    if (!plan) {
      return [];
    }

    return engineeringReviewActions.map(
      (action) => ({
        ...action,
        disabled:
          busy ||
          (
            action.id === "approve" &&
            decision === "approved"
          ) ||
          (
            action.id === "reject" &&
            decision === "rejected"
          ),
      }),
    );
  }, [
    busy,
    decision,
    plan,
  ]);


  async function analyseRequest(
    requestText: string,
  ) {
    const cleanText =
      requestText.trim();

    if (!cleanText || busy) {
      return;
    }

    setBusy(true);
    setDecision("pending");
    setAnalysis(null);
    setLastPrompt(cleanText);

    setRuntimeView({
      status: "thinking",
      statusMessage:
        "Scanning repository and dependencies...",
      progress: 14,
      activeStage: 0,
    });

    setMessage(
      "Atlas is reading the repository.",
    );

    try {
      const response = await fetch(
        `${API_URL}/engineering/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            text: cleanText,
          }),
        },
      );

      const data =
        await response.json() as
          EngineeringAnalysisResponse & {
            message?: string;
          };

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
          data.message ||
          "Engineering analysis failed.",
        );
      }

      setAnalysis(data);

      if (data.engineering_plan) {
        setRuntimeView(
          buildRuntimeView(
            data.engineering_plan,
          ),
        );

        setMessage(
          "Engineering plan is ready for review.",
        );
      } else {
        setRuntimeView({
          status: "completed",
          statusMessage:
            "Atlas understood the request. No files were changed.",
          progress: 100,
          activeStage:
            engineeringCopilotPipeline
              .stages.length,
          metrics: [
            {
              id: "confidence",
              label: "Confidence",
              value: Math.round(
                (
                  data.intent
                    .confidence || 0
                ) * 100,
              ),
              suffix: "%",
            },
            {
              id: "review",
              label: "Review",
              value:
                data.requires_review
                  ? 1
                  : 0,
              suffix: "/1",
            },
            {
              id: "executed",
              label: "Executed",
              value:
                data.executed
                  ? 1
                  : 0,
              suffix: "/1",
            },
          ],
        });

        setMessage(
          "Request understood. No repository files were modified.",
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Engineering analysis failed.";

      setRuntimeView({
        status: "failed",
        statusMessage:
          errorMessage,
        progress: 0,
      });

      setMessage(errorMessage);
    } finally {
      setBusy(false);
    }
  }


  function submit(
    event: FormEvent,
  ) {
    event.preventDefault();

    void analyseRequest(input);
  }


  async function handlePipelineAction(
    actionId: string,
  ) {
    if (actionId === "preview") {
      document
        .getElementById(
          "engineering-result",
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });

      setMessage(
        "Showing engineering preview.",
      );

      return;
    }

    if (actionId === "approve") {
      setDecision("approved");

      setMessage(
        "Plan approved. Apply remains disabled until permission controls are connected.",
      );

      return;
    }

    if (actionId === "reject") {
      setDecision("rejected");

      setMessage(
        "Plan rejected. No files were modified.",
      );

      return;
    }

    if (
      actionId === "retry" &&
      lastPrompt
    ) {
      await analyseRequest(
        lastPrompt,
      );
    }
  }


  function resetWorkspace() {
    setInput("");
    setLastPrompt("");
    setAnalysis(null);
    setRuntimeView(
      IDLE_RUNTIME,
    );
    setDecision("pending");
    setMessage(
      "Describe a change to begin repository analysis.",
    );
  }


  return (
    <section className={styles.workspace}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.agentDot} />

          <div>
            <strong>
              Atlas Engineering
            </strong>

            <small>
              Repository-aware AI engineer
            </small>
          </div>
        </div>

        <div className={styles.topbarActions}>
          <span className={styles.modelBadge}>
            GPT-5.6
          </span>

          <button
            type="button"
            onClick={resetWorkspace}
            disabled={busy}
          >
            New task
          </button>
        </div>
      </header>


      <div className={styles.mainGrid}>
        <main className={styles.conversation}>
          {!lastPrompt ? (
            <section className={styles.welcome}>
              <div className={styles.welcomeMark}>
                A
              </div>

              <h1>
                What should Atlas build
                or improve?
              </h1>

              <p>
                Describe the outcome.
                Atlas will inspect the repository,
                dependencies and potential impact
                before proposing changes.
              </p>


              <div className={styles.promptGrid}>
                {EXAMPLE_PROMPTS.map(
                  (example) => (
                    <button
                      key={example.title}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setInput(
                          example.prompt,
                        )
                      }
                    >
                      <span>
                        {example.icon}
                      </span>

                      <div>
                        <strong>
                          {example.title}
                        </strong>

                        <small>
                          {example.prompt}
                        </small>
                      </div>
                    </button>
                  ),
                )}
              </div>
            </section>
          ) : (
            <section className={styles.thread}>
              <article className={styles.userMessage}>
                <div className={styles.avatar}>
                  Y
                </div>

                <div>
                  <span>You</span>
                  <p>{lastPrompt}</p>
                </div>
              </article>


              <article className={styles.atlasMessage}>
                <div className={styles.atlasAvatar}>
                  A
                </div>

                <div>
                  <div className={styles.messageHeader}>
                    <span>Atlas</span>

                    {busy ? (
                      <small>
                        Analysing repository...
                      </small>
                    ) : null}
                  </div>

                  {busy ? (
                    <div className={styles.thinking}>
                      <i />
                      <i />
                      <i />

                      <p>
                        Searching files,
                        dependencies and shared
                        infrastructure.
                      </p>
                    </div>
                  ) : plan ? (
                    <div className={styles.responseText}>
                      <p>{plan.summary}</p>

                      <div className={styles.responseMetrics}>
                        <span>
                          {
                            plan.impact
                              .affected_files
                          } files
                        </span>

                        <span>
                          {Math.round(
                            plan.confidence *
                            100,
                          )}% confidence
                        </span>

                        <span
                          data-risk={
                            plan.risk
                          }
                        >
                          {plan.risk} risk
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.messageStatus}>
                      {message}
                    </p>
                  )}
                </div>
              </article>
            </section>
          )}


          <form
            className={styles.composer}
            onSubmit={submit}
          >
            <textarea
              value={input}
              disabled={busy}
              maxLength={4000}
              placeholder={
                "Describe a change, bug or feature..."
              }
              onChange={(event) =>
                setInput(
                  event.target.value,
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey ||
                    event.ctrlKey)
                ) {
                  event.preventDefault();
                  void analyseRequest(input);
                }
              }}
            />

            <div className={styles.composerFooter}>
              <div>
                <button
                  type="button"
                  disabled
                  title="Attachments will be connected later"
                >
                  +
                </button>

                <span>
                  Repository context enabled
                </span>
              </div>

              <div>
                <small>
                  ⌘ Enter
                </small>

                <button
                  type="submit"
                  disabled={
                    busy ||
                    !input.trim()
                  }
                >
                  {busy ? "…" : "↑"}
                </button>
              </div>
            </div>
          </form>
        </main>


        <aside className={styles.inspector}>
          <AtlasCopilot
            result={null}
            isGenerating={busy}
            statusMessage={message}
            pipeline={
              engineeringCopilotPipeline
            }
            runtimeView={runtimeView}
            actions={actions}
            onPipelineAction={
              handlePipelineAction
            }
          />
        </aside>
      </div>


      <section
        id="engineering-result"
        className={styles.resultPanel}
      >
        <header>
          <div>
            <span>
              Engineering plan
            </span>

            <h2>
              {plan?.title ||
                "Repository preview"}
            </h2>
          </div>

          {decision !== "pending" ? (
            <strong
              data-decision={
                decision
              }
            >
              {decision}
            </strong>
          ) : null}
        </header>


        {!plan ? (
          <div className={styles.emptyResult}>
            <span>⌘</span>

            <strong>
              No engineering plan yet
            </strong>

            <p>
              Atlas will show affected files,
              implementation steps and warnings
              here.
            </p>
          </div>
        ) : (
          <div className={styles.resultGrid}>
            <section className={styles.filePanel}>
              <div className={styles.sectionTitle}>
                <span>Related files</span>

                <strong>
                  {
                    plan.related_files
                      .length
                  }
                </strong>
              </div>

              <div className={styles.fileList}>
                {plan.related_files.map(
                  (file) => (
                    <article
                      key={
                        file.file_path
                      }
                    >
                      <div className={styles.fileIcon}>
                        {file.role === "style"
                          ? "#"
                          : file.role === "page"
                            ? "P"
                            : file.role === "layout"
                              ? "L"
                              : "T"}
                      </div>

                      <div>
                        <strong>
                          {
                            file.file_path
                          }
                        </strong>

                        <small>
                          {file.role}
                          {" · "}
                          relevance {
                            file.score
                          }
                        </small>
                      </div>
                    </article>
                  ),
                )}
              </div>
            </section>


            <section className={styles.planPanel}>
              <div className={styles.sectionTitle}>
                <span>
                  Implementation plan
                </span>

                <strong>
                  {
                    plan
                      .recommended_actions
                      .length
                  }
                </strong>
              </div>

              <ol>
                {plan
                  .recommended_actions
                  .map(
                    (
                      action,
                      index,
                    ) => (
                      <li key={action}>
                        <span>
                          {index + 1}
                        </span>

                        <p>{action}</p>
                      </li>
                    ),
                  )}
              </ol>


              {plan.warnings.length ? (
                <div className={styles.warningBox}>
                  <strong>
                    Review notes
                  </strong>

                  {plan.warnings.map(
                    (warning) => (
                      <p key={warning}>
                        {warning}
                      </p>
                    ),
                  )}
                </div>
              ) : null}
            </section>
          </div>
        )}
      </section>
    </section>
  );
}

"use client";

import {
  FormEvent,
  useEffect,
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
  type CopilotSnapshot,
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
  snapshots: CopilotSnapshot[] = [],
): CopilotRuntimeView {
  return {
    status: "completed",
    statusMessage: plan.summary,
    progress: 100,
    activeStage:
      engineeringCopilotPipeline
        .stages.length,

    timeline: [
      {
        id: "analysis",
        title: "Repository analyzed",
        detail:
          "Atlas scanned repository structure and dependencies.",
        status: "complete",
      },
      {
        id: "snapshot",
        title: "Snapshot ready",
        detail:
          snapshots.length
            ? "Restore point created before changes."
            : "Waiting for snapshot creation.",
        status:
          snapshots.length
            ? "complete"
            : "pending",
      },
      {
        id: "changes",
        title: "Changes prepared",
        detail:
          `${plan.impact.affected_files} affected files identified.`,
        status:
          plan.impact.affected_files > 0
            ? "complete"
            : "pending",
      },
      {
        id: "git",
        title: "Git review",
        detail:
          "Changes are ready for engineering review.",
        status: "complete",
      },
    ],

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

    reasoningSteps: [
      {
        id: "intent",
        title: "Request understood",
        detail:
          `Atlas classified this as ${plan.title}.`,
        status: "complete",
      },
      {
        id: "primary",
        title: "Primary files identified",
        detail:
          `${plan.impact.component_files} component files are directly related to the request.`,
        status: "complete",
      },
      {
        id: "styles",
        title: "Shared styling impact detected",
        detail:
          `${plan.impact.style_files} style files may need review for visual consistency.`,
        status: "complete",
      },
      {
        id: "dependencies",
        title: "Dependencies analysed",
        detail:
          `${plan.impact.affected_files} files may be affected across the repository.`,
        status: "complete",
      },
      {
        id: "approval",
        title: "Approval gate enabled",
        detail:
          plan.requires_approval
            ? "No repository changes will run until the plan is approved."
            : "The plan is ready for execution.",
        status:
          plan.requires_approval
            ? "active"
            : "complete",
      },
    ],

    dependencyGraph: {
      title: "Repository dependency path",
      nodes: plan.related_files
        .slice(0, 7)
        .map((file) => ({
          id: file.file_path,
          label:
            file.file_path
              .split("/")
              .pop() || file.file_path,
          detail:
            file.reasons[0] ||
            "Related repository file.",
          role: file.role,
        })),
      edges: plan.related_files
        .slice(0, 6)
        .map((file, index) => ({
          id: `edge-${index}`,
          from: file.file_path,
          to:
            plan.related_files[index + 1]
              ?.file_path ||
            file.file_path,
          label:
            index === 0
              ? "primary relationship"
              : "repository dependency",
        }))
        .filter(
          (edge) =>
            edge.from !== edge.to,
        ),
    },

    snapshots,


    gitReview: {
      branch:
        "agent/railway-sync",

      changedFiles:
        plan.impact.affected_files,

      stagedFiles:
        0,

      clean:
        false,

      commitMessage:
        "feat: improve Atlas engineering workflow",

      summary:
        "Engineering agent changes ready for review.",
    },


    diffPreviews:
      plan.related_files
        .slice(0, 3)
        .map((file) => ({
          filePath: file.file_path,
          lines: [
            {
              type: "context",
              text:
                `// ${file.file_path}`,
            },
            {
              type: "remove",
              text:
                "- Current implementation",
            },
            {
              type: "add",
              text:
                "+ Updated implementation based on plan",
            },
            {
              type: "context",
              text:
                "// Review required before applying",
            },
          ],
        })),


    editProposals:
      plan.related_files
        .slice(0, 8)
        .map((file, index) => ({
          id: `edit-${index}`,
          filePath: file.file_path,
          action:
            file.role === "primary"
              ? "modify"
              : "review",
          reason:
            file.reasons?.[0] ||
            "Repository dependency detected.",
          risk:
            plan.risk === "high"
              ? "high"
              : plan.risk === "medium"
                ? "medium"
                : "low",
          approved: false,
        })),


    contextSections: [
      {
        id: "repository-stack",
        title: "Repository",
        count: 4,
        items: [
          {
            id: "nextjs",
            label: "Next.js",
            detail: "Web application and App Router.",
            badge: "Web",
          },
          {
            id: "nestjs",
            label: "NestJS",
            detail: "API modules and services.",
            badge: "API",
          },
          {
            id: "prisma",
            label: "Prisma",
            detail: "Database schema and access layer.",
            badge: "Data",
          },
          {
            id: "supabase",
            label: "Supabase",
            detail: "Authentication and platform services.",
            badge: "Auth",
          },
        ],
      },
      {
        id: "affected-files",
        title: "Affected files",
        count: plan.related_files.length,
        items: plan.related_files
          .slice(0, 6)
          .map((file) => ({
            id: file.file_path,
            label: file.file_path
              .split("/")
              .pop() || file.file_path,
            detail:
              file.reasons[0] ||
              "Related repository file.",
            badge: file.role,
          })),
      },
      {
        id: "impact-preview",
        title: "Impact preview",
        count: plan.impact.affected_files,
        items: [
          {
            id: "impact-files",
            label:
              `${plan.impact.affected_files} affected files`,
            detail:
              `${plan.impact.component_files} components, ` +
              `${plan.impact.style_files} style files.`,
            badge: "Files",
          },
          {
            id: "impact-risk",
            label:
              `${plan.risk.toUpperCase()} engineering risk`,
            detail:
              plan.risk === "high"
                ? "Review shared layouts and dependencies before applying."
                : plan.risk === "medium"
                  ? "Preview and test the affected modules."
                  : "Changes appear isolated and reviewable.",
            badge: "Risk",
            tone:
              plan.risk === "high"
                ? "danger"
                : plan.risk === "medium"
                  ? "warning"
                  : "success",
          },
          {
            id: "impact-approval",
            label:
              plan.requires_approval
                ? "Approval required"
                : "Ready for execution",
            detail:
              plan.requires_approval
                ? "Atlas will not modify files until the plan is approved."
                : "The plan can proceed to execution.",
            badge:
              plan.requires_approval
                ? "Review"
                : "Ready",
            tone:
              plan.requires_approval
                ? "warning"
                : "success",
          },
          ...plan.warnings.slice(0, 2).map(
            (warning, index) => ({
              id: `warning-${index}`,
              label: "Repository warning",
              detail: warning,
              badge: "Warning",
              tone: "warning" as const,
            }),
          ),
        ],
      },
    ],
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

  const [snapshots, setSnapshots] =
    useState<CopilotSnapshot[]>([]);


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


  async function restoreSnapshot(
    snapshotId: string,
  ) {
    await fetch(
      `${API_URL}/engineering/rollback`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          snapshotId,
        }),
      },
    );

    const response =
      await fetch(
        `${API_URL}/engineering/snapshot`,
        {
          cache: "no-store",
        },
      );

    const data =
      await response.json();

    if (Array.isArray(data)) {
      setSnapshots(
        data.map(
          (snapshot) => ({
            ...snapshot,
            status:
              snapshot.status === "restored"
                ? "restored"
                : "active",
          }),
        ),
      );
    }
  }



  useEffect(() => {
    void fetch(
      `${API_URL}/engineering/snapshot`,
      {
        cache: "no-store",
      },
    )
      .then((response) =>
        response.json(),
      )
      .then((data) => {
        if (Array.isArray(data)) {
          setSnapshots(
            data.map(
              (snapshot) => ({
                ...snapshot,
                status:
                  snapshot.status === "restored"
                    ? "restored"
                    : "active",
              }),
            ),
          );
        }
      })
      .catch(() => {
        setSnapshots([]);
      });
  }, []);



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

        const runtime =
          buildRuntimeView(
            data.engineering_plan,
          );


        try {

          const patchResponse =
            await fetch(
              `${API_URL}/engineering/patch`,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    request:
                      cleanText,

                    files:
                      data.engineering_plan
                        .related_files
                        .map(
                          (file) =>
                            file.file_path,
                        ),
                  }),
              },
            );


          if (patchResponse.ok) {

            const patchData =
              await patchResponse.json();


            runtime.patches =
              patchData.patches || [];

          }

        } catch {

          runtime.patches = [];

        }


        setRuntimeView({
          ...buildRuntimeView(
            data.engineering_plan,
            snapshots,
          ),
          ...runtime,
        });

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


  async function handleRecoveryApply(
    patches:
      {
        filePath: string;
        before?: string;
        after?: string;
      }[] | undefined,
  ) {

    if (!patches?.length) {
      setMessage(
        "No recovery patch available.",
      );

      return;
    }


    setRuntimeView({
      ...runtimeView,
      applyStatus:
        "applying",
      statusMessage:
        "Applying recovery fix...",
    });


    const response =
      await fetch(
        `${API_URL}/engineering/apply/batch`,
        {
          method:
            "POST",

          headers:{
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              patches:
                patches.map(
                  patch => ({
                    filePath:
                      patch.filePath,

                    content:
                      patch.after,

                    before:
                      patch.before,
                  }),
                ),
            }),
        },
      );


    if (!response.ok) {
      setMessage(
        "Recovery fix failed.",
      );

      return;
    }


    const validationResponse =
      await fetch(
        `${API_URL}/engineering/validation/typescript`,
        {
          method:
            "POST",
        },
      );


    const validation =
      await validationResponse.json();


    setRuntimeView({
      ...runtimeView,

      applyStatus:
        validation.status === "passed"
          ? "completed"
          : "failed",

      validation,

      statusMessage:
        validation.status === "passed"
          ? "Recovery fix applied successfully."
          : "Recovery fix applied but validation failed.",
    });

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


      setRuntimeView({
        ...runtimeView,

        approvalState:
          "APPROVED",
      });


      setMessage(
        "Plan approved. Ready to apply changes.",
      );

      return;
    }


    if (actionId === "apply") {


      const recoveryApprovalRequired =
        runtimeView.recovery
          ?.suggestions
          ?.some(
            suggestion =>
              suggestion.approvalRequired
          );


      if (
        recoveryApprovalRequired
        &&
        runtimeView.approvalState !==
          "APPROVED"
      ) {

        setMessage(
          "Human approval required before applying recovery fix.",
        );

        return;

      }


  const availablePatches =
    runtimeView.patches?.length
      ? runtimeView.patches
      : runtimeView.recovery
          ?.suggestions[0]
          ?.patch;

      if (
        !availablePatches?.length
      ) {
        setMessage(
          "No patch available to apply.",
        );

        return;
      }


      setRuntimeView({
        ...runtimeView,
        applyStatus:
          "applying",
        statusMessage:
          "Applying repository changes...",
      });


      try {


          const response =
        await fetch(
          `${API_URL}/engineering/apply/batch`,
          {
            method:
              "POST",

            headers:{
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                patches:
                  availablePatches.map(
                    patch => ({
                      filePath:
                        patch.filePath,

                      content:
                        patch.after,

                      before:
                        patch.before,
                    }),
                  ),
              }),
          },
        );


      if (!response.ok) {
        throw new Error(
          "Failed applying repository changes.",
        );
      }


const validationResponse =
          await fetch(
            `${API_URL}/engineering/validation/typescript`,
            {
              method:
                "POST",
            },
          );


        const validation =
          await validationResponse.json();


    
    const auditResponse =
      await fetch(
        `${API_URL}/engineering/audit`,
      );


    const auditRecords =
      await auditResponse.json();


    let recovery = null;


        if (
          validation.status !== "passed"
        ) {

          const recoveryResponse =
            await fetch(
              `${API_URL}/engineering/recovery/analyze`,
              {
                method:
                  "POST",

                headers:{
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    error:
                      JSON.stringify(
                        validation,

          auditRecords,

                      ),
                  }),
              },
            );


          if (
            recoveryResponse.ok
          ) {
            recovery =
              await recoveryResponse.json();
          }
        }


        setRuntimeView({
          ...runtimeView,

          applyStatus:
            validation.status === "passed"
              ? "completed"
              : "failed",

          validation,

          recovery,

          statusMessage:
            validation.status === "passed"
              ? "Repository changes validated successfully."
              : "Repository validation failed after apply.",
        });


        setMessage(
          validation.status === "passed"
            ? "Changes applied and validated successfully."
            : "Changes applied but validation failed.",
        );


      } catch(error) {

        setRuntimeView({
          ...runtimeView,
          applyStatus:
            "failed",
          statusMessage:
            error instanceof Error
              ? error.message
              : "Apply failed.",
        });


        setMessage(
          "Repository apply failed.",
        );
      }


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


    
              {runtimeView.auditRecords?.length ? (
                <div className={styles.auditCard}>

                  <strong>
                    Recent Engineering Actions
                  </strong>


                  {runtimeView.auditRecords.map(
                    (
                      record,
                      index,
                    ) => (
                      <div
                        key={index}
                        className={
                          styles.auditItem
                        }
                      >

                        <strong>
                          {record.action}
                        </strong>


                        <p>
                          {record.filePath}
                        </p>


                        <small>
                          {record.status}
                        </small>

                      </div>
                    ),
                  )}

                </div>
              ) : null}


              {runtimeView.recovery && (
                    <div className={styles.recoveryCard}>

                      <strong>
                        Recovery Agent
                      </strong>

                      <p>
                        {runtimeView.recovery.analysis}
                      </p>


                      {runtimeView.recovery.suggestions.map(
                        (
                          suggestion,
                          index,
                        ) => (
                          <div
                            key={index}
                            className={
                              styles.recoveryItem
                            }
                          >
                            <strong>
                              {suggestion.reason}
                            </strong>

                            <p>
                              {suggestion.nextStep}
                            </p>

                            <small>
                              {
                                suggestion.patch?.length ?? 0
                              }
                              {" "}
                              patch generated
                            </small>



                        {suggestion.confidence !== undefined && (
                          <small>
                            Confidence:
                            {" "}
                            {Math.round(
                              suggestion.confidence * 100,
                            )}
                            %
                          </small>
                        )}


                        {suggestion.riskLevel && (
                          <small>
                            Risk:
                            {" "}
                            {suggestion.riskLevel}
                          </small>
                        )}


                        {suggestion.approvalRequired && (
                          <small>
                            ⚠ Human approval required
                          </small>
                        )}



                            <button
                              type="button"
                              disabled={
                                !suggestion.patch?.length
                              }
                              onClick={() =>
                                void handleRecoveryApply(
                                  suggestion.patch,
                                )
                              }
                            >
                              Apply Recovery Fix
                            </button>

                          </div>
                        ),
                      )}

                    </div>
                  )}


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
            onRestoreSnapshot={
              restoreSnapshot
            }
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

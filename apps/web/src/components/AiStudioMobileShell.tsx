"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AiStudio,
  type ExternalGenerationEvent,
  type ExternalGenerationRequest,
} from "./AiStudio";
import styles from "./AiStudioMobileShell.module.css";
import { useAtlasWorkspace } from "./ai-workspace-context";

type OutputMode = "prompt" | "image" | null;

type GenerateMode = "prompt" | "image" | null;

type OutputPlatforms = {
  facebook: boolean;
  telegram: boolean;
  reels: boolean;
  imagePrompt: boolean;
};

const EMPTY_OUTPUTS: OutputPlatforms = {
  facebook: true,
  telegram: false,
  reels: false,
  imagePrompt: false,
};

export function AiStudioMobileShell() {
  const workspace = useAtlasWorkspace();

  const lastWorkspaceCommandRef = useRef<number | null>(null);

  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formCard, setFormCard] = useState<HTMLElement | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>(null);
  const [generateMode, setGenerateMode] = useState<GenerateMode>(null);
  const [outputPlatforms, setOutputPlatforms] =
    useState<OutputPlatforms>(EMPTY_OUTPUTS);
  const [hasResult, setHasResult] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const [generationRequest, setGenerationRequest] =
    useState<ExternalGenerationRequest | null>(null);

  const shellRef = useRef<HTMLElement>(null);

  function platformButtons() {
    const shell = shellRef.current;
    if (!shell) return [];

    return Array.from(
      shell.querySelectorAll<HTMLButtonElement>(
        '[class*="AiStudio_platforms"] button',
      ),
    );
  }

  function selectedPlatformLabels() {
    return platformButtons()
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.textContent?.trim().toLowerCase() || "");
  }

  function outputsFromLabels(labels: string[]): OutputPlatforms {
    return {
      facebook: labels.some((label) => label.includes("facebook")),
      telegram: labels.some((label) => label.includes("telegram")),
      reels: labels.some((label) => label.includes("reels")),
      imagePrompt: labels.some(
        (label) =>
          label.includes("image prompt") || label.includes("图片提示词"),
      ),
    };
  }

  function findImageGenerateButton(
    shell: HTMLElement,
  ): HTMLButtonElement | null {
    const panel = shell.querySelector<HTMLElement>(
      '[class*="ImageAssetPanel_panel"]',
    );

    if (!panel) {
      return null;
    }

    return (
      Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => {
          const label = button.textContent?.trim().toLowerCase() || "";

          return (
            label.includes("generate and save") ||
            label.includes("generate another concept") ||
            label.includes("generating image")
          );
        },
      ) || null
    );
  }

  function runPromptGeneration() {
    if (isRunning) {
      return;
    }

    const selected = outputsFromLabels(selectedPlatformLabels());

    const request: ExternalGenerationRequest = {
      requestId: Date.now(),

      mode: "prompt",
    };

    setOutputPlatforms(selected);

    setOutputMode("prompt");

    setGenerateMode("prompt");

    setHasResult(false);

    setIsRunning(true);

    setGenerationRequest(request);
  }

  function runImageGeneration() {
    if (isRunning) {
      return;
    }

    const request: ExternalGenerationRequest = {
      requestId: Date.now(),

      mode: "image",
    };

    setOutputPlatforms({
      facebook: false,

      telegram: false,

      reels: false,

      imagePrompt: true,
    });

    setOutputMode("image");

    setGenerateMode("image");

    setHasResult(false);

    setIsRunning(true);

    setGenerationRequest(request);
  }

  function handleExternalGenerationEvent(event: ExternalGenerationEvent) {
    if (!generationRequest || event.requestId !== generationRequest.requestId) {
      return;
    }

    if (event.phase === "done") {
      setHasResult(true);

      setIsRunning(false);

      setGenerateMode(null);

      setGenerationRequest(null);

      /*
       * After a real image has finished generating,
       * reveal it automatically on mobile.
       *
       * Two animation frames allow React to:
       * 1. remove data-running=true
       * 2. reveal AiWorkspace / ImageAssetPanel
       * before scrolling.
       */
      if (event.mode === "image") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const shell = shellRef.current;

            const imageResult = shell?.querySelector<HTMLElement>(
              '[class*="ImageAssetPanel_result"]',
            );

            const imagePanel = shell?.querySelector<HTMLElement>(
              '[class*="ImageAssetPanel_panel"]',
            );

            const target = imageResult || imagePanel;

            target?.scrollIntoView({
              behavior: "smooth",

              block: "start",
            });
          });
        });
      }

      return;
    }

    if (event.phase === "error") {
      setIsRunning(false);

      setGenerateMode(null);

      setGenerationRequest(null);
    }
  }

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) {
      return;
    }

    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    const configureMobileStudio = () => {
      const nextFormCard = shell.querySelector<HTMLElement>(
        '[class*="AiStudio_formCard"]',
      );

      setFormCard((current) =>
        current === nextFormCard ? current : nextFormCard,
      );

      const collapseButton = Array.from(
        shell.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Collapse");

      collapseButton?.click();
    };

    const frame = window.requestAnimationFrame(configureMobileStudio);

    const observer = new MutationObserver(configureMobileStudio);

    observer.observe(shell, {
      childList: true,

      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);

      observer.disconnect();
    };
  }, []);

  /*
   * Reliable post-render image reveal.
   *
   * The background image job may finish before React has
   * committed the generated image element to the DOM.
   * Wait for the actual result before scrolling.
   */
  /*
   * ELENA_WORKSPACE_COMMAND_ROUTER
   *
   * Elena triggers the same Studio generation
   * functions used by the visible buttons.
   *
   * Phase 7B:
   * only report success after the real generation
   * function has completed.
   */
  useEffect(() => {
    const command = workspace.command;

    if (!command) {
      return;
    }

    if (lastWorkspaceCommandRef.current === command.id) {
      return;
    }

    if (
      command.type !== "generate-content" &&
      command.type !== "generate-image"
    ) {
      return;
    }

    lastWorkspaceCommandRef.current = command.id;

    let cancelled = false;

    const generationCommand = command;

    async function executeGeneration() {
      const isImage = generationCommand.type === "generate-image";

      try {
        if (isImage) {
          await Promise.resolve(runImageGeneration());
        } else {
          await Promise.resolve(runPromptGeneration());
        }

        if (cancelled) {
          return;
        }

        workspace.addActivity({
          type: "generate",
          label: isImage
            ? "Image generated successfully"
            : "Content generated successfully",
          status: "success",
        });

        workspace.setPreferredMobileTab("results");
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : isImage
              ? "Image generation failed."
              : "Content generation failed.";

        workspace.addActivity({
          type: "generate",
          label: isImage
            ? "Image generation failed"
            : "Content generation failed",
          detail: message,
          status: "error",
        });
      }
    }

    void executeGeneration();

    return () => {
      cancelled = true;
    };
  }, [workspace.command]);

  /*
   * ELENA_WORKSPACE_COMMAND_ROUTER
   *
   * Elena triggers the same Studio generation
   * functions used by the visible buttons.
   */
  useEffect(() => {
    const command = workspace.command;

    if (!command) {
      return;
    }

    if (lastWorkspaceCommandRef.current === command.id) {
      return;
    }

    lastWorkspaceCommandRef.current = command.id;

    if (command.type === "generate-content") {
      runPromptGeneration();
      return;
    }

    if (command.type === "generate-image") {
      runImageGeneration();
    }
  }, [workspace.command]);

  const isGenerating = isRunning;

  return (
    <section
      ref={shellRef}
      className={styles.shell}
      data-advanced-open={advancedOpen ? "true" : "false"}
      data-history-open={historyOpen ? "true" : "false"}
      data-output-mode={outputMode || generateMode || "none"}
      data-has-result={hasResult ? "true" : "false"}
      data-running={isRunning ? "true" : "false"}
      data-output-facebook={outputPlatforms.facebook ? "true" : "false"}
      data-output-telegram={outputPlatforms.telegram ? "true" : "false"}
      data-output-reels={outputPlatforms.reels ? "true" : "false"}
      data-output-image-prompt={outputPlatforms.imagePrompt ? "true" : "false"}
    >
      <header className={styles.mobileHeader}>
        <div>
          <span>AI Studio</span>
          <strong>Create content</strong>
        </div>

        <button
          type="button"
          className={styles.historyToggle}
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((current) => !current)}
        >
          <span>{historyOpen ? "Hide history" : "History"}</span>
          <span aria-hidden="true">{historyOpen ? "⌃" : "⌄"}</span>
        </button>
      </header>

      <AiStudio
        externalGenerateRequest={generationRequest}
        onExternalGenerationEvent={handleExternalGenerationEvent}
      />

      {formCard
        ? createPortal(
            <>
              <div className={styles.generateActions}>
                <button
                  type="button"
                  className={styles.promptButton}
                  disabled={isRunning}
                  onClick={runPromptGeneration}
                >
                  {isRunning && outputMode === "prompt"
                    ? "Generating prompt..."
                    : "✦ Generate Prompt"}
                </button>

                <button
                  type="button"
                  className={styles.imageButton}
                  disabled={isRunning}
                  onClick={runImageGeneration}
                >
                  {isRunning && outputMode === "image"
                    ? "Generating image..."
                    : "◇ Generate Image"}
                </button>
              </div>

              <button
                className={styles.advancedToggle}
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                <span>
                  {advancedOpen ? "Hide advanced options" : "Advanced options"}
                </span>
                <span aria-hidden="true">{advancedOpen ? "⌃" : "⌄"}</span>
              </button>
            </>,
            formCard,
          )
        : null}
    </section>
  );
}

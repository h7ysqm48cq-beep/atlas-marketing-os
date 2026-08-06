"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AiStudio } from "./AiStudio";
import styles from "./AiStudioMobileShell.module.css";

type OutputMode = "prompt" | "image" | null;

type GenerateMode = "prompt" | "image" | null;

type OutputPlatforms = {
  facebook: boolean;
  telegram: boolean;
  reels: boolean;
  imagePrompt: boolean;
};

const EMPTY_OUTPUTS: OutputPlatforms = {
  facebook: false,
  telegram: false,
  reels: false,
  imagePrompt: false,
};


export function AiStudioMobileShell() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formCard, setFormCard] = useState<HTMLElement | null>(null);
  const [nativeGenerateButton, setNativeGenerateButton] =
    useState<HTMLButtonElement | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>(null);
  const [generateMode, setGenerateMode] =
    useState<GenerateMode>(null);
  const [outputPlatforms, setOutputPlatforms] =
    useState<OutputPlatforms>(EMPTY_OUTPUTS);
  const [hasResult, setHasResult] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
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

  function selectOnlyImagePrompt() {
    platformButtons().forEach((button) => {
      const label = button.textContent?.trim().toLowerCase() || "";
      const selected = button.getAttribute("aria-pressed") === "true";
      const shouldSelect =
        label.includes("image prompt") || label.includes("图片提示词");

      if (selected !== shouldSelect) button.click();
    });
  }

  function runPromptGeneration() {
    if (!nativeGenerateButton || nativeGenerateButton.disabled) return;

    const selected = outputsFromLabels(selectedPlatformLabels());
    setOutputPlatforms(selected);
    setOutputMode("prompt");
    setHasResult(false);
    setIsRunning(true);
    nativeGenerateButton.click();
  }

  function runImageGeneration() {
    if (!nativeGenerateButton || nativeGenerateButton.disabled) return;

    selectOnlyImagePrompt();
    setOutputPlatforms({
      facebook: false,
      telegram: false,
      reels: false,
      imagePrompt: true,
    });
    setOutputMode("image");
    setHasResult(false);
    setIsRunning(true);

    window.requestAnimationFrame(() => nativeGenerateButton.click());

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

      const nextGenerateButton = shell.querySelector<HTMLButtonElement>(
        '[class*="AiStudio_generateButton"]',
      );

      setFormCard((current) =>
        current === nextFormCard ? current : nextFormCard,
      );

      setNativeGenerateButton((current) =>
        current === nextGenerateButton ? current : nextGenerateButton,
      );

      const collapseButton = Array.from(
        shell.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Collapse");
      collapseButton?.click();

      const text = shell.textContent || "";
      const generated =
        !text.includes("Generate content to create the Facebook version") &&
        !text.includes("Generate content to create the Telegram version") &&
        !text.includes("Generate content to create the Reels Script version") &&
        !text.includes("Generate content to create the Image Prompt version") &&
        (Boolean(shell.querySelector('[class*="AiWorkspace_cards"]')) ||
          Boolean(shell.querySelector('[class*="ImageAssetPanel_panel"]')));

      if (generated) {
        setHasResult(true);
        setIsRunning(false);

        if (!outputMode) {
          const labels = selectedPlatformLabels();
          const inferredOutputs = outputsFromLabels(labels);
          setOutputPlatforms(inferredOutputs);
          setOutputMode(
            labels.length === 1 && inferredOutputs.imagePrompt
              ? "image"
              : "prompt",
          );
        }
      }

    };

    const frame = window.requestAnimationFrame(configureMobileStudio);
    const observer = new MutationObserver(configureMobileStudio);

    observer.observe(shell, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "disabled"],

    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [outputMode]);

  const isGenerating = Boolean(nativeGenerateButton?.disabled);

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

      <AiStudio />

      {formCard
        ? createPortal(
            <>
              <div className={styles.generateActions}>
                <button
                  type="button"
                  className={styles.promptButton}
                  disabled={
                    !nativeGenerateButton ||
                    nativeGenerateButton.disabled ||
                    isRunning
                  }
                  onClick={runPromptGeneration}
                >
                  {isRunning && outputMode === "prompt"
                    ? "Generating prompt..."

                    : "✦ Generate Prompt"}
                </button>

                <button
                  type="button"
                  className={styles.imageButton}
                  disabled={
                    !nativeGenerateButton ||
                    nativeGenerateButton.disabled ||
                    isRunning
                  }
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

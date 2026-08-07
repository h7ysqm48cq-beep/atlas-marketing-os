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

  /*
   * MobileShell must follow AiStudio's real generation
   * lifecycle instead of guessing completion from output DOM.
   */
  const nativeGenerationStartedRef =
    useRef(false);

  /*
   * Mobile Generate Image is a two-stage flow:
   *
   * 1. Generate / refresh Image Prompt in AiStudio.
   * 2. Trigger the real ImageAssetPanel image generator.
   */
  const pendingImageGenerationRef =
    useRef(false);

  const imageClickIssuedRef =
    useRef(false);

  const imageBusyObservedRef =
    useRef(false);

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

    const panel =
      shell.querySelector<HTMLElement>(
        '[class*="ImageAssetPanel_panel"]',
      );


    if (!panel) {
      return null;
    }


    return (
      Array.from(
        panel.querySelectorAll<HTMLButtonElement>(
          "button",
        ),
      ).find(
        (button) => {

          const label =
            button.textContent
              ?.trim()
              .toLowerCase()
              ||
              "";


          return (
            label.includes(
              "generate and save",
            )
            ||
            label.includes(
              "generate another concept",
            )
            ||
            label.includes(
              "generating image",
            )
          );

        },
      )
      ||
      null
    );

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

    if (
      !nativeGenerateButton
      ||
      nativeGenerateButton.disabled
    ) {
      return;
    }


    /*
     * Explicit prompt generation must never accidentally
     * continue into image generation.
     */
    pendingImageGenerationRef.current =
      false;

    imageClickIssuedRef.current =
      false;

    imageBusyObservedRef.current =
      false;


    const selected =
      outputsFromLabels(
        selectedPlatformLabels(),
      );


    setOutputPlatforms(
      selected,
    );

    setOutputMode(
      "prompt",
    );

    setGenerateMode(
      "prompt",
    );

    setHasResult(
      false,
    );

    setIsRunning(
      true,
    );


    nativeGenerateButton.click();

  }

  function runImageGeneration() {

    if (
      !nativeGenerateButton
      ||
      nativeGenerateButton.disabled
    ) {
      return;
    }


    /*
     * Stage 1:
     * Generate a fresh Image Prompt through the normal
     * AI Studio background-job pipeline.
     */
    pendingImageGenerationRef.current =
      true;

    imageClickIssuedRef.current =
      false;

    imageBusyObservedRef.current =
      false;


    selectOnlyImagePrompt();


    setOutputPlatforms({
      facebook: false,
      telegram: false,
      reels: false,
      imagePrompt: true,
    });

    setOutputMode(
      "image",
    );

    setGenerateMode(
      "image",
    );

    setHasResult(
      false,
    );

    setIsRunning(
      true,
    );


    window.requestAnimationFrame(
      () => {

        nativeGenerateButton.click();

      },
    );

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

      /*
       * There are two independent async generators:
       *
       * - AiStudio workspace / Image Prompt generation
       * - ImageAssetPanel real image generation
       *
       * Follow their actual disabled states rather than
       * guessing completion from placeholder text.
       */

      const imageGenerateButton =
        findImageGenerateButton(
          shell,
        );


      /*
       * Observe the real image generator entering busy state.
       */
      if (
        pendingImageGenerationRef.current
        &&
        imageClickIssuedRef.current
        &&
        imageGenerateButton?.disabled
      ) {

        imageBusyObservedRef.current =
          true;

      }


      /*
       * Real image generation completed.
       *
       * We only consider it complete after seeing the
       * button disabled at least once, preventing a race
       * immediately after click().
       */
      if (
        pendingImageGenerationRef.current
        &&
        imageClickIssuedRef.current
        &&
        imageBusyObservedRef.current
        &&
        imageGenerateButton
        &&
        !imageGenerateButton.disabled
      ) {

        pendingImageGenerationRef.current =
          false;

        imageClickIssuedRef.current =
          false;

        imageBusyObservedRef.current =
          false;

        setHasResult(
          true,
        );

        setIsRunning(
          false,
        );

        setGenerateMode(
          null,
        );

      }


      /*
       * Observe normal AI Studio generation.
       */
      if (
        nextGenerateButton?.disabled
      ) {

        nativeGenerationStartedRef.current =
          true;

      } else if (
        nativeGenerationStartedRef.current
      ) {

        nativeGenerationStartedRef.current =
          false;


        const hasWorkspaceResult =
          Boolean(
            shell.querySelector(
              '[class*="AiWorkspace_cards"]',
            ),
          )
          ||
          Boolean(
            shell.querySelector(
              '[class*="ImageAssetPanel_panel"]',
            ),
          );


        if (
          hasWorkspaceResult
        ) {

          setHasResult(
            true,
          );

        }


        /*
         * Prompt-only generation ends here.
         *
         * Image generation remains running because it still
         * needs Stage 2 below.
         */
        if (
          !pendingImageGenerationRef.current
        ) {

          setIsRunning(
            false,
          );

          setGenerateMode(
            null,
          );


          if (
            !outputMode
          ) {

            const labels =
              selectedPlatformLabels();

            const inferredOutputs =
              outputsFromLabels(
                labels,
              );

            setOutputPlatforms(
              inferredOutputs,
            );

            setOutputMode(
              labels.length === 1
              &&
              inferredOutputs.imagePrompt
                ? "image"
                : "prompt",
            );

          }

        }

      }


      /*
       * Stage 2:
       *
       * Once Image Prompt generation has settled and the
       * ImageAssetPanel has mounted with an enabled button,
       * automatically invoke its REAL image generator.
       */
      if (
        pendingImageGenerationRef.current
        &&
        !nativeGenerationStartedRef.current
        &&
        !nextGenerateButton?.disabled
        &&
        !imageClickIssuedRef.current
        &&
        imageGenerateButton
        &&
        !imageGenerateButton.disabled
      ) {

        imageClickIssuedRef.current =
          true;


        window.requestAnimationFrame(
          () => {

            imageGenerateButton.click();

          },
        );

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

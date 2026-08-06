"use client";

import { useEffect, useRef, useState } from "react";
import { AiStudio } from "./AiStudio";
import styles from "./AiStudioMobileShell.module.css";

export function AiStudioMobileShell() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;

    const shell = shellRef.current;
    if (!shell) return;

    let actionRow: HTMLDivElement | null = null;

    const configureMobileStudio = () => {
      const selectedPlatformButtons = shell.querySelectorAll<HTMLButtonElement>(
        '[class*="AiStudio_platforms"] button[aria-pressed="true"]',
      );

      selectedPlatformButtons.forEach((button) => {
        const label = button.textContent?.trim().toLowerCase() || "";

        if (!label.includes("facebook")) {
          button.click();
        }
      });

      const collapseButton = Array.from(
        shell.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Collapse");

      collapseButton?.click();

      if (actionRow?.isConnected) return;

      const topicField = shell.querySelector<HTMLElement>(
        '[class*="AiStudio_formCard"] > label:first-child',
      );
      const textarea = topicField?.querySelector<HTMLTextAreaElement>("textarea");
      const generatePromptButton = shell.querySelector<HTMLButtonElement>(
        '[class*="AiStudio_generateButton"]',
      );
      const imageTabButton = Array.from(
        shell.querySelectorAll<HTMLButtonElement>(
          '[class*="AiWorkspace_tabs"] button',
        ),
      ).find((button) =>
        button.textContent?.trim().toLowerCase().includes("ai image"),
      );

      if (!topicField || !textarea || !generatePromptButton || !imageTabButton) {
        return;
      }

      actionRow = document.createElement("div");
      actionRow.className = styles.topicGenerateActions;

      const promptButton = document.createElement("button");
      promptButton.type = "button";
      promptButton.className = styles.generatePromptButton;
      promptButton.textContent = "Generate Prompt";
      promptButton.addEventListener("click", () => {
        generatePromptButton.click();
      });

      const imageButton = document.createElement("button");
      imageButton.type = "button";
      imageButton.className = styles.generateImageButton;
      imageButton.textContent = "Generate Image";
      imageButton.addEventListener("click", () => {
        imageTabButton.click();
        imageTabButton.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });

      actionRow.append(promptButton, imageButton);
      textarea.insertAdjacentElement("afterend", actionRow);
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
      actionRow?.remove();
    };
  }, []);

  return (
    <section
      ref={shellRef}
      className={styles.shell}
      data-advanced-open={advancedOpen ? "true" : "false"}
    >
      <header className={styles.mobileHeader}>
        <div>
          <span>AI Studio</span>
          <strong>Create content</strong>
        </div>

        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          {advancedOpen ? "Hide settings" : "Advanced"}
          <span aria-hidden="true">{advancedOpen ? "⌃" : "⌄"}</span>
        </button>
      </header>

      <AiStudio />
    </section>
  );
}

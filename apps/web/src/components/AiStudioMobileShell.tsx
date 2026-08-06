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

    let shortcut: HTMLButtonElement | null = null;
    let holder: HTMLDivElement | null = null;

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

      if (shortcut?.isConnected) return;

      const topicField = shell.querySelector<HTMLElement>(
        '[class*="AiStudio_formCard"] > label:first-child',
      );
      const originalImageButton = Array.from(
        shell.querySelectorAll<HTMLButtonElement>(
          '[class*="AiWorkspace_tabs"] button',
        ),
      ).find((button) =>
        button.textContent?.trim().toLowerCase().includes("ai image"),
      );

      if (!topicField || !originalImageButton) return;

      const topicLabel = topicField.querySelector<HTMLElement>("span");
      if (!topicLabel) return;

      holder = document.createElement("div");
      holder.className = styles.topicHeaderActions;

      shortcut = document.createElement("button");
      shortcut.type = "button";
      shortcut.className = styles.topicImagePromptButton;
      shortcut.textContent = "AI Image";
      shortcut.setAttribute("aria-label", "Open AI Image prompt");
      shortcut.addEventListener("click", () => {
        originalImageButton.click();
        originalImageButton.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });

      holder.appendChild(shortcut);
      topicLabel.insertAdjacentElement("afterend", holder);
      topicField.dataset.hasImageShortcut = "true";
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
      holder?.remove();
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

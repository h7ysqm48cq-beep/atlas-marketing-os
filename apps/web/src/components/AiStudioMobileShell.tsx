"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AiStudio } from "./AiStudio";
import styles from "./AiStudioMobileShell.module.css";

export function AiStudioMobileShell() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [formCard, setFormCard] = useState<HTMLElement | null>(null);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;

    const shell = shellRef.current;
    if (!shell) return;

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

      const nextFormCard = shell.querySelector<HTMLElement>(
        '[class*="AiStudio_formCard"]',
      );

      setFormCard((current) =>
        current === nextFormCard ? current : nextFormCard,
      );
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

  return (
    <section
      ref={shellRef}
      className={styles.shell}
      data-advanced-open={advancedOpen ? "true" : "false"}
      data-history-open={historyOpen ? "true" : "false"}
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
            </button>,
            formCard,
          )
        : null}
    </section>
  );
}

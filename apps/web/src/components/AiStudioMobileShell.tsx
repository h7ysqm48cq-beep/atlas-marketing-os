"use client";

import { useEffect, useRef, useState } from "react";
import { AiStudio } from "./AiStudio";
import styles from "./AiStudioMobileShell.module.css";

export function AiStudioMobileShell() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;

    const frame = window.requestAnimationFrame(() => {
      const shell = shellRef.current;
      if (!shell) return;

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
    });

    return () => window.cancelAnimationFrame(frame);
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

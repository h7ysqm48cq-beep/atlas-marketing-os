"use client";

import { useEffect } from "react";

export function PwaStandalone() {
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        (navigator as Navigator & { standalone?: boolean }).standalone ===
          true);

    document.documentElement.dataset.pwa = standalone
      ? "standalone"
      : "browser";

    const updateViewportHeight = () => {
      document.documentElement.style.setProperty(
        "--atlas-app-height",
        `${window.innerHeight}px`,
      );
    };

    updateViewportHeight();

    window.addEventListener("resize", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeight);

    return () => {
      window.removeEventListener("resize", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeight);
    };
  }, []);

  return null;
}

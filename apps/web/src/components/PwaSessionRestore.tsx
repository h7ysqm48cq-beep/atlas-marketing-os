"use client";

import { useEffect } from "react";

import {
  PWA_STARTUP_CHANGE_EVENT,
  readLastPwaRoute,
  readPwaStartupSettings,
} from "@/components/pwaStartupConfig";

function isStandalonePwa() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (
        navigator as Navigator & {
          standalone?: boolean;
        }
      ).standalone === true)
  );
}

export function PwaSessionRestore() {
  useEffect(() => {
    function sync() {
      if (!isStandalonePwa()) {
        return;
      }

      const settings = readPwaStartupSettings();

      const lastRoute = readLastPwaRoute();

      document.documentElement.dataset.pwaStartupMode = settings.enabled
        ? settings.mode
        : "disabled";

      document.documentElement.dataset.pwaLastRoute = lastRoute || "";
    }

    sync();

    window.addEventListener(PWA_STARTUP_CHANGE_EVENT, sync);

    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(PWA_STARTUP_CHANGE_EVENT, sync);

      window.removeEventListener("storage", sync);
    };
  }, []);

  return null;
}

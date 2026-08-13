"use client";

import { useEffect } from "react";

import {
  PWA_APPEARANCE_CHANGE_EVENT,
  readPwaAppearanceSettings,
} from "@/components/pwaAppearanceConfig";

export function PwaAppearanceSync() {
  useEffect(() => {
    function apply() {
      const settings = readPwaAppearanceSettings();

      const root = document.documentElement;

      root.dataset.pwaHeader = settings.showHeader ? "visible" : "hidden";

      root.dataset.pwaDockStyle = settings.dockStyle;

      root.dataset.pwaDockLabels = settings.showLabels ? "visible" : "hidden";
    }

    apply();

    window.addEventListener(PWA_APPEARANCE_CHANGE_EVENT, apply);

    window.addEventListener("storage", apply);

    return () => {
      window.removeEventListener(PWA_APPEARANCE_CHANGE_EVENT, apply);

      window.removeEventListener("storage", apply);
    };
  }, []);

  return null;
}

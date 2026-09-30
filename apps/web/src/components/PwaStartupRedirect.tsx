"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { readPwaControlSettings } from "@/components/pwaControlConfig";

import {
  readLastPwaRoute,
  readPwaStartupSettings,
} from "@/components/pwaStartupConfig";

const SESSION_KEY = "atlas.pwa.startup.applied";

function isStandalone() {
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

export function PwaStartupRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isStandalone()) {
      return;
    }

    if (window.sessionStorage.getItem(SESSION_KEY) === "true") {
      return;
    }

    window.sessionStorage.setItem(SESSION_KEY, "true");

    const control = readPwaControlSettings();

    if (!control.customizationsEnabled) {
      return;
    }

    const settings = readPwaStartupSettings();

    if (!settings.enabled) {
      return;
    }

    /*
     * Preserve direct/deep links.
     *
     * Startup behaviour only applies when
     * Atlas launches from its root route.
     */
    if (pathname !== "/") {
      return;
    }

    let target = settings.path;

    if (settings.mode === "last-page") {
      target = readLastPwaRoute() || settings.path;
    }

    if (!target || target === pathname) {
      return;
    }

    router.replace(target);
  }, [pathname, router]);

  return null;
}

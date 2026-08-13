"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const START_EVENT = "atlas:pwa-navigation-start";

export function startPwaNavigationProgress() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(START_EVENT));
}

export function PwaNavigationProgress() {
  const pathname = usePathname();

  const [visible, setVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const startedAt = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const safetyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const clearTimers = () => {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }

      if (safetyTimer.current) {
        window.clearTimeout(safetyTimer.current);
      }
    };

    const start = () => {
      clearTimers();

      startedAt.current = Date.now();

      setFinishing(false);
      setVisible(true);

      /*
       * Safety fallback:
       * never leave the UI looking permanently busy.
       */
      safetyTimer.current = window.setTimeout(() => {
        setFinishing(true);

        hideTimer.current = window.setTimeout(() => {
          setVisible(false);
          setFinishing(false);
        }, 220);
      }, 8000);
    };

    window.addEventListener(START_EVENT, start);

    return () => {
      window.removeEventListener(START_EVENT, start);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const elapsed = Date.now() - startedAt.current;

    /*
     * Keep the feedback visible briefly so very fast
     * navigations still feel responsive rather than flashing.
     */
    const minimumVisible = 260;
    const wait = Math.max(0, minimumVisible - elapsed);

    const finishTimer = window.setTimeout(() => {
      setFinishing(true);

      hideTimer.current = window.setTimeout(() => {
        setVisible(false);
        setFinishing(false);
      }, 220);
    }, wait);

    return () => {
      window.clearTimeout(finishTimer);
    };
  }, [pathname, visible]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={`atlas-pwa-route-progress${finishing ? " is-finishing" : ""}`}
      aria-hidden="true"
    >
      <span />
    </div>
  );
}

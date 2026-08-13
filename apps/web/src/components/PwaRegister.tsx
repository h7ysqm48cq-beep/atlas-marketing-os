"use client";

import { useEffect, useState } from "react";

export function PwaRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );

  useEffect(() => {
    /*
     * Service workers must not control the Next.js development server.
     *
     * A previously registered Atlas worker can cache or serve stale
     * development assets, interfere with Fast Refresh, and trigger
     * controllerchange reload loops.
     *
     * PWA registration remains enabled in production.
     */
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;
    let refreshing = false;

    const handleControllerChange = () => {
      if (refreshing) {
        return;
      }

      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration?.installing;

          if (!installing) {
            return;
          }

          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(installing);
            }
          });
        });

        /*
         * Check for a new Railway deployment periodically while
         * Atlas remains open.
         */
        const interval = window.setInterval(
          () => {
            void registration?.update();
          },
          30 * 60 * 1000,
        );

        return () => window.clearInterval(interval);
      } catch (error) {
        console.error("Atlas service worker registration failed:", error);

        return undefined;
      }
    };

    let cleanupInterval: (() => void) | undefined;

    void register().then((cleanup) => {
      cleanupInterval = cleanup;
    });

    return () => {
      cleanupInterval?.();

      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, []);

  const updateAtlas = () => {
    if (!waitingWorker) {
      return;
    }

    waitingWorker.postMessage({
      type: "SKIP_WAITING",
    });
  };

  return waitingWorker ? (
    <div className="atlas-pwa-update" role="status" aria-live="polite">
      <div className="atlas-pwa-update__copy">
        <strong>New Atlas version available</strong>
        <span>更新后即可使用最新版本。</span>
      </div>

      <button
        type="button"
        className="atlas-pwa-update__button"
        onClick={updateAtlas}
      >
        Update now
      </button>

      <button
        type="button"
        className="atlas-pwa-update__dismiss"
        aria-label="Dismiss update"
        onClick={() => setWaitingWorker(null)}
      >
        ×
      </button>
    </div>
  ) : null;
}

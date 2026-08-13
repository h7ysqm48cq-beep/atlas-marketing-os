"use client";

import { useEffect, useState } from "react";

type NetworkState = "online" | "offline" | "restored";

export function PwaNetworkStatus() {
  const [state, setState] = useState<NetworkState>("online");

  useEffect(() => {
    let restoredTimer: number | undefined;

    const handleOffline = () => {
      if (restoredTimer) {
        window.clearTimeout(restoredTimer);
      }

      setState("offline");
    };

    const handleOnline = () => {
      setState("restored");

      restoredTimer = window.setTimeout(() => {
        setState("online");
      }, 2500);
    };

    if (!navigator.onLine) {
      setState("offline");
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);

      if (restoredTimer) {
        window.clearTimeout(restoredTimer);
      }
    };
  }, []);

  if (state === "online") {
    return null;
  }

  return (
    <div
      className={`atlas-network-status atlas-network-status--${state}`}
      role="status"
      aria-live="polite"
    >
      <span className="atlas-network-status__indicator" />

      <div className="atlas-network-status__copy">
        <strong>
          {state === "offline" ? "Atlas is offline" : "Connection restored"}
        </strong>

        <span>
          {state === "offline"
            ? "Waiting for your connection to return…"
            : "Atlas is back online."}
        </span>
      </div>
    </div>
  );
}

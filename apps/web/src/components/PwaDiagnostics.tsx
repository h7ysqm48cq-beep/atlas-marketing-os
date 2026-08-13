"use client";

import { useEffect, useState } from "react";

type Diagnostics = {
  mode: "Standalone" | "Browser";
  network: "Online" | "Offline";
  serviceWorker: "Active" | "Missing";
  controller: "Controlled" | "Uncontrolled";
  platform: string;
  version: string;
};

function detectPlatform() {
  const ua = navigator.userAgent;

  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";

  return "Other";
}

export function PwaDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    const update = async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator &&
          (
            navigator as Navigator & {
              standalone?: boolean;
            }
          ).standalone === true);

      let serviceWorker: Diagnostics["serviceWorker"] = "Missing";

      let controller: Diagnostics["controller"] = "Uncontrolled";

      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();

        if (registration) {
          serviceWorker = "Active";
        }

        if (navigator.serviceWorker.controller) {
          controller = "Controlled";
        }
      }

      setDiagnostics({
        mode: standalone ? "Standalone" : "Browser",
        network: navigator.onLine ? "Online" : "Offline",
        serviceWorker,
        controller,
        platform: detectPlatform(),
        version:
          document
            .querySelector('meta[name="atlas-build"]')
            ?.getAttribute("content") || "Unknown",
      });
    };

    void update();

    const handleNetwork = () => {
      void update();
    };

    window.addEventListener("online", handleNetwork);
    window.addEventListener("offline", handleNetwork);

    navigator.serviceWorker?.addEventListener(
      "controllerchange",
      handleNetwork,
    );

    return () => {
      window.removeEventListener("online", handleNetwork);
      window.removeEventListener("offline", handleNetwork);

      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        handleNetwork,
      );
    };
  }, []);

  if (!diagnostics) {
    return null;
  }

  return (
    <section className="atlas-pwa-diagnostics">
      <div className="atlas-pwa-diagnostics__header">
        <div>
          <strong>Atlas App Status</strong>
          <span>PWA & device diagnostics</span>
        </div>
      </div>

      <div className="atlas-pwa-diagnostics__grid">
        <DiagnosticItem label="App mode" value={diagnostics.mode} />

        <DiagnosticItem label="Network" value={diagnostics.network} />

        <DiagnosticItem
          label="Service Worker"
          value={diagnostics.serviceWorker}
        />

        <DiagnosticItem label="Controller" value={diagnostics.controller} />

        <DiagnosticItem label="Platform" value={diagnostics.platform} />

        <DiagnosticItem label="App version" value={diagnostics.version} />
      </div>
    </section>
  );
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="atlas-pwa-diagnostics__item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

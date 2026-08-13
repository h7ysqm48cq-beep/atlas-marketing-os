"use client";

import { useState, type ReactNode } from "react";

type PwaSettingsSectionProps = {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function PwaSettingsSection({
  id,
  title,
  description,
  children,
  defaultOpen = false,
}: PwaSettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`atlas-pwa-accordion${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="atlas-pwa-accordion__trigger"
        aria-expanded={open}
        aria-controls={`pwa-section-${id}`}
        onClick={() => setOpen((current) => !current)}
      >
        <div>
          <strong>{title}</strong>

          <span>{description}</span>
        </div>

        <span className="atlas-pwa-accordion__chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <div
        id={`pwa-section-${id}`}
        className="atlas-pwa-accordion__content"
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}

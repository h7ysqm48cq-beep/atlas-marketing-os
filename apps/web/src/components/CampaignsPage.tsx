"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./CampaignsPage.module.css";

type CampaignStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "ARCHIVED";

type Campaign = {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  brand: {
    id: string;
    name: string;
    workspace: {
      id: string;
      name: string;
      slug: string;
    };
  };
};

type CampaignForm = {
  name: string;
  description: string;
  objective: string;
  status: CampaignStatus;
  startDate: string;
  endDate: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const emptyForm: CampaignForm = {
  name: "",
  description: "",
  objective: "",
  status: "DRAFT",
  startDate: "",
  endDate: "",
};

const statusOptions: CampaignStatus[] = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "ARCHIVED",
];

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "ALL">(
    "ALL",
  );
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("Loading campaigns...");

  useEffect(() => {
    void loadCampaigns();
  }, []);

  const filteredCampaigns = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    return campaigns.filter((campaign) => {
      const matchesQuery =
        !cleanQuery ||
        campaign.name.toLowerCase().includes(cleanQuery) ||
        campaign.description?.toLowerCase().includes(cleanQuery) ||
        campaign.objective?.toLowerCase().includes(cleanQuery);

      const matchesStatus =
        statusFilter === "ALL" || campaign.status === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [campaigns, query, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: campaigns.length,
      active: campaigns.filter((item) => item.status === "ACTIVE").length,
      draft: campaigns.filter((item) => item.status === "DRAFT").length,
      completed: campaigns.filter((item) => item.status === "COMPLETED").length,
    };
  }, [campaigns]);

  async function loadCampaigns() {
    try {
      const response = await fetch(`${API_BASE_URL}/campaigns`, {
        cache: "no-store",
      });
      const data = (await response.json()) as Campaign[] | { message?: string };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.message
            ? data.message
            : "Unable to load campaigns.",
        );
      }

      setCampaigns(data);
      setMessage(
        data.length === 0
          ? "No campaigns yet."
          : `${data.length} campaign${data.length === 1 ? "" : "s"} loaded.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load campaigns.",
      );
    }
  }

  function openCreateModal() {
    setSelected(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEditModal(campaign: Campaign) {
    setSelected(campaign);
    setForm({
      name: campaign.name,
      description: campaign.description || "",
      objective: campaign.objective || "",
      status: campaign.status,
      startDate: toDateInput(campaign.startDate),
      endDate: toDateInput(campaign.endDate),
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    if (isSaving) return;
    setIsModalOpen(false);
    setSelected(null);
    setForm(emptyForm);
  }

  function updateForm<K extends keyof CampaignForm>(
    key: K,
    value: CampaignForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      setMessage("Campaign name is required.");
      return;
    }

    setIsSaving(true);
    setMessage(selected ? "Updating campaign..." : "Creating campaign...");

    try {
      const endpoint = selected
        ? `${API_BASE_URL}/campaigns/${selected.id}`
        : `${API_BASE_URL}/campaigns`;

      const response = await fetch(endpoint, {
        method: selected ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          objective: form.objective.trim() || undefined,
          status: form.status,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        }),
      });

      const data = (await response.json()) as Campaign | { message?: string };

      if (!response.ok) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to save campaign.",
        );
      }

      await loadCampaigns();
      closeModal();
      setMessage(selected ? "Campaign updated." : "Campaign created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save campaign.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCampaign(campaign: Campaign) {
    const confirmed = window.confirm(
      `Delete "${campaign.name}"? This cannot be undone.`,
    );

    if (!confirmed) return;

    setMessage("Deleting campaign...");

    try {
      const response = await fetch(
        `${API_BASE_URL}/campaigns/${campaign.id}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        throw new Error(data.message || "Unable to delete campaign.");
      }

      setCampaigns((current) =>
        current.filter((item) => item.id !== campaign.id),
      );
      setMessage("Campaign deleted.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete campaign.",
      );
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Campaign OS</p>
          <h1>Plan, organise and manage every marketing initiative.</h1>
          <p>
            Each campaign becomes a dedicated workspace for content, images,
            history, scheduling and future analytics.
          </p>
        </div>

        <button className={styles.primaryButton} onClick={openCreateModal}>
          + New campaign
        </button>
      </section>

      <section className={styles.statsGrid}>
        <Stat label="Total campaigns" value={stats.total} />
        <Stat label="Active" value={stats.active} />
        <Stat label="Draft" value={stats.draft} />
        <Stat label="Completed" value={stats.completed} />
      </section>

      <section className={styles.toolbar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search campaign name, description or objective..."
        />

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as CampaignStatus | "ALL")
          }
        >
          <option value="ALL">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {formatStatus(status)}
            </option>
          ))}
        </select>

        <button onClick={() => void loadCampaigns()}>Refresh</button>
      </section>

      <div className={styles.statusMessage}>{message}</div>

      <section className={styles.campaignGrid}>
        {filteredCampaigns.length === 0 ? (
          <div className={styles.emptyState}>
            <span>◉</span>
            <strong>No matching campaigns</strong>
            <p>Create a campaign or adjust your search and status filter.</p>
            <button onClick={openCreateModal}>Create campaign</button>
          </div>
        ) : (
          filteredCampaigns.map((campaign) => (
            <article className={styles.card} key={campaign.id}>
              <div className={styles.cardTop}>
                <StatusBadge status={campaign.status} />
                <span className={styles.brandName}>{campaign.brand.name}</span>
              </div>

              <h2>{campaign.name}</h2>
              <p className={styles.description}>
                {campaign.description || "No campaign description yet."}
              </p>

              <div className={styles.objective}>
                <span>Objective</span>
                <strong>{campaign.objective || "Not configured"}</strong>
              </div>

              <div className={styles.dateRange}>
                <div>
                  <span>Start</span>
                  <strong>{formatDate(campaign.startDate)}</strong>
                </div>
                <div>
                  <span>End</span>
                  <strong>{formatDate(campaign.endDate)}</strong>
                </div>
              </div>

              <div className={styles.cardFooter}>
  <small>Updated {formatDateTime(campaign.updatedAt)}</small>

  <div>
    <button
      onClick={() => {
        window.location.href = `/campaigns/${campaign.id}`;
      }}
    >
      Open
    </button>

    <button onClick={() => openEditModal(campaign)}>
      Edit
    </button>

    <button
      className={styles.deleteButton}
      onClick={() => void deleteCampaign(campaign)}
    >
      Delete
    </button>
  </div>
</div>
            </article>
          ))
        )}
      </section>

      {isModalOpen ? (
        <div className={styles.modalBackdrop} onMouseDown={closeModal}>
          <div
            className={styles.modal}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <span>{selected ? "Edit campaign" : "New campaign"}</span>
                <h2>{selected?.name || "Create a campaign workspace"}</h2>
              </div>
              <button onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>

            <form onSubmit={saveCampaign}>
              <label className={styles.field}>
                <span>Campaign name</span>
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="Example: 港剧怀旧系列"
                  required
                />
              </label>

              <label className={styles.field}>
                <span>Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    updateForm("description", event.target.value)
                  }
                  placeholder="What is this campaign about?"
                />
              </label>

              <label className={styles.field}>
                <span>Objective</span>
                <textarea
                  value={form.objective}
                  onChange={(event) =>
                    updateForm("objective", event.target.value)
                  }
                  placeholder="Example: Increase Facebook discussion and sharing"
                />
              </label>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Status</span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      updateForm(
                        "status",
                        event.target.value as CampaignStatus,
                      )
                    }
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {formatStatus(status)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Start date</span>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) =>
                      updateForm("startDate", event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>End date</span>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(event) =>
                      updateForm("endDate", event.target.value)
                    }
                  />
                </label>
              </div>

              <div className={styles.modalActions}>
                <button type="button" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving
                    ? "Saving..."
                    : selected
                      ? "Save changes"
                      : "Create campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.statCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={`${styles.statusBadge} ${styles[`status${status}`]}`}
    >
      {formatStatus(status)}
    </span>
  );
}

function formatStatus(status: CampaignStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function toDateInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./CampaignsPage.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

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
  const { language } = usePreferences();

  const copy =
    language === "zh"
      ? {
          eyebrow: "营销活动管理",
          title: "规划、组织并管理每一个营销活动。",
          description:
            "每个营销活动都是独立工作区，统一管理内容、图片、历史记录、排程与分析。",
          newCampaign: "新增营销活动",
          totalCampaigns: "营销活动总数",
          active: "进行中",
          draft: "草稿",
          completed: "已完成",
          search: "搜索营销活动名称、说明或目标……",
          allStatuses: "所有状态",
          refresh: "刷新",
          noMatching: "没有符合条件的营销活动",
          emptyDescription: "请创建营销活动，或调整搜索与状态筛选。",
          createCampaign: "创建营销活动",
          noDescription: "尚未填写营销活动说明。",
          objective: "目标",
          notConfigured: "尚未设置",
          start: "开始日期",
          end: "结束日期",
          updated: "更新于",
          open: "打开",
          edit: "编辑",
          delete: "删除",
          editCampaign: "编辑营销活动",
          newCampaignLabel: "新增营销活动",
          createWorkspace: "建立营销活动工作区",
          campaignName: "营销活动名称",
          campaignNamePlaceholder: "例如：港剧怀旧系列",
          descriptionLabel: "说明",
          descriptionPlaceholder: "这个营销活动的内容是什么？",
          objectivePlaceholder: "例如：提高 Facebook 讨论与分享",
          status: "状态",
          startDate: "开始日期",
          endDate: "结束日期",
          cancel: "取消",
          saving: "保存中……",
          saveChanges: "保存修改",
          close: "关闭",
          loading: "正在加载营销活动……",
          noCampaigns: "尚未建立营销活动。",
          loadFailed: "无法加载营销活动。",
          nameRequired: "请填写营销活动名称。",
          updating: "正在更新营销活动……",
          creating: "正在创建营销活动……",
          saveFailed: "无法保存营销活动。",
          updatedSuccess: "营销活动已更新。",
          createdSuccess: "营销活动已创建。",
          deleting: "正在删除营销活动……",
          deleteFailed: "无法删除营销活动。",
          deletedSuccess: "营销活动已删除。",
          confirmDelete: (name: string) =>
            `确定删除“${name}”吗？此操作无法撤销。`,
          loadedCount: (count: number) => `已加载 ${count} 个营销活动。`,
          notSet: "尚未设置",
          statuses: {
            DRAFT: "草稿",
            ACTIVE: "进行中",
            PAUSED: "已暂停",
            COMPLETED: "已完成",
            ARCHIVED: "已归档",
          } as Record<CampaignStatus, string>,
        }
      : {
          eyebrow: "Campaign OS",
          title: "Plan, organise and manage every marketing initiative.",
          description:
            "Each campaign becomes a dedicated workspace for content, images, history, scheduling and analytics.",
          newCampaign: "New campaign",
          totalCampaigns: "Total campaigns",
          active: "Active",
          draft: "Draft",
          completed: "Completed",
          search: "Search campaign name, description or objective...",
          allStatuses: "All statuses",
          refresh: "Refresh",
          noMatching: "No matching campaigns",
          emptyDescription:
            "Create a campaign or adjust your search and status filter.",
          createCampaign: "Create campaign",
          noDescription: "No campaign description yet.",
          objective: "Objective",
          notConfigured: "Not configured",
          start: "Start",
          end: "End",
          updated: "Updated",
          open: "Open",
          edit: "Edit",
          delete: "Delete",
          editCampaign: "Edit campaign",
          newCampaignLabel: "New campaign",
          createWorkspace: "Create a campaign workspace",
          campaignName: "Campaign name",
          campaignNamePlaceholder: "Example: Nostalgic drama series",
          descriptionLabel: "Description",
          descriptionPlaceholder: "What is this campaign about?",
          objectivePlaceholder:
            "Example: Increase Facebook discussion and sharing",
          status: "Status",
          startDate: "Start date",
          endDate: "End date",
          cancel: "Cancel",
          saving: "Saving...",
          saveChanges: "Save changes",
          close: "Close",
          loading: "Loading campaigns...",
          noCampaigns: "No campaigns yet.",
          loadFailed: "Unable to load campaigns.",
          nameRequired: "Campaign name is required.",
          updating: "Updating campaign...",
          creating: "Creating campaign...",
          saveFailed: "Unable to save campaign.",
          updatedSuccess: "Campaign updated.",
          createdSuccess: "Campaign created.",
          deleting: "Deleting campaign...",
          deleteFailed: "Unable to delete campaign.",
          deletedSuccess: "Campaign deleted.",
          confirmDelete: (name: string) =>
            `Delete "${name}"? This cannot be undone.`,
          loadedCount: (count: number) =>
            `${count} campaign${count === 1 ? "" : "s"} loaded.`,
          notSet: "Not set",
          statuses: {
            DRAFT: "Draft",
            ACTIVE: "Active",
            PAUSED: "Paused",
            COMPLETED: "Completed",
            ARCHIVED: "Archived",
          } as Record<CampaignStatus, string>,
        };

  const locale = language === "zh" ? "zh-CN" : "en-MY";

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "ALL">(
    "ALL",
  );
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(copy.loading);

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
      const response = await fetch(`${API_URL}/campaigns`, {
        cache: "no-store",
      });
      const data = (await response.json()) as Campaign[] | { message?: string };

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(
          !Array.isArray(data) && data.message ? data.message : copy.loadFailed,
        );
      }

      setCampaigns(data);
      setMessage(
        data.length === 0 ? copy.noCampaigns : copy.loadedCount(data.length),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.loadFailed);
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
      setMessage(copy.nameRequired);
      return;
    }

    setIsSaving(true);
    setMessage(selected ? copy.updating : copy.creating);

    try {
      const endpoint = selected
        ? `${API_URL}/campaigns/${selected.id}`
        : `${API_URL}/campaigns`;

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
          "message" in data && data.message ? data.message : copy.saveFailed,
        );
      }

      await loadCampaigns();
      closeModal();
      setMessage(selected ? copy.updatedSuccess : copy.createdSuccess);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCampaign(campaign: Campaign) {
    const confirmed = window.confirm(copy.confirmDelete(campaign.name));

    if (!confirmed) return;

    setMessage(copy.deleting);

    try {
      const response = await fetch(`${API_URL}/campaigns/${campaign.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        throw new Error(data.message || copy.deleteFailed);
      }

      setCampaigns((current) =>
        current.filter((item) => item.id !== campaign.id),
      );
      setMessage(copy.deletedSuccess);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.deleteFailed);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>

        <button className={styles.primaryButton} onClick={openCreateModal}>
          + {copy.newCampaign}
        </button>
      </section>

      <section className={styles.statsGrid}>
        <Stat label={copy.totalCampaigns} value={stats.total} />
        <Stat label={copy.active} value={stats.active} />
        <Stat label={copy.draft} value={stats.draft} />
        <Stat label={copy.completed} value={stats.completed} />
      </section>

      <section className={styles.toolbar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
        />

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as CampaignStatus | "ALL")
          }
        >
          <option value="ALL">{copy.allStatuses}</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {copy.statuses[status]}
            </option>
          ))}
        </select>

        <button onClick={() => void loadCampaigns()}>{copy.refresh}</button>
      </section>

      <div className={styles.statusMessage}>{message}</div>

      <section className={styles.campaignGrid}>
        {filteredCampaigns.length === 0 ? (
          <div className={styles.emptyState}>
            <span>◉</span>
            <strong>{copy.noMatching}</strong>
            <p>{copy.emptyDescription}</p>
            <button onClick={openCreateModal}>{copy.createCampaign}</button>
          </div>
        ) : (
          filteredCampaigns.map((campaign) => (
            <article className={styles.card} key={campaign.id}>
              <div className={styles.cardTop}>
                <StatusBadge
                  status={campaign.status}
                  label={copy.statuses[campaign.status]}
                />
                <span className={styles.brandName}>{campaign.brand.name}</span>
              </div>

              <h2>{campaign.name}</h2>
              <p className={styles.description}>
                {campaign.description || copy.noDescription}
              </p>

              <div className={styles.objective}>
                <span>{copy.objective}</span>
                <strong>{campaign.objective || copy.notConfigured}</strong>
              </div>

              <div className={styles.dateRange}>
                <div>
                  <span>{copy.start}</span>
                  <strong>
                    {formatDate(campaign.startDate, locale, copy.notSet)}
                  </strong>
                </div>
                <div>
                  <span>{copy.end}</span>
                  <strong>
                    {formatDate(campaign.endDate, locale, copy.notSet)}
                  </strong>
                </div>
              </div>

              <div className={styles.cardFooter}>
                <small>
                  {copy.updated} {formatDateTime(campaign.updatedAt, locale)}
                </small>

                <div>
                  <button
                    onClick={() => {
                      window.location.href = `/campaigns/${campaign.id}`;
                    }}
                  >
                    Open
                  </button>

                  <button onClick={() => openEditModal(campaign)}>Edit</button>

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
                <span>
                  {selected ? copy.editCampaign : copy.newCampaignLabel}
                </span>
                <h2>{selected?.name || copy.createWorkspace}</h2>
              </div>
              <button onClick={closeModal} aria-label={copy.close}>
                ×
              </button>
            </div>

            <form onSubmit={saveCampaign}>
              <label className={styles.field}>
                <span>{copy.campaignName}</span>
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder={copy.campaignNamePlaceholder}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>{copy.descriptionLabel}</span>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    updateForm("description", event.target.value)
                  }
                  placeholder={copy.descriptionPlaceholder}
                />
              </label>

              <label className={styles.field}>
                <span>{copy.objective}</span>
                <textarea
                  value={form.objective}
                  onChange={(event) =>
                    updateForm("objective", event.target.value)
                  }
                  placeholder={copy.objectivePlaceholder}
                />
              </label>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>{copy.status}</span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      updateForm("status", event.target.value as CampaignStatus)
                    }
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {copy.statuses[status]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>{copy.startDate}</span>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) =>
                      updateForm("startDate", event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>{copy.endDate}</span>
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
                    ? copy.saving
                    : selected
                      ? copy.saveChanges
                      : copy.createCampaign}
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

function StatusBadge({
  status,
  label,
}: {
  status: CampaignStatus;
  label: string;
}) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status${status}`]}`}>
      {label}
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

function formatDate(value: string | null, locale: string, emptyLabel: string) {
  if (!value) return emptyLabel;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

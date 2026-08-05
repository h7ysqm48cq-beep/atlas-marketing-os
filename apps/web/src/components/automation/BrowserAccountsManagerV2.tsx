"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_URL } from "@/lib/api";
import styles from "./BrowserAccountsManagerV2.module.css";

type ProxyType =
  | "DIRECT"
  | "HTTP"
  | "HTTPS"
  | "SOCKS5";

type LoginStatus =
  | "PENDING"
  | "BROWSER_OPEN"
  | "BROWSER_CLOSED"
  | "LOGIN_REQUIRED"
  | "LOGGED_IN"
  | "TWO_FACTOR_REQUIRED"
  | "CHECKPOINT_REQUIRED"
  | "UNKNOWN"
  | string;

type BrowserAccount = {
  id: string;
  displayName: string;
  platform: string;
  brandId: string | null;
  workspaceId?: string | null;
  browserProfileKey: string;
  browserProfileName: string;
  locale: string;
  timezone: string;

  proxyType: ProxyType;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyCountry: string | null;
  hasProxyUsername: boolean;
  hasProxyPassword: boolean;

  facebookUserId: string | null;
  facebookUserName: string | null;

  loginStatus: LoginStatus;
  cookieStatus: string;
  lastKnownIp: string | null;
  lastLoginAt: string | null;
  lastVerifiedAt: string | null;
  lastHeartbeatAt: string | null;
  lastLoginError: string | null;

  channels: unknown[];
  createdAt: string;
  updatedAt: string;
};

type BrowserSession = {
  channelId: string;
  browserProfileKey: string;
  profileDirectory?: string;
  openedAt: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  headless: boolean;
  currentUrl: string | null;
};

type AccountRuntime = {
  loading: boolean;
  running: boolean;
  session: BrowserSession | null;
  error: string;
};

type EditAccountForm = {
  displayName: string;
  browserProfileName: string;
  brandId: string;
  locale: string;
  timezone: string;
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
  proxyCountry: string;
  clearProxyCredentials: boolean;
};

type BrandOption = {
  id: string;
  name: string;
  workspaceId?: string | null;
};

type AutomationPolicy = {
  id: string;
  browserAccountId: string;
  autoVerifyLogin: boolean;
  autoDiscoverPages: boolean;
  autoSyncPages: boolean;
  autoHealthCheck: boolean;
  autoCloseBrowser: boolean;
  autoNotifications: boolean;
  keepBrowserOpenAfterLogin: boolean;
  createdAt: string;
  updatedAt: string;
};

type TimelineEvent = {
  id: string;
  browserAccountId: string;
  eventType: string;
  status:
    | "INFO"
    | "SUCCESS"
    | "WARNING"
    | "FAILED"
    | string;
  title: string;
  message: string | null;
  metadata?: unknown;
  createdAt: string;
};

type OnboardingStep =
  | "IDLE"
  | "VERIFYING"
  | "DISCOVERING"
  | "SYNCING"
  | "COMPLETED"
  | "ATTENTION"
  | "FAILED";

type OnboardingResult = {
  success?: boolean;
  completed?: boolean;
  accountId?: string;
  loginStatus?: string;
  pagesDiscovered?: number;
  browserClosed?: boolean;
  requiresAttention?: boolean;
  step?: string;
  syncResult?: {
    created?: number;
    reused?: number;
    linked?: number;
  } | null;
};

type InspectionResult = {
  loginStatus?: string;
  loginLikely?: boolean;
  loginRequired?: boolean;
  twoFactorRequired?: boolean;
  checkpointRequired?: boolean;
  page?: {
    title?: string;
    url?: string;
  };
};

const EMPTY_RUNTIME: AccountRuntime = {
  loading: false,
  running: false,
  session: null,
  error: "",
};

const NOVNC_URL =
  process.env.NEXT_PUBLIC_BROWSER_VIEW_URL ||
  "https://browser-worker-production-536a.up.railway.app/vnc.html";

async function readJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(
      text,
    ) as Record<string, unknown>;
  } catch {
    return {
      message: text,
    };
  }
}

function getErrorMessage(
  body: Record<string, unknown>,
  fallback: string,
) {
  return typeof body.message ===
    "string" &&
    body.message.trim()
    ? body.message
    : fallback;
}

function formatDate(
  value?: string | null,
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en-MY",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function normalizeStatus(
  value?: string | null,
) {
  return (
    value?.trim().toUpperCase() ||
    "UNKNOWN"
  );
}

function loginStatusClass(
  status?: string | null,
) {
  const normalized =
    normalizeStatus(status);

  if (
    normalized === "LOGGED_IN"
  ) {
    return styles.good;
  }

  if (
    normalized ===
      "TWO_FACTOR_REQUIRED" ||
    normalized ===
      "CHECKPOINT_REQUIRED"
  ) {
    return styles.warning;
  }

  if (
    normalized ===
      "LOGIN_REQUIRED" ||
    normalized === "FAILED"
  ) {
    return styles.bad;
  }

  return styles.neutral;
}

function readableStatus(
  value?: string | null,
) {
  return normalizeStatus(
    value,
  ).replaceAll(
    "_",
    " ",
  );
}

export function BrowserAccountsManagerV2({
  requestedAccountId,
}: {
  requestedAccountId?: string | null;
}) {
  const [
    accounts,
    setAccounts,
  ] = useState<
    BrowserAccount[]
  >([]);

  const [
    runtimes,
    setRuntimes,
  ] = useState<
    Record<
      string,
      AccountRuntime
    >
  >({});

  const [
    selectedId,
    setSelectedId,
  ] = useState<
    string | null
  >(null);

  const [
    selectedForBatch,
    setSelectedForBatch,
  ] = useState<
    Set<string>
  >(new Set());

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    createAccountOpen,
    setCreateAccountOpen,
  ] = useState(false);

  const [
    importAccountsOpen,
    setImportAccountsOpen,
  ] = useState(false);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    globalError,
    setGlobalError,
  ] = useState("");

  const [
    actionMessage,
    setActionMessage,
  ] = useState("");

  const [
    brands,
    setBrands,
  ] = useState<BrandOption[]>([]);

  const [
    onboardingRunning,
    setOnboardingRunning,
  ] = useState(false);

  const [
    onboardingStep,
    setOnboardingStep,
  ] = useState<OnboardingStep>(
    "IDLE",
  );

  const [
    onboardingResult,
    setOnboardingResult,
  ] = useState<OnboardingResult | null>(
    null,
  );

  const [
    automationPolicy,
    setAutomationPolicy,
  ] = useState<AutomationPolicy | null>(
    null,
  );

  const [
    policyLoading,
    setPolicyLoading,
  ] = useState(false);

  const [
    policySaving,
    setPolicySaving,
  ] = useState(false);

  const [
    timeline,
    setTimeline,
  ] = useState<TimelineEvent[]>([]);

  const [
    timelineLoading,
    setTimelineLoading,
  ] = useState(false);

  const [
    editOpen,
    setEditOpen,
  ] = useState(false);

  const [
    editSaving,
    setEditSaving,
  ] = useState(false);

  const [
    editForm,
    setEditForm,
  ] = useState<EditAccountForm | null>(
    null,
  );

  const [
    viewerOpen,
    setViewerOpen,
  ] = useState(false);

  const [
    viewerKey,
    setViewerKey,
  ] = useState(0);

  const selectedAccount =
    accounts.find(
      (account) =>
        account.id ===
        selectedId,
    ) || null;

  const selectedRuntime =
    selectedId
      ? runtimes[selectedId] ||
        EMPTY_RUNTIME
      : EMPTY_RUNTIME;

  const filteredAccounts =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return accounts;
      }

      return accounts.filter(
        (account) =>
          [
            account.displayName,
            account.facebookUserName,
            account.browserProfileName,
            account.browserProfileKey,
            account.proxyCountry,
            account.lastKnownIp,
            account.loginStatus,
            account.cookieStatus,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(
                  query,
                ),
            ),
      );
    }, [
      accounts,
      search,
    ]);

  const updateRuntime =
    useCallback(
      (
        accountId: string,
        patch:
          Partial<AccountRuntime>,
      ) => {
        setRuntimes(
          (current) => ({
            ...current,
            [accountId]: {
              ...(current[
                accountId
              ] ||
                EMPTY_RUNTIME),
              ...patch,
            },
          }),
        );
      },
      [],
    );

  const loadRuntime =
    useCallback(
      async (
        accountId: string,
      ) => {
        updateRuntime(
          accountId,
          {
            loading: true,
            error: "",
          },
        );

        try {
          const response =
            await fetch(
              `${API_URL}/browser-runtime/accounts/${accountId}/browser/status`,
              {
                cache:
                  "no-store",
              },
            );

          const body =
            await readJson(
              response,
            );

          if (
            !response.ok
          ) {
            throw new Error(
              getErrorMessage(
                body,
                "Unable to load browser status.",
              ),
            );
          }

          const session =
            body.session &&
            typeof body.session ===
              "object"
              ? (body.session as BrowserSession)
              : null;

          updateRuntime(
            accountId,
            {
              loading: false,
              running:
                body.running ===
                true,
              session,
              error: "",
            },
          );
        } catch (error) {
          updateRuntime(
            accountId,
            {
              loading: false,
              error:
                error instanceof
                Error
                  ? error.message
                  : "Unable to load browser status.",
            },
          );
        }
      },
      [
        updateRuntime,
      ],
    );

  const loadBrands =
    useCallback(
      async () => {
        try {
          const response =
            await fetch(
              `${API_URL}/brands`,
              {
                cache:
                  "no-store",
              },
            );

          const body =
            await readJson(
              response,
            );

          if (!response.ok) {
            throw new Error(
              getErrorMessage(
                body,
                "Unable to load Brands.",
              ),
            );
          }

          const candidates =
            Array.isArray(
              body,
            )
              ? body
              : Array.isArray(
                    body.brands,
                  )
                ? body.brands
                : [];

          setBrands(
            candidates as BrandOption[],
          );
        } catch (error) {
          setGlobalError(
            error instanceof Error
              ? error.message
              : "Unable to load Brands.",
          );
        }
      },
      [],
    );

  const loadAccounts =
    useCallback(
      async () => {
        setLoading(true);
        setGlobalError("");

        try {
          const response =
            await fetch(
              `${API_URL}/browser-runtime/accounts`,
              {
                cache:
                  "no-store",
              },
            );

          const body =
            await readJson(
              response,
            );

          if (
            !response.ok
          ) {
            throw new Error(
              getErrorMessage(
                body,
                "Unable to load browser accounts.",
              ),
            );
          }

          const nextAccounts =
            (
              Array.isArray(
                body,
              )
                ? body
                : []
            ) as BrowserAccount[];

          setAccounts(
            nextAccounts,
          );

          setSelectedId(
            (current) => {
              const requested =
                requestedAccountId &&
                nextAccounts.some(
                  (account) =>
                    account.id ===
                    requestedAccountId,
                )
                  ? requestedAccountId
                  : null;

              const currentExists =
                current &&
                nextAccounts.some(
                  (account) =>
                    account.id ===
                    current,
                );

              return (
                requested ||
                (currentExists
                  ? current
                  : null) ||
                nextAccounts[0]
                  ?.id ||
                null
              );
            },
          );

          await Promise.all(
            nextAccounts.map(
              (account) =>
                loadRuntime(
                  account.id,
                ),
            ),
          );
        } catch (error) {
          setGlobalError(
            error instanceof
              Error
              ? error.message
              : "Unable to load browser accounts.",
          );
        } finally {
          setLoading(false);
        }
      },
      [
        loadRuntime,
        requestedAccountId,
      ],
    );

  useEffect(() => {
    void Promise.all([
      loadAccounts(),
      loadBrands(),
    ]);
  }, [
    loadAccounts,
    loadBrands,
  ]);

  useEffect(() => {
    if (!selectedId) {
      setAutomationPolicy(
        null,
      );
      setTimeline([]);
      return;
    }

    void Promise.all([
      loadAutomationPolicy(
        selectedId,
      ),
      loadTimeline(
        selectedId,
      ),
    ]);
  }, [
    selectedId,
  ]);

  function openEdit(
    account: BrowserAccount,
  ) {
    setEditForm({
      displayName:
        account.displayName,
      browserProfileName:
        account.browserProfileName,
      brandId:
        account.brandId || "",
      locale:
        account.locale,
      timezone:
        account.timezone,
      proxyType:
        account.proxyType,
      proxyHost:
        account.proxyHost || "",
      proxyPort:
        account.proxyPort
          ? String(
              account.proxyPort,
            )
          : "",
      proxyUsername: "",
      proxyPassword: "",
      proxyCountry:
        account.proxyCountry || "",
      clearProxyCredentials:
        false,
    });

    setEditOpen(true);
    setGlobalError("");
  }

  function updateEditField<
    Key extends keyof EditAccountForm,
  >(
    key: Key,
    value: EditAccountForm[Key],
  ) {
    setEditForm(
      (current) =>
        current
          ? {
              ...current,
              [key]: value,
            }
          : current,
    );
  }

  async function saveEdit() {
    if (
      !selectedAccount ||
      !editForm
    ) {
      return;
    }

    if (
      selectedRuntime.running
    ) {
      setGlobalError(
        "Close the browser before changing its profile or proxy settings.",
      );
      return;
    }

    setEditSaving(true);
    setGlobalError("");

    try {
      const proxyPort =
        editForm.proxyType ===
        "DIRECT"
          ? null
          : Number(
              editForm.proxyPort,
            );

      const response =
        await fetch(
          `${API_URL}/browser-runtime/accounts/${selectedAccount.id}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              displayName:
                editForm.displayName,
              browserProfileName:
                editForm.browserProfileName,
              brandId:
                editForm.brandId ||
                null,
              locale:
                editForm.locale,
              timezone:
                editForm.timezone,
              proxyType:
                editForm.proxyType,
              proxyHost:
                editForm.proxyType ===
                "DIRECT"
                  ? null
                  : editForm.proxyHost,
              proxyPort,
              proxyUsername:
                editForm.proxyUsername ||
                undefined,
              proxyPassword:
                editForm.proxyPassword ||
                undefined,
              proxyCountry:
                editForm.proxyType ===
                "DIRECT"
                  ? null
                  : editForm.proxyCountry,
              clearProxyCredentials:
                editForm.clearProxyCredentials,
            }),
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            body,
            "Unable to update browser account.",
          ),
        );
      }

      setEditOpen(false);
      setEditForm(null);

      await loadAccounts();

      setActionMessage(
        "Browser account updated.",
      );
    } catch (error) {
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to update browser account.",
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function loadAutomationPolicy(
    accountId: string,
  ) {
    setPolicyLoading(true);

    try {
      const response =
        await fetch(
          `${API_URL}/browser-runtime/accounts/${accountId}/automation-policy`,
          {
            cache:
              "no-store",
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            body,
            "Unable to load automation policy.",
          ),
        );
      }

      setAutomationPolicy(
        body as unknown as
          AutomationPolicy,
      );
    } catch (error) {
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to load automation policy.",
      );
    } finally {
      setPolicyLoading(false);
    }
  }

  async function loadTimeline(
    accountId: string,
  ) {
    setTimelineLoading(true);

    try {
      const response =
        await fetch(
          `${API_URL}/browser-runtime/accounts/${accountId}/timeline`,
          {
            cache:
              "no-store",
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            body,
            "Unable to load timeline.",
          ),
        );
      }

      setTimeline(
        Array.isArray(
          body,
        )
          ? body as unknown as
              TimelineEvent[]
          : [],
      );
    } catch (error) {
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to load timeline.",
      );
    } finally {
      setTimelineLoading(false);
    }
  }

  async function updateAutomationPolicy(
    patch:
      Partial<AutomationPolicy>,
  ) {
    if (
      !selectedAccount ||
      !automationPolicy
    ) {
      return;
    }

    const previous =
      automationPolicy;

    const next = {
      ...previous,
      ...patch,
    };

    setAutomationPolicy(
      next,
    );
    setPolicySaving(true);
    setGlobalError("");

    try {
      const response =
        await fetch(
          `${API_URL}/browser-runtime/accounts/${selectedAccount.id}/automation-policy`,
          {
            method:
              "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                patch,
              ),
          },
        );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            body,
            "Unable to update automation policy.",
          ),
        );
      }

      setAutomationPolicy(
        body as unknown as
          AutomationPolicy,
      );

      setActionMessage(
        "Automation policy updated.",
      );
    } catch (error) {
      setAutomationPolicy(
        previous,
      );

      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to update automation policy.",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  function timelineStatusClass(
    status: string,
  ) {
    const normalized =
      status
        .trim()
        .toUpperCase();

    if (
      normalized ===
      "SUCCESS"
    ) {
      return styles.timelineSuccess;
    }

    if (
      normalized ===
      "WARNING"
    ) {
      return styles.timelineWarning;
    }

    if (
      normalized ===
      "FAILED"
    ) {
      return styles.timelineFailed;
    }

    return styles.timelineInfo;
  }

  async function runOnboarding(
    accountId: string,
  ) {
    setOnboardingRunning(true);
    setOnboardingStep(
      "VERIFYING",
    );
    setOnboardingResult(
      null,
    );
    setGlobalError("");
    setActionMessage("");

    try {
      const progressTimer =
        window.setTimeout(
          () => {
            setOnboardingStep(
              "DISCOVERING",
            );
          },
          1400,
        );

      const syncTimer =
        window.setTimeout(
          () => {
            setOnboardingStep(
              "SYNCING",
            );
          },
          3200,
        );

      const response =
        await fetch(
          `${API_URL}/browser-runtime/accounts/${accountId}/onboarding/run`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                verifyLogin:
                  true,
              }),
          },
        );

      window.clearTimeout(
        progressTimer,
      );
      window.clearTimeout(
        syncTimer,
      );

      const body =
        await readJson(
          response,
        );

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            body,
            "Unable to complete onboarding.",
          ),
        );
      }

      const result =
        body as OnboardingResult;

      setOnboardingResult(
        result,
      );

      if (
        result.requiresAttention
      ) {
        setOnboardingStep(
          "ATTENTION",
        );

        const attentionMessage =
          result.step ===
          "SELECT_BRAND"
            ? "Select a Brand for this account, then run onboarding again."
            : `Onboarding requires attention at ${result.step || "UNKNOWN"}.`;

        setActionMessage(
          attentionMessage,
        );
      } else if (
        result.completed
      ) {
        setOnboardingStep(
          "COMPLETED",
        );

        const created =
          result.syncResult
            ?.created ||
          0;

        const reused =
          result.syncResult
            ?.reused ||
          0;

        const linked =
          result.syncResult
            ?.linked ||
          0;

        setActionMessage(
          [
            "Onboarding completed.",
            `${result.pagesDiscovered || 0} Page(s) discovered.`,
            `${created} created.`,
            `${reused} reused.`,
            `${linked} linked.`,
          ].join(" "),
        );
      } else {
        setOnboardingStep(
          "ATTENTION",
        );

        setActionMessage(
          "Onboarding paused before completion.",
        );
      }

      await Promise.all([
        loadAccounts(),
        loadRuntime(
          accountId,
        ),
        loadTimeline(
          accountId,
        ),
        loadAutomationPolicy(
          accountId,
        ),
      ]);
    } catch (error) {
      setOnboardingStep(
        "FAILED",
      );

      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to complete onboarding.",
      );
    } finally {
      setOnboardingRunning(
        false,
      );
    }
  }

  function onboardingStepLabel(
    step: OnboardingStep,
  ) {
    return step.replaceAll(
      "_",
      " ",
    );
  }

  async function openBrowser(
    accountId: string,
  ) {
    setActionMessage("");
    updateRuntime(
      accountId,
      {
        loading: true,
        error: "",
      },
    );

    const response =
      await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/browser/open`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            headless: false,
            startUrl:
              "https://www.facebook.com/",
          }),
        },
      );

    const body =
      await readJson(
        response,
      );

    if (!response.ok) {
      updateRuntime(
        accountId,
        {
          loading: false,
          error:
            getErrorMessage(
              body,
              "Unable to open browser.",
            ),
        },
      );

      throw new Error(
        getErrorMessage(
          body,
          "Unable to open browser.",
        ),
      );
    }

    await Promise.all([
      loadRuntime(
        accountId,
      ),
      loadAccounts(),
    ]);

    setActionMessage(
      "Browser profile opened.",
    );

    setViewerOpen(true);
    setViewerKey(
      (current) =>
        current + 1,
    );
  }

  async function verifyLogin(
    accountId: string,
  ) {
    setActionMessage("");

    updateRuntime(
      accountId,
      {
        loading: true,
        error: "",
      },
    );

    const response =
      await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/browser/inspect`,
        {
          method: "POST",
        },
      );

    const body =
      await readJson(
        response,
      );

    if (!response.ok) {
      updateRuntime(
        accountId,
        {
          loading: false,
          error:
            getErrorMessage(
              body,
              "Unable to verify login.",
            ),
        },
      );

      throw new Error(
        getErrorMessage(
          body,
          "Unable to verify login.",
        ),
      );
    }

    const result =
      body as InspectionResult;

    await Promise.all([
      loadAccounts(),
      loadRuntime(
        accountId,
      ),
      loadTimeline(
        accountId,
      ),
      loadAutomationPolicy(
        accountId,
      ),
    ]);

    const status =
      readableStatus(
        result.loginStatus,
      );

    setActionMessage(
      `Login verification: ${status}.`,
    );
  }

  async function closeBrowser(
    accountId: string,
  ) {
    setActionMessage("");

    updateRuntime(
      accountId,
      {
        loading: true,
        error: "",
      },
    );

    const response =
      await fetch(
        `${API_URL}/browser-runtime/accounts/${accountId}/browser/close`,
        {
          method: "POST",
        },
      );

    const body =
      await readJson(
        response,
      );

    if (!response.ok) {
      updateRuntime(
        accountId,
        {
          loading: false,
          error:
            getErrorMessage(
              body,
              "Unable to close browser.",
            ),
        },
      );

      throw new Error(
        getErrorMessage(
          body,
          "Unable to close browser.",
        ),
      );
    }

    await Promise.all([
      loadRuntime(
        accountId,
      ),
      loadAccounts(),
    ]);

    setViewerOpen(false);

    setActionMessage(
      "Browser profile closed. Cookies remain stored in the profile.",
    );
  }

  function toggleBatch(
    accountId: string,
  ) {
    setSelectedForBatch(
      (current) => {
        const next =
          new Set(
            current,
          );

        if (
          next.has(
            accountId,
          )
        ) {
          next.delete(
            accountId,
          );
        } else {
          next.add(
            accountId,
          );
        }

        return next;
      },
    );
  }

  function toggleAllVisible() {
    const visibleIds =
      filteredAccounts.map(
        (account) =>
          account.id,
      );

    const allSelected =
      visibleIds.length >
        0 &&
      visibleIds.every(
        (id) =>
          selectedForBatch.has(
            id,
          ),
      );

    setSelectedForBatch(
      (current) => {
        const next =
          new Set(
            current,
          );

        for (
          const id
          of visibleIds
        ) {
          if (allSelected) {
            next.delete(id);
          } else {
            next.add(id);
          }
        }

        return next;
      },
    );
  }

  async function verifySelected() {
    const selected =
      accounts.filter(
        (account) =>
          selectedForBatch.has(
            account.id,
          ),
      );

    if (
      !selected.length
    ) {
      return;
    }

    setGlobalError("");
    setActionMessage(
      `Verifying ${selected.length} account(s)…`,
    );

    for (
      const account
      of selected
    ) {
      try {
        await verifyLogin(
          account.id,
        );
      } catch (error) {
        setGlobalError(
          error instanceof
            Error
            ? error.message
            : "Batch verification failed.",
        );
        break;
      }
    }

    setActionMessage(
      "Batch verification completed.",
    );
  }

  const accountStats =
    useMemo(
      () => {
        const loggedIn =
          accounts.filter(
            (account) =>
              normalizeStatus(
                account.loginStatus,
              ) ===
              "LOGGED_IN",
          ).length;

        const loginRequired =
          accounts.filter(
            (account) =>
              [
                "LOGIN_REQUIRED",
                "TWO_FACTOR_REQUIRED",
                "CHECKPOINT_REQUIRED",
              ].includes(
                normalizeStatus(
                  account.loginStatus,
                ),
              ),
          ).length;

        const running =
          accounts.filter(
            (account) =>
              Boolean(
                runtimes[
                  account.id
                ]?.running,
              ),
          ).length;

        const proxyAttention =
          accounts.filter(
            (account) =>
              account.proxyType !==
                "DIRECT" &&
              (
                !account.proxyHost ||
                !account.proxyPort ||
                !account.lastKnownIp
              ),
          ).length;

        return {
          total:
            accounts.length,
          loggedIn,
          loginRequired,
          running,
          proxyAttention,
        };
      },
      [
        accounts,
        runtimes,
      ],
    );

  function scrollToDetailSection(
    section: string,
  ) {
    const accountId =
      selectedAccount?.id;

    if (!accountId) {
      return;
    }

    document
      .getElementById(
        `browser-account-${accountId}-${section}`,
      )
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>
            Browser Management Center
          </p>

          <h1>
            Browser Accounts
          </h1>

          <p className={styles.subtitle}>
            Manage independent Facebook
            profiles, cookies, proxies,
            login sessions and automation
            from one control center.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() =>
              setCreateAccountOpen(
                true,
              )
            }
          >
            + Add Account
          </button>

          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() =>
              setImportAccountsOpen(
                true,
              )
            }
          >
            Import Excel
          </button>

          <a
            className={styles.secondaryButton}
            href="/automation/browser-pool"
          >
            Browser Pool
          </a>

          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() =>
              void loadAccounts()
            }
          >
            {loading
              ? "Refreshing…"
              : "Refresh"}
          </button>
        </div>
      </header>

      <section className={styles.accountStats}>
        <article>
          <span>
            Total Accounts
          </span>

          <strong>
            {accountStats.total}
          </strong>

          <small>
            Independent profiles
          </small>
        </article>

        <article>
          <span>
            Logged In
          </span>

          <strong>
            {accountStats.loggedIn}
          </strong>

          <small>
            Facebook sessions ready
          </small>
        </article>

        <article>
          <span>
            Login Required
          </span>

          <strong>
            {accountStats.loginRequired}
          </strong>

          <small>
            Accounts needing attention
          </small>
        </article>

        <article>
          <span>
            Running
          </span>

          <strong>
            {accountStats.running}
          </strong>

          <small>
            Live browser sessions
          </small>
        </article>

        <article>
          <span>
            Proxy Attention
          </span>

          <strong>
            {accountStats.proxyAttention}
          </strong>

          <small>
            IP or proxy not verified
          </small>
        </article>
      </section>

      {globalError ? (
        <div className={styles.error}>
          {globalError}
        </div>
      ) : null}

      {actionMessage ? (
        <div className={styles.success}>
          {actionMessage}
        </div>
      ) : null}

      <section className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span
            aria-hidden="true"
            className={styles.searchIcon}
          >
            ⌕
          </span>

          <input
            className={styles.search}
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value,
            )
          }
            placeholder="Search account, profile, IP or status…"
          />
        </div>

        <div className={styles.toolbarActions}>
          <span className={styles.selectionCount}>
            {
              selectedForBatch.size
            } selected
          </span>

          <button
            className={styles.primaryButton}
            type="button"
            disabled={
              selectedForBatch.size ===
              0
            }
            onClick={() =>
              void verifySelected()
            }
          >
            Verify Selected Accounts
          </button>
        </div>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkboxCell}>
                  <input
                    type="checkbox"
                    checked={
                      filteredAccounts.length >
                        0 &&
                      filteredAccounts.every(
                        (account) =>
                          selectedForBatch.has(
                            account.id,
                          ),
                      )
                    }
                    onChange={
                      toggleAllVisible
                    }
                  />
                </th>

                <th>Account</th>
                <th>Login</th>
                <th>Cookie</th>
                <th>Proxy</th>
                <th>Browser</th>
                <th>IP</th>
                <th>Last verified</th>
                <th className={styles.quickActionHeader}>
                  Quick Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    className={styles.emptyCell}
                    colSpan={9}
                  >
                    Loading browser accounts…
                  </td>
                </tr>
              ) : null}

              {!loading &&
              !filteredAccounts.length ? (
                <tr>
                  <td
                    className={styles.emptyCell}
                    colSpan={9}
                  >
                    No independent browser accounts found.
                  </td>
                </tr>
              ) : null}

              {filteredAccounts.map(
                (account) => {
                  const runtime =
                    runtimes[
                      account.id
                    ] ||
                    EMPTY_RUNTIME;

                  const selected =
                    selectedId ===
                    account.id;

                  return (
                    <tr
                      className={
                        selected
                          ? styles.selectedRow
                          : undefined
                      }
                      key={account.id}
                      onClick={() =>
                        setSelectedId(
                          account.id,
                        )
                      }
                    >
                      <td
                        className={
                          styles.checkboxCell
                        }
                        onClick={(
                          event,
                        ) =>
                          event.stopPropagation()
                        }
                      >
                        <input
                          type="checkbox"
                          checked={selectedForBatch.has(
                            account.id,
                          )}
                          onChange={() =>
                            toggleBatch(
                              account.id,
                            )
                          }
                        />
                      </td>

                      <td>
                        <div className={styles.accountIdentity}>
                          <span
                            aria-hidden="true"
                            className={styles.accountAvatar}
                          >
                            {account.displayName
                              .trim()
                              .slice(0, 1)
                              .toUpperCase() ||
                              "B"}
                          </span>

                          <div>
                            <strong>
                              {account.displayName}
                            </strong>

                            <small>
                              {
                                account.browserProfileName
                              }
                            </small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span
                          className={[
                            styles.status,
                            loginStatusClass(
                              account.loginStatus,
                            ),
                          ].join(" ")}
                        >
                          {readableStatus(
                            account.loginStatus,
                          )}
                        </span>
                      </td>

                      <td>
                        <span
                          className={[
                            styles.status,
                            account.cookieStatus ===
                            "ACTIVE"
                              ? styles.good
                              : styles.neutral,
                          ].join(" ")}
                        >
                          {readableStatus(
                            account.cookieStatus,
                          )}
                        </span>
                      </td>

                      <td>
                        <strong>
                          {
                            account.proxyType
                          }
                        </strong>

                        <small>
                          {account.proxyCountry ||
                            "—"}
                        </small>
                      </td>

                      <td>
                        <span
                          className={[
                            styles.status,
                            runtime.running
                              ? styles.good
                              : styles.neutral,
                          ].join(" ")}
                        >
                          {runtime.loading
                            ? "CHECKING"
                            : runtime.running
                              ? "RUNNING"
                              : "STOPPED"}
                        </span>
                      </td>

                      <td>
                        {account.lastKnownIp ||
                          "—"}
                      </td>

                      <td>
                        {formatDate(
                          account.lastVerifiedAt,
                        )}
                      </td>
                    
                      <td
                        className={styles.quickActionCell}
                        onClick={(event) =>
                          event.stopPropagation()
                        }
                      >
                        <div className={styles.rowActions}>
                          <button
                            className={styles.rowActionPrimary}
                            type="button"
                            disabled={runtime.loading}
                            onClick={() => {
                              setSelectedId(
                                account.id,
                              );

                              if (
                                runtime.running
                              ) {
                                setViewerOpen(
                                  true,
                                );
                                return;
                              }

                              void openBrowser(
                                account.id,
                              ).catch(
                                (error) =>
                                  setGlobalError(
                                    error instanceof
                                      Error
                                      ? error.message
                                      : "Unable to open browser.",
                                  ),
                              );
                            }}
                          >
                            {runtime.running
                              ? "View"
                              : "Open"}
                          </button>

                          <button
                            type="button"
                            disabled={runtime.loading}
                            onClick={() => {
                              setSelectedId(
                                account.id,
                              );

                              void verifyLogin(
                                account.id,
                              ).catch(
                                (error) =>
                                  setGlobalError(
                                    error instanceof
                                      Error
                                      ? error.message
                                      : "Unable to verify login.",
                                  ),
                              );
                            }}
                          >
                            Verify
                          </button>

                          <button
                            type="button"
                            disabled={runtime.loading}
                            onClick={() => {
                              setSelectedId(
                                account.id,
                              );

                              openEdit(
                                account,
                              );
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
</tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.detailsPanel}>
        {!selectedAccount ? (
          <div className={styles.emptyDetails}>
            Select an account to view details.
          </div>
        ) : (
          <>
            <nav
              aria-label="Browser account detail sections"
              className={styles.detailNavigation}
            >
              {[
                ["overview", "Overview"],
                ["automation", "Automation"],
                ["timeline", "Timeline"],
                ["onboarding", "Onboarding"],
                ["actions", "Actions"],
              ].map(
                ([section, label]) => (
                  <button
                    key={section}
                    type="button"
                    onClick={() =>
                      scrollToDetailSection(
                        section,
                      )
                    }
                  >
                    {label}
                  </button>
                ),
              )}
            </nav>

            <div
              className={styles.detailsHeader}
              id={`browser-account-${selectedAccount.id}-overview`}
            >
              <div>
                <p className={styles.eyebrow}>
                  Account Details
                </p>

                <h2>
                  {
                    selectedAccount.displayName
                  }
                </h2>

                <p>
                  {
                    selectedAccount.browserProfileKey
                  }
                </p>
              </div>

              <span
                className={[
                  styles.largeStatus,
                  loginStatusClass(
                    selectedAccount.loginStatus,
                  ),
                ].join(" ")}
              >
                {readableStatus(
                  selectedAccount.loginStatus,
                )}
              </span>
            </div>

            {selectedRuntime.error ? (
              <div className={styles.error}>
                {
                  selectedRuntime.error
                }
              </div>
            ) : null}

            <div className={styles.metrics}>
              <article>
                <span>
                  Browser
                </span>
                <strong>
                  {selectedRuntime.running
                    ? "RUNNING"
                    : "STOPPED"}
                </strong>
              </article>

              <article>
                <span>
                  Cookie
                </span>
                <strong>
                  {readableStatus(
                    selectedAccount.cookieStatus,
                  )}
                </strong>
              </article>

              <article>
                <span>
                  Proxy
                </span>
                <strong>
                  {
                    selectedAccount.proxyType
                  }
                </strong>
              </article>

              <article>
                <span>
                  Pages
                </span>
                <strong>
                  {
                    selectedAccount.channels
                      .length
                  }
                </strong>
              </article>
            </div>

            <dl className={styles.definitionList}>
              <div>
                <dt>
                  Brand
                </dt>
                <dd>
                  {brands.find(
                    (brand) =>
                      brand.id ===
                      selectedAccount.brandId,
                  )?.name ||
                    "Not selected"}
                </dd>
              </div>

              <div>
                <dt>
                  Profile name
                </dt>
                <dd>
                  {
                    selectedAccount.browserProfileName
                  }
                </dd>
              </div>

              <div>
                <dt>
                  Current URL
                </dt>
                <dd>
                  {selectedRuntime.session
                    ?.currentUrl ||
                    "—"}
                </dd>
              </div>

              <div>
                <dt>
                  Profile directory
                </dt>
                <dd>
                  {selectedRuntime.session
                    ?.profileDirectory ||
                    "Created when opened"}
                </dd>
              </div>

              <div>
                <dt>
                  Locale / Timezone
                </dt>
                <dd>
                  {
                    selectedAccount.locale
                  }{" "}
                  /{" "}
                  {
                    selectedAccount.timezone
                  }
                </dd>
              </div>

              <div>
                <dt>
                  Last login
                </dt>
                <dd>
                  {formatDate(
                    selectedAccount.lastLoginAt,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  Last verified
                </dt>
                <dd>
                  {formatDate(
                    selectedAccount.lastVerifiedAt,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  Last heartbeat
                </dt>
                <dd>
                  {formatDate(
                    selectedAccount.lastHeartbeatAt,
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  Last error
                </dt>
                <dd>
                  {selectedAccount.lastLoginError ||
                    "—"}
                </dd>
              </div>
            </dl>

            <section className={styles.accountSection}
              id={`browser-account-${selectedAccount.id}-automation`}
            >
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>
                    Automation
                  </p>

                  <h3>
                    Automation Policy
                  </h3>
                </div>

                <span className={styles.saveStatus}>
                  {policySaving
                    ? "Saving…"
                    : policyLoading
                      ? "Loading…"
                      : "Saved"}
                </span>
              </div>

              {!automationPolicy ? (
                <div className={styles.sectionEmpty}>
                  Loading automation policy…
                </div>
              ) : (
                <div className={styles.policyGrid}>
                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={
                        automationPolicy.autoVerifyLogin
                      }
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoVerifyLogin:
                            event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>
                        Auto Verify Login
                      </strong>

                      <small>
                        Automatically verify the current Facebook session.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={
                        automationPolicy.autoDiscoverPages
                      }
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoDiscoverPages:
                            event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>
                        Auto Discover Pages
                      </strong>

                      <small>
                        Discover Facebook Pages after login verification.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={
                        automationPolicy.autoSyncPages
                      }
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoSyncPages:
                            event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>
                        Auto Sync Pages
                      </strong>

                      <small>
                        Sync discovered Pages into Connected Platforms.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={
                        automationPolicy.autoHealthCheck
                      }
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoHealthCheck:
                            event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>
                        Auto Health Check
                      </strong>

                      <small>
                        Monitor browser, cookie, proxy and session health.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={
                        automationPolicy.autoNotifications
                      }
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoNotifications:
                            event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>
                        Auto Notifications
                      </strong>

                      <small>
                        Notify when login, sync or health checks fail.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={
                        automationPolicy.autoCloseBrowser
                      }
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoCloseBrowser:
                            event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>
                        Auto Close Browser
                      </strong>

                      <small>
                        Close the browser after onboarding completes.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={
                        automationPolicy.keepBrowserOpenAfterLogin
                      }
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          keepBrowserOpenAfterLogin:
                            event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>
                        Keep Browser Open
                      </strong>

                      <small>
                        Keep the live browser available after login.
                      </small>
                    </span>
                  </label>
                </div>
              )}
            </section>

            <section className={styles.accountSection}
              id={`browser-account-${selectedAccount.id}-timeline`}
            >
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>
                    Activity
                  </p>

                  <h3>
                    Timeline
                  </h3>
                </div>

                <button
                  className={styles.secondaryButton}
                  type="button"
                  disabled={timelineLoading}
                  onClick={() =>
                    void loadTimeline(
                      selectedAccount.id,
                    )
                  }
                >
                  {timelineLoading
                    ? "Refreshing…"
                    : "Refresh Timeline"}
                </button>
              </div>

              {timelineLoading &&
              !timeline.length ? (
                <div className={styles.sectionEmpty}>
                  Loading timeline…
                </div>
              ) : null}

              {!timelineLoading &&
              !timeline.length ? (
                <div className={styles.sectionEmpty}>
                  No browser activity recorded yet.
                </div>
              ) : null}

              <div className={styles.timeline}>
                {timeline.map(
                  (event) => (
                    <article
                      className={styles.timelineItem}
                      key={event.id}
                    >
                      <span
                        className={[
                          styles.timelineDot,
                          timelineStatusClass(
                            event.status,
                          ),
                        ].join(" ")}
                      />

                      <div className={styles.timelineContent}>
                        <div className={styles.timelineTitle}>
                          <strong>
                            {event.title}
                          </strong>

                          <time>
                            {formatDate(
                              event.createdAt,
                            )}
                          </time>
                        </div>

                        {event.message ? (
                          <p>
                            {event.message}
                          </p>
                        ) : null}

                        <small>
                          {readableStatus(
                            event.eventType,
                          )}
                        </small>
                      </div>
                    </article>
                  ),
                )}
              </div>
            </section>

            <section
              className={styles.onboardingPanel}
              id={`browser-account-${selectedAccount.id}-onboarding`}
            >
              <div className={styles.onboardingHeader}>
                <div>
                  <p className={styles.eyebrow}>
                    Guided Setup
                  </p>

                  <h3>
                    Complete Onboarding
                  </h3>

                  <p>
                    Verify login, discover Pages,
                    sync Connected Platforms and
                    refresh account health.
                  </p>
                </div>

                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={
                    onboardingRunning ||
                    selectedRuntime.loading
                  }
                  onClick={() =>
                    void runOnboarding(
                      selectedAccount.id,
                    )
                  }
                >
                  {onboardingRunning
                    ? "Running…"
                    : "Complete Onboarding"}
                </button>
              </div>

              <div className={styles.onboardingSteps}>
                {[
                  "VERIFYING",
                  "DISCOVERING",
                  "SYNCING",
                  "COMPLETED",
                ].map(
                  (step) => {
                    const order = [
                      "VERIFYING",
                      "DISCOVERING",
                      "SYNCING",
                      "COMPLETED",
                    ];

                    const currentIndex =
                      order.indexOf(
                        onboardingStep,
                      );

                    const stepIndex =
                      order.indexOf(
                        step,
                      );

                    const active =
                      onboardingStep ===
                      step;

                    const done =
                      currentIndex >
                      stepIndex ||
                      onboardingStep ===
                      "COMPLETED";

                    return (
                      <div
                        className={[
                          styles.onboardingStep,
                          active
                            ? styles.onboardingStepActive
                            : "",
                          done
                            ? styles.onboardingStepDone
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={step}
                      >
                        <span>
                          {done
                            ? "✓"
                            : stepIndex + 1}
                        </span>

                        <strong>
                          {onboardingStepLabel(
                            step as OnboardingStep,
                          )}
                        </strong>
                      </div>
                    );
                  },
                )}
              </div>

              {onboardingStep ===
              "ATTENTION" ? (
                <div className={styles.warningMessage}>
                  <span>
                    Onboarding needs attention:
                    {" "}
                    {
                      onboardingResult
                        ?.step ||
                      "UNKNOWN"
                    }
                  </span>

                  {onboardingResult
                    ?.step ===
                  "SELECT_BRAND" ? (
                    <button
                      className={
                        styles.secondaryButton
                      }
                      type="button"
                      onClick={() =>
                        openEdit(
                          selectedAccount,
                        )
                      }
                    >
                      Select Brand
                    </button>
                  ) : null}
                </div>
              ) : null}

              {onboardingStep ===
              "FAILED" ? (
                <div className={styles.error}>
                  Automatic onboarding failed.
                </div>
              ) : null}
            </section>

            <div
              className={styles.actions}
              id={`browser-account-${selectedAccount.id}-actions`}
            >
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={
                  selectedRuntime.loading
                }
                onClick={() =>
                  openEdit(
                    selectedAccount,
                  )
                }
              >
                Edit Account
              </button>

              <button
                className={styles.primaryButton}
                type="button"
                disabled={
                  selectedRuntime.loading
                }
                onClick={() =>
                  void openBrowser(
                    selectedAccount.id,
                  ).catch(
                    (error) =>
                      setGlobalError(
                        error instanceof
                          Error
                          ? error.message
                          : "Unable to open browser.",
                      ),
                  )
                }
              >
                Open Browser
              </button>

              <button
                className={styles.secondaryButton}
                type="button"
                disabled={
                  selectedRuntime.loading
                }
                onClick={() =>
                  void verifyLogin(
                    selectedAccount.id,
                  ).catch(
                    (error) =>
                      setGlobalError(
                        error instanceof
                          Error
                          ? error.message
                          : "Unable to verify login.",
                      ),
                  )
                }
              >
                Verify Login
              </button>

              <button
                className={styles.dangerButton}
                type="button"
                disabled={
                  selectedRuntime.loading ||
                  !selectedRuntime.running
                }
                onClick={() =>
                  void closeBrowser(
                    selectedAccount.id,
                  ).catch(
                    (error) =>
                      setGlobalError(
                        error instanceof
                          Error
                          ? error.message
                          : "Unable to close browser.",
                      ),
                  )
                }
              >
                Close Browser
              </button>
            </div>
          </>
        )}
      </section>

      {viewerOpen &&
      selectedAccount ? (
        <section className={styles.viewerPanel}>
          <div className={styles.viewerHeader}>
            <div>
              <p className={styles.eyebrow}>
                Live Browser
              </p>

              <h2>
                {selectedAccount.displayName}
              </h2>

              <p>
                {
                  selectedRuntime.session
                    ?.currentUrl ||
                  "Remote Chromium session"
                }
              </p>
            </div>

            <div className={styles.viewerActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() =>
                  setViewerKey(
                    (current) =>
                      current + 1,
                  )
                }
              >
                Reload Viewer
              </button>

              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => {
                  const popup =
                    window.open(
                      NOVNC_URL,
                      "_blank",
                    );

                  if (popup) {
                    popup.opener =
                      null;
                  }
                }}
              >
                Open in New Tab
              </button>

              <button
                className={styles.dangerButton}
                type="button"
                onClick={() =>
                  setViewerOpen(
                    false,
                  )
                }
              >
                Hide Viewer
              </button>
            </div>
          </div>

          <div className={styles.viewerFrameWrap}>
            <iframe
              className={styles.viewerFrame}
              key={viewerKey}
              src={NOVNC_URL}
              title={`${selectedAccount.displayName} browser viewer`}
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          </div>
        </section>
      ) : null}
      {createAccountOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setCreateAccountOpen(
                false,
              );
            }
          }}
        >
          <section
            aria-label="Add browser account"
            aria-modal="true"
            className={styles.entryModal}
            role="dialog"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>
                  Browser Account V2
                </p>

                <h2>
                  Add Account
                </h2>

                <p>
                  Create one independent Facebook
                  browser identity with its own
                  profile, cookie storage and proxy.
                </p>
              </div>

              <button
                aria-label="Close add account dialog"
                className={styles.iconButton}
                type="button"
                onClick={() =>
                  setCreateAccountOpen(
                    false,
                  )
                }
              >
                ×
              </button>
            </div>

            <div className={styles.entryOptions}>
              <article>
                <span className={styles.entryIcon}>
                  +
                </span>

                <div>
                  <strong>
                    Create Manually
                  </strong>

                  <p>
                    Enter account name, browser
                    profile, locale, timezone and
                    proxy settings.
                  </p>
                </div>

                <a
                  className={styles.primaryButton}
                  href="/automation/browser-accounts/new"
                >
                  Continue
                </a>
              </article>

              <article>
                <span className={styles.entryIcon}>
                  ⇩
                </span>

                <div>
                  <strong>
                    Import from Excel
                  </strong>

                  <p>
                    Create multiple independent
                    Browser Accounts from one
                    spreadsheet.
                  </p>
                </div>

                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => {
                    setCreateAccountOpen(
                      false,
                    );
                    setImportAccountsOpen(
                      true,
                    );
                  }}
                >
                  Import Accounts
                </button>
              </article>
            </div>
          </section>
        </div>
      ) : null}

      {importAccountsOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setImportAccountsOpen(
                false,
              );
            }
          }}
        >
          <section
            aria-label="Import browser accounts"
            aria-modal="true"
            className={styles.entryModal}
            role="dialog"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>
                  Bulk Account Setup
                </p>

                <h2>
                  Import Excel
                </h2>

                <p>
                  This V2 importer creates
                  BrowserAccount records directly.
                  It does not write into legacy
                  Channel Runtime Profiles.
                </p>
              </div>

              <button
                aria-label="Close import dialog"
                className={styles.iconButton}
                type="button"
                onClick={() =>
                  setImportAccountsOpen(
                    false,
                  )
                }
              >
                ×
              </button>
            </div>

            <div className={styles.importNotice}>
              <strong>
                Excel columns
              </strong>

              <code>
                displayName, browserProfileName,
                locale, timezone, proxyType,
                proxyHost, proxyPort,
                proxyUsername, proxyPassword,
                proxyCountry
              </code>

              <p>
                The V2 upload parser will be
                connected in the next step.
                Legacy Bulk Login remains disabled
                here to prevent duplicate browser
                identities.
              </p>
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() =>
                  setImportAccountsOpen(
                    false,
                  )
                }
              >
                Close
              </button>

              <button
                className={styles.primaryButton}
                type="button"
                disabled
              >
                Upload Excel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editOpen &&
      editForm &&
      selectedAccount ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setEditOpen(false);
            }
          }}
        >
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Edit browser account"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>
                  Browser Profile
                </p>

                <h2>
                  Edit Account
                </h2>

                <p>
                  {
                    selectedAccount.browserProfileKey
                  }
                </p>
              </div>

              <button
                className={styles.iconButton}
                type="button"
                aria-label="Close edit dialog"
                onClick={() =>
                  setEditOpen(
                    false,
                  )
                }
              >
                ×
              </button>
            </div>

            {selectedRuntime.running ? (
              <div className={styles.warningMessage}>
                Close this browser before changing
                profile or proxy settings.
              </div>
            ) : null}

            <div className={styles.formGrid}>
              <label>
                <span>
                  Account name
                </span>

                <input
                  value={
                    editForm.displayName
                  }
                  onChange={(event) =>
                    updateEditField(
                      "displayName",
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Browser profile name
                </span>

                <input
                  value={
                    editForm.browserProfileName
                  }
                  onChange={(event) =>
                    updateEditField(
                      "browserProfileName",
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Brand
                </span>

                <select
                  value={
                    editForm.brandId
                  }
                  onChange={(event) =>
                    updateEditField(
                      "brandId",
                      event.target.value,
                    )
                  }
                >
                  <option value="">
                    Select Brand
                  </option>

                  {brands.map(
                    (brand) => (
                      <option
                        key={brand.id}
                        value={brand.id}
                      >
                        {brand.name}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label>
                <span>
                  Locale
                </span>

                <input
                  value={
                    editForm.locale
                  }
                  onChange={(event) =>
                    updateEditField(
                      "locale",
                      event.target.value,
                    )
                  }
                  placeholder="en-MY"
                />
              </label>

              <label>
                <span>
                  Timezone
                </span>

                <input
                  value={
                    editForm.timezone
                  }
                  onChange={(event) =>
                    updateEditField(
                      "timezone",
                      event.target.value,
                    )
                  }
                  placeholder="Asia/Kuala_Lumpur"
                />
              </label>

              <label>
                <span>
                  Proxy type
                </span>

                <select
                  value={
                    editForm.proxyType
                  }
                  onChange={(event) =>
                    updateEditField(
                      "proxyType",
                      event.target
                        .value as ProxyType,
                    )
                  }
                >
                  <option value="DIRECT">
                    DIRECT
                  </option>
                  <option value="HTTP">
                    HTTP
                  </option>
                  <option value="HTTPS">
                    HTTPS
                  </option>
                  <option value="SOCKS5">
                    SOCKS5
                  </option>
                </select>
              </label>

              <label>
                <span>
                  Proxy country
                </span>

                <input
                  disabled={
                    editForm.proxyType ===
                    "DIRECT"
                  }
                  value={
                    editForm.proxyCountry
                  }
                  onChange={(event) =>
                    updateEditField(
                      "proxyCountry",
                      event.target.value,
                    )
                  }
                  placeholder="MY"
                />
              </label>

              <label>
                <span>
                  Proxy host
                </span>

                <input
                  disabled={
                    editForm.proxyType ===
                    "DIRECT"
                  }
                  value={
                    editForm.proxyHost
                  }
                  onChange={(event) =>
                    updateEditField(
                      "proxyHost",
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>
                  Proxy port
                </span>

                <input
                  disabled={
                    editForm.proxyType ===
                    "DIRECT"
                  }
                  inputMode="numeric"
                  value={
                    editForm.proxyPort
                  }
                  onChange={(event) =>
                    updateEditField(
                      "proxyPort",
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>
                  New proxy username
                </span>

                <input
                  disabled={
                    editForm.proxyType ===
                    "DIRECT"
                  }
                  value={
                    editForm.proxyUsername
                  }
                  onChange={(event) =>
                    updateEditField(
                      "proxyUsername",
                      event.target.value,
                    )
                  }
                  placeholder={
                    selectedAccount.hasProxyUsername
                      ? "Leave blank to keep current"
                      : "Optional"
                  }
                />
              </label>

              <label>
                <span>
                  New proxy password
                </span>

                <input
                  disabled={
                    editForm.proxyType ===
                    "DIRECT"
                  }
                  type="password"
                  value={
                    editForm.proxyPassword
                  }
                  onChange={(event) =>
                    updateEditField(
                      "proxyPassword",
                      event.target.value,
                    )
                  }
                  placeholder={
                    selectedAccount.hasProxyPassword
                      ? "Leave blank to keep current"
                      : "Optional"
                  }
                />
              </label>
            </div>

            <label className={styles.checkOption}>
              <input
                type="checkbox"
                checked={
                  editForm.clearProxyCredentials
                }
                onChange={(event) =>
                  updateEditField(
                    "clearProxyCredentials",
                    event.target.checked,
                  )
                }
              />

              <span>
                Clear saved proxy username and
                password
              </span>
            </label>

            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={editSaving}
                onClick={() =>
                  setEditOpen(
                    false,
                  )
                }
              >
                Cancel
              </button>

              <button
                className={styles.primaryButton}
                type="button"
                disabled={
                  editSaving ||
                  selectedRuntime.running
                }
                onClick={() =>
                  void saveEdit()
                }
              >
                {editSaving
                  ? "Saving…"
                  : "Save Changes"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

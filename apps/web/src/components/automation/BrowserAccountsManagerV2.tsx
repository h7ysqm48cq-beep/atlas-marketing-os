"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./BrowserAccountsManagerV2.module.css";

import { useBrowserAccounts } from "./browser-accounts/hooks/useBrowserAccounts";

import {
  getAutomationPolicy,
  updateAutomationPolicy as updateAutomationPolicyApi,
} from "./browser-accounts/api/policy.api";

import { getTimeline } from "./browser-accounts/api/timeline.api";

import { createBrowserViewerSession } from "./browser-accounts/api/viewer.api";

import {
  createBrowserAccount,
  updateBrowserAccount,
} from "./browser-accounts/api/accounts.api";

import { getBrowserStatus } from "./browser-accounts/api/browserRuntime.api";

import { AccountActions } from "./browser-accounts/components/AccountActions";
import { AccountOverview } from "./browser-accounts/components/AccountOverview";
import { LiveBrowserViewer } from "./browser-accounts/components/LiveBrowserViewer";

import {
  buildNoVncUrl,
  getBrowserRuntimeApiUrl,
} from "./browser-accounts/utils/browser-url";

import { formatDate } from "./browser-accounts/utils/format";

import {
  facebookIdentityMessage,
  healthStatusFromLogin,
  loginStatusClass,
  normalizeStatus,
  readableStatus,
} from "./browser-accounts/utils/status";

import type {
  ProxyType,
  BrowserAccount,
  BrowserSession,
  AccountRuntime,
  EditAccountForm,
  AutomationPolicy,
  TimelineEvent,
  OnboardingStep,
  OnboardingResult,
  InspectionResult,
  AccountHealthResult,
} from "./browser-accounts/types";

const EMPTY_RUNTIME: AccountRuntime = {
  loading: false,
  running: false,
  session: null,
  error: "",
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      message: text,
    };
  }
}

function getErrorMessage(body: Record<string, unknown>, fallback: string) {
  return typeof body.message === "string" && body.message.trim()
    ? body.message
    : fallback;
}

export function BrowserAccountsManagerV2({
  requestedAccountId,
  requestedChannelId,
  requestedChannelPlatform,
  requestedViewerOpen = false,
}: {
  requestedAccountId?: string | null;
  requestedChannelId?: string | null;
  requestedChannelPlatform?: "FACEBOOK" | "INSTAGRAM" | null;
  requestedViewerOpen?: boolean;
}) {
  const {
    accounts,
    brands,
    selectedId,
    selectedAccount,
    loading,
    error: accountsError,
    setSelectedId,
    loadAccounts,
    loadBrands,
  } = useBrowserAccounts({
    requestedAccountId,
  });

  const [runtimes, setRuntimes] = useState<Record<string, AccountRuntime>>({});

  const [selectedForBatch, setSelectedForBatch] = useState<Set<string>>(
    new Set(),
  );

  const [search, setSearch] = useState("");

  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  const [manualCreateOpen, setManualCreateOpen] = useState(false);

  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [createError, setCreateError] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    facebookEmail: "",
    facebookPassword: "",
    proxyHost: "",
    proxyPort: "",
    proxyUsername: "",
    proxyPassword: "",
  });

  const [importAccountsOpen, setImportAccountsOpen] = useState(false);

  const [globalError, setGlobalError] = useState("");

  const [actionMessage, setActionMessage] = useState("");

  const [onboardingRunning, setOnboardingRunning] = useState(false);

  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("IDLE");

  const [onboardingResult, setOnboardingResult] =
    useState<OnboardingResult | null>(null);

  const [onboardingError, setOnboardingError] = useState("");

  const [brandSaving, setBrandSaving] = useState(false);

  const [automationPolicy, setAutomationPolicy] =
    useState<AutomationPolicy | null>(null);

  const [policyLoading, setPolicyLoading] = useState(false);

  const [policySaving, setPolicySaving] = useState(false);

  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  const [timelineLoading, setTimelineLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);

  const [editSaving, setEditSaving] = useState(false);

  const [editForm, setEditForm] = useState<EditAccountForm | null>(null);

  const [viewerOpen, setViewerOpen] = useState(false);

  const [viewerKey, setViewerKey] = useState(0);

  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const [healthResults, setHealthResults] = useState<
    Record<string, AccountHealthResult>
  >({});

  const [healthCheckRunning, setHealthCheckRunning] = useState(false);

  const [healthCheckProgress, setHealthCheckProgress] = useState("");

  const viewerRef = useRef<HTMLElement | null>(null);
  const automaticViewerRequestedRef = useRef(false);

  async function connectSecureBrowserViewer() {
    const token = await createBrowserViewerSession();

    const nextUrl = buildNoVncUrl(token);

    setViewerUrl(nextUrl);

    return nextUrl;
  }

  /*
   * Auto-focus the live browser viewer.
   *
   * openBrowser() already increments viewerKey after the
   * remote browser has opened. Once React renders the viewer,
   * move it directly into view so the user does not need to
   * manually scroll down.
   */
  useEffect(() => {
    if (!viewerOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      viewerRef.current?.scrollIntoView({
        behavior: "smooth",

        block: "start",
      });
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [viewerOpen, viewerKey]);

  const selectedRuntime = selectedId
    ? runtimes[selectedId] || EMPTY_RUNTIME
    : EMPTY_RUNTIME;

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return accounts;
    }

    return accounts.filter((account) =>
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
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [accounts, search]);

  const updateRuntime = useCallback(
    (accountId: string, patch: Partial<AccountRuntime>) => {
      setRuntimes((current) => ({
        ...current,
        [accountId]: {
          ...(current[accountId] || EMPTY_RUNTIME),
          ...patch,
        },
      }));
    },
    [],
  );

  const loadRuntime = useCallback(
    async (accountId: string) => {
      updateRuntime(accountId, {
        loading: true,
        error: "",
      });

      try {
        const body = await getBrowserStatus(accountId);

        const session =
          body.session && typeof body.session === "object"
            ? (body.session as BrowserSession)
            : null;

        updateRuntime(accountId, {
          loading: false,
          running: body.running === true,
          session,
          error: "",
        });
      } catch (error) {
        updateRuntime(accountId, {
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load browser status.",
        });
      }
    },
    [updateRuntime],
  );

  useEffect(() => {
    void Promise.all([loadAccounts(), loadBrands()]);
  }, [loadAccounts, loadBrands]);

  useEffect(() => {
    void Promise.all(accounts.map((account) => loadRuntime(account.id)));
  }, [accounts, loadRuntime]);

  useEffect(() => {
    if (!selectedId) {
      // Reset data owned by the previously selected account.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAutomationPolicy(null);
      setTimeline([]);
      return;
    }

    void Promise.all([
      loadAutomationPolicy(selectedId),
      loadTimeline(selectedId),
    ]);
  }, [selectedId]);

  function openEdit(account: BrowserAccount) {
    setEditForm({
      displayName: account.displayName,
      browserProfileName: account.browserProfileName,
      brandId: account.brandId || "",
      locale: account.locale,
      timezone: account.timezone,
      proxyType: account.proxyType,
      proxyHost: account.proxyHost || "",
      proxyPort: account.proxyPort ? String(account.proxyPort) : "",
      proxyUsername: "",
      proxyPassword: "",
      proxyCountry: account.proxyCountry || "",
      clearProxyCredentials: false,
    });

    setEditOpen(true);
    setGlobalError("");
  }

  function updateEditField<Key extends keyof EditAccountForm>(
    key: Key,
    value: EditAccountForm[Key],
  ) {
    setEditForm((current) =>
      current
        ? {
            ...current,
            [key]: value,
          }
        : current,
    );
  }

  async function saveEdit() {
    if (!selectedAccount || !editForm) {
      return;
    }

    if (selectedRuntime.running) {
      setGlobalError(
        "Close the browser before changing its profile or proxy settings.",
      );
      return;
    }

    setEditSaving(true);
    setGlobalError("");

    try {
      const proxyPort =
        editForm.proxyType === "DIRECT" ? null : Number(editForm.proxyPort);

      await updateBrowserAccount(selectedAccount.id, {
        displayName: editForm.displayName,
        browserProfileName: editForm.browserProfileName,
        brandId: editForm.brandId || null,
        locale: editForm.locale,
        timezone: editForm.timezone,
        proxyType: editForm.proxyType,
        proxyHost: editForm.proxyType === "DIRECT" ? null : editForm.proxyHost,
        proxyPort,
        proxyUsername: editForm.proxyUsername || undefined,
        proxyPassword: editForm.proxyPassword || undefined,
        proxyCountry:
          editForm.proxyType === "DIRECT" ? null : editForm.proxyCountry,
        clearProxyCredentials: editForm.clearProxyCredentials,
      });

      setEditOpen(false);
      setEditForm(null);

      await loadAccounts();

      setActionMessage("Browser account updated.");
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

  async function loadAutomationPolicy(accountId: string) {
    setPolicyLoading(true);

    try {
      const body = await getAutomationPolicy(accountId);

      setAutomationPolicy(body as unknown as AutomationPolicy);
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

  async function loadTimeline(accountId: string) {
    setTimelineLoading(true);

    try {
      const body = await getTimeline(accountId);

      setTimeline(
        Array.isArray(body) ? (body as unknown as TimelineEvent[]) : [],
      );
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : "Unable to load timeline.",
      );
    } finally {
      setTimelineLoading(false);
    }
  }

  async function updateAutomationPolicy(patch: Partial<AutomationPolicy>) {
    if (!selectedAccount || !automationPolicy) {
      return;
    }

    const previous = automationPolicy;

    const next = {
      ...previous,
      ...patch,
    };

    setAutomationPolicy(next);
    setPolicySaving(true);
    setGlobalError("");

    try {
      const body = await updateAutomationPolicyApi(selectedAccount.id, patch);

      setAutomationPolicy(body as unknown as AutomationPolicy);

      setActionMessage("Automation policy updated.");
    } catch (error) {
      setAutomationPolicy(previous);

      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to update automation policy.",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  function timelineStatusClass(status: string) {
    const normalized = status.trim().toUpperCase();

    if (normalized === "SUCCESS") {
      return styles.timelineSuccess;
    }

    if (normalized === "WARNING") {
      return styles.timelineWarning;
    }

    if (normalized === "FAILED") {
      return styles.timelineFailed;
    }

    return styles.timelineInfo;
  }

  async function runOnboarding(accountId: string) {
    setOnboardingRunning(true);
    setOnboardingStep("VERIFYING");
    setOnboardingResult(null);
    setOnboardingError("");
    setGlobalError("");
    setActionMessage("");

    const progressTimer = window.setTimeout(() => {
      setOnboardingStep("DISCOVERING");
    }, 1400);

    const syncTimer = window.setTimeout(() => {
      setOnboardingStep("SYNCING");
    }, 3200);

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/onboarding/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            verifyLogin: true,
          }),
        },
      );

      const body = await readJson(response);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "Unable to complete onboarding."),
        );
      }

      const result = body as OnboardingResult;

      setOnboardingResult(result);

      if (result.requiresAttention) {
        setOnboardingStep("ATTENTION");

        const attentionMessage =
          result.step === "SELECT_BRAND"
            ? "Select a Brand for this account, then run onboarding again."
            : `Onboarding requires attention at ${result.step || "UNKNOWN"}.`;

        setActionMessage(attentionMessage);
      } else if (result.completed) {
        setOnboardingStep("COMPLETED");

        const created = result.syncResult?.created || 0;

        const reused = result.syncResult?.reused || 0;

        const linked = result.syncResult?.linked || 0;

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
        setOnboardingStep("ATTENTION");

        setActionMessage("Onboarding paused before completion.");
      }

      await Promise.all([
        loadAccounts(),
        loadRuntime(accountId),
        loadTimeline(accountId),
        loadAutomationPolicy(accountId),
      ]);
    } catch (error) {
      setOnboardingStep("FAILED");
      const message =
        error instanceof Error
          ? error.message
          : "Unable to complete onboarding.";

      setOnboardingError(message);
      setGlobalError(message);
    } finally {
      window.clearTimeout(progressTimer);
      window.clearTimeout(syncTimer);
      setOnboardingRunning(false);
    }
  }

  async function assignBrandAndContinue(accountId: string, brandId: string) {
    if (!brandId) {
      return;
    }

    setBrandSaving(true);
    setOnboardingError("");
    setGlobalError("");

    try {
      await updateBrowserAccount(accountId, { brandId });
      await loadAccounts();
      setActionMessage("Brand saved. Continuing onboarding…");
      await runOnboarding(accountId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save Brand.";

      setOnboardingError(message);
      setGlobalError(message);
    } finally {
      setBrandSaving(false);
    }
  }

  async function verifyLoginAndContinue(accountId: string) {
    setOnboardingError("");

    try {
      const inspection = await verifyLogin(accountId);

      if (normalizeStatus(inspection.loginStatus) !== "LOGGED_IN") {
        setOnboardingResult({
          completed: false,
          requiresAttention: true,
          step: "LOGIN",
          loginStatus: inspection.loginStatus,
        });
        setOnboardingStep("ATTENTION");
        return;
      }

      await runOnboarding(accountId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to verify login.";

      setOnboardingError(message);
      setGlobalError(message);
      setOnboardingStep("FAILED");
    }
  }

  function onboardingStepLabel(step: OnboardingStep) {
    return step.replaceAll("_", " ");
  }

  async function healthCheckAccount(
    account: BrowserAccount,
  ): Promise<AccountHealthResult> {
    const apiOrigin = getBrowserRuntimeApiUrl();

    let browserWasRunning = false;

    let openedTemporarily = false;

    try {
      const statusResponse = await fetch(
        `${apiOrigin}/browser-runtime/accounts/${account.id}/browser/status`,
        {
          cache: "no-store",
        },
      );

      const statusBody = await readJson(statusResponse);

      if (!statusResponse.ok) {
        throw new Error(
          getErrorMessage(statusBody, "Unable to read browser status."),
        );
      }

      browserWasRunning = statusBody.running === true;

      /*
       * If stopped, temporarily start this
       * account's own persistent profile.
       *
       * No Live Viewer is opened.
       * No other account profile is reused.
       */
      if (!browserWasRunning) {
        const openResponse = await fetch(
          `${apiOrigin}/browser-runtime/accounts/${account.id}/browser/open`,
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
            },

            body: JSON.stringify({
              headless: true,

              startUrl: "https://www.facebook.com/",
            }),
          },
        );

        const openBody = await readJson(openResponse);

        if (!openResponse.ok) {
          throw new Error(
            getErrorMessage(
              openBody,
              "Unable to open browser for health check.",
            ),
          );
        }

        openedTemporarily = true;
      }

      const inspectResponse = await fetch(
        `${apiOrigin}/browser-runtime/accounts/${account.id}/browser/inspect`,
        {
          method: "POST",
        },
      );

      const inspectBody = await readJson(inspectResponse);

      if (!inspectResponse.ok) {
        throw new Error(
          getErrorMessage(inspectBody, "Unable to inspect Facebook identity."),
        );
      }

      const inspection = inspectBody as InspectionResult;

      const loginStatus = normalizeStatus(inspection.loginStatus);

      return {
        accountId: account.id,

        status: healthStatusFromLogin(loginStatus),

        loginStatus,

        browserWasRunning,

        checkedAt: new Date().toISOString(),

        message: facebookIdentityMessage(loginStatus),
      };
    } catch (error) {
      return {
        accountId: account.id,

        status: "FAILED",

        loginStatus: "UNKNOWN",

        browserWasRunning,

        checkedAt: new Date().toISOString(),

        message:
          error instanceof Error ? error.message : "Health check failed.",
      };
    } finally {
      /*
       * Never close a browser the user
       * already had open.
       *
       * Only close sessions created by
       * Health Monitor itself.
       */
      if (openedTemporarily) {
        await fetch(
          `${apiOrigin}/browser-runtime/accounts/${account.id}/browser/close`,
          {
            method: "POST",
          },
        ).catch(() => undefined);
      }
    }
  }

  async function runAllHealthChecks() {
    if (healthCheckRunning || !accounts.length) {
      return;
    }

    setHealthCheckRunning(true);

    setGlobalError("");
    setActionMessage("");

    const nextResults: Record<string, AccountHealthResult> = {};

    try {
      for (let index = 0; index < accounts.length; index += 1) {
        const account = accounts[index];

        setHealthCheckProgress(
          `Checking ${index + 1}/${accounts.length}: ${account.displayName}`,
        );

        const result = await healthCheckAccount(account);

        nextResults[account.id] = result;

        setHealthResults({
          ...nextResults,
        });
      }

      const results = Object.values(nextResults);

      const ready = results.filter((item) => item.status === "READY").length;

      const loginRequired = results.filter(
        (item) => item.status === "LOGIN_REQUIRED",
      ).length;

      const attention = results.filter(
        (item) => item.status === "ATTENTION",
      ).length;

      const failed = results.filter((item) => item.status === "FAILED").length;

      setActionMessage(
        [
          "Health check completed.",
          `${ready} ready.`,
          `${loginRequired} login required.`,
          `${attention} need attention.`,
          `${failed} failed.`,
        ].join(" "),
      );

      await loadAccounts();
    } catch (error) {
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to complete health check.",
      );
    } finally {
      setHealthCheckProgress("");

      setHealthCheckRunning(false);
    }
  }

  async function openBrowser(accountId: string) {
    setActionMessage("");
    updateRuntime(accountId, {
      loading: true,
      error: "",
    });

    const apiOrigin =
      getBrowserRuntimeApiUrl();

    const openUrl = requestedChannelId
      ? `${apiOrigin}/automation/channels/${requestedChannelId}/browser/open`
      : `${apiOrigin}/browser-runtime/accounts/${accountId}/browser/open`;

    const openPayload = requestedChannelId
      ? {
          headless: false,
          ...(requestedChannelPlatform === "INSTAGRAM"
            ? {
                startUrl: "https://www.instagram.com/",
              }
            : {}),
        }
      : {
          headless: false,
          startUrl: "https://www.facebook.com/",
        };

    const response = await fetch(
      openUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openPayload),
      },
    );

    const body = await readJson(response);

    if (!response.ok) {
      updateRuntime(accountId, {
        loading: false,
        error: getErrorMessage(body, "Unable to open browser."),
      });

      throw new Error(getErrorMessage(body, "Unable to open browser."));
    }

    await Promise.all([loadRuntime(accountId), loadAccounts()]);

    await connectSecureBrowserViewer();

    setActionMessage("Browser profile opened.");

    setViewerOpen(true);

    setViewerKey((current) => current + 1);

    if (requestedChannelPlatform === "INSTAGRAM") {
      setActionMessage("Instagram browser opened.");
      return;
    }

    /*
     * Browser running and Facebook logged in
     * are two separate states.
     *
     * Automatically inspect Facebook after
     * every browser open so the UI reflects
     * the actual identity stored in this
     * persistent browser profile.
     */
    try {
      const inspection = await verifyLogin(accountId);

      const identityStatus = inspection?.loginStatus || "UNKNOWN";

      setActionMessage(
        [
          "Browser profile opened.",
          facebookIdentityMessage(identityStatus),
        ].join(" "),
      );
    } catch (error) {
      console.warn("Facebook identity auto-check failed:", error);

      /*
       * Browser opening succeeded.
       * A verification failure must not make
       * the browser itself appear failed.
       */
      setActionMessage(
        "Browser profile opened. Facebook identity could not be verified automatically.",
      );
    }
  }

  useEffect(() => {
    if (
      !requestedViewerOpen ||
      !selectedAccount ||
      automaticViewerRequestedRef.current
    ) {
      return;
    }

    const runtime =
      runtimes[selectedAccount.id];

    if (!runtime || runtime.loading) {
      return;
    }

    automaticViewerRequestedRef.current = true;

    if (runtime.running && requestedChannelId) {
      void openBrowser(selectedAccount.id).catch((error) => {
        setGlobalError(
          error instanceof Error
            ? error.message
            : "Unable to open Live Browser.",
        );
      });

      return;
    }

    if (runtime.running) {
      void connectSecureBrowserViewer()
        .then(() => {
          setViewerOpen(true);
          setViewerKey((current) => current + 1);
          setActionMessage(
            "Browser profile is already running.",
          );
        })
        .catch((error) => {
          setGlobalError(
            error instanceof Error
              ? error.message
              : "Unable to open Live Browser.",
          );
        });

      return;
    }

    void openBrowser(selectedAccount.id).catch((error) => {
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Unable to open Live Browser.",
      );
    });
  }, [
    requestedViewerOpen,
    requestedChannelId,
    requestedChannelPlatform,
    selectedAccount,
    runtimes,
  ]);

  async function verifyLogin(accountId: string) {
    setActionMessage("");

    updateRuntime(accountId, {
      loading: true,
      error: "",
    });

    const response = await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/browser/inspect`,
      {
        method: "POST",
      },
    );

    const body = await readJson(response);

    if (!response.ok) {
      updateRuntime(accountId, {
        loading: false,
        error: getErrorMessage(body, "Unable to verify login."),
      });

      throw new Error(getErrorMessage(body, "Unable to verify login."));
    }

    const result = body as InspectionResult;

    await Promise.all([
      loadAccounts(),
      loadRuntime(accountId),
      loadTimeline(accountId),
      loadAutomationPolicy(accountId),
    ]);

    const status = readableStatus(result.loginStatus);

    setActionMessage(`Login verification: ${status}.`);

    return result;
  }

  async function closeBrowser(accountId: string) {
    setActionMessage("");

    updateRuntime(accountId, {
      loading: true,
      error: "",
    });

    const response = await fetch(
      `${getBrowserRuntimeApiUrl()}/browser-runtime/accounts/${accountId}/browser/close`,
      {
        method: "POST",
      },
    );

    const body = await readJson(response);

    if (!response.ok) {
      updateRuntime(accountId, {
        loading: false,
        error: getErrorMessage(body, "Unable to close browser."),
      });

      throw new Error(getErrorMessage(body, "Unable to close browser."));
    }

    await Promise.all([loadRuntime(accountId), loadAccounts()]);

    setViewerOpen(false);

    setViewerUrl(null);

    setActionMessage(
      "Browser profile closed. Cookies remain stored in the profile.",
    );
  }

  function toggleBatch(accountId: string) {
    setSelectedForBatch((current) => {
      const next = new Set(current);

      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }

      return next;
    });
  }

  function toggleAllVisible() {
    const visibleIds = filteredAccounts.map((account) => account.id);

    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selectedForBatch.has(id));

    setSelectedForBatch((current) => {
      const next = new Set(current);

      for (const id of visibleIds) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });
  }

  async function verifySelected() {
    const selected = accounts.filter((account) =>
      selectedForBatch.has(account.id),
    );

    if (!selected.length) {
      return;
    }

    setGlobalError("");
    setActionMessage(`Verifying ${selected.length} account(s)…`);

    for (const account of selected) {
      try {
        await verifyLogin(account.id);
      } catch (error) {
        setGlobalError(
          error instanceof Error ? error.message : "Batch verification failed.",
        );
        break;
      }
    }

    setActionMessage("Batch verification completed.");
  }

  const accountStats = useMemo(() => {
    const loggedIn = accounts.filter(
      (account) => normalizeStatus(account.loginStatus) === "LOGGED_IN",
    ).length;

    const loginRequired = accounts.filter((account) =>
      ["LOGIN_REQUIRED", "TWO_FACTOR_REQUIRED", "CHECKPOINT_REQUIRED"].includes(
        normalizeStatus(account.loginStatus),
      ),
    ).length;

    const running = accounts.filter((account) =>
      Boolean(runtimes[account.id]?.running),
    ).length;

    const proxyAttention = accounts.filter(
      (account) =>
        account.proxyType !== "DIRECT" &&
        (!account.proxyHost || !account.proxyPort || !account.lastKnownIp),
    ).length;

    return {
      total: accounts.length,
      loggedIn,
      loginRequired,
      running,
      proxyAttention,
    };
  }, [accounts, runtimes]);

  async function submitManualAccount() {
    if (createSubmitting) {
      return;
    }

    const facebookEmail = createForm.facebookEmail.trim();

    const facebookPassword = createForm.facebookPassword;

    const proxyHost = createForm.proxyHost.trim();

    const proxyPort = createForm.proxyPort.trim();

    const proxyUsername = createForm.proxyUsername.trim();

    const proxyPassword = createForm.proxyPassword;

    if (!facebookEmail) {
      setCreateError("Facebook email is required.");
      return;
    }

    if (!facebookPassword) {
      setCreateError("Facebook password is required.");
      return;
    }

    const hasProxy = Boolean(proxyHost);

    if (hasProxy && !proxyPort) {
      setCreateError("Proxy port is required when proxy host is provided.");
      return;
    }

    setCreateSubmitting(true);
    setCreateError(null);

    try {
      await createBrowserAccount({
        facebookEmail,
        facebookPassword,

        proxyType: hasProxy ? "HTTP" : "DIRECT",

        proxyHost: hasProxy ? proxyHost : null,

        proxyPort: hasProxy ? Number(proxyPort) : null,

        proxyUsername: hasProxy ? proxyUsername || null : null,

        proxyPassword: hasProxy ? proxyPassword || null : null,

        proxyCountry: hasProxy ? "MY" : null,

        browserEngine: "chromium",

        operatingSystem: "macOS",

        screenWidth: 1440,

        screenHeight: 900,

        deviceScaleFactor: 2,

        locale: "en-MY",

        timezone: "Asia/Kuala_Lumpur",

        identityLocked: true,
      });

      setManualCreateOpen(false);

      setCreateForm({
        facebookEmail: "",
        facebookPassword: "",
        proxyHost: "",
        proxyPort: "",
        proxyUsername: "",
        proxyPassword: "",
      });

      await loadAccounts();
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Unable to create browser account.",
      );
    } finally {
      setCreateSubmitting(false);
    }
  }

  function scrollToDetailSection(section: string) {
    const accountId = selectedAccount?.id;

    if (!accountId) {
      return;
    }

    document
      .getElementById(`browser-account-${accountId}-${section}`)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }

  const pageError = globalError || accountsError;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerActions}>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => setCreateAccountOpen(true)}
          >
            + Add Account
          </button>

          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => setImportAccountsOpen(true)}
          >
            Import Excel
          </button>

          <a className={styles.secondaryButton} href="/automation/browser-pool">
            Browser Pool
          </a>

          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => void loadAccounts()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <section className={styles.accountStats}>
        <article>
          <span>Total Accounts</span>

          <strong>{accountStats.total}</strong>

          <small>Independent profiles</small>
        </article>

        <article>
          <span>Logged In</span>

          <strong>{accountStats.loggedIn}</strong>

          <small>Facebook sessions ready</small>
        </article>

        <article>
          <span>Login Required</span>

          <strong>{accountStats.loginRequired}</strong>

          <small>Accounts needing attention</small>
        </article>

        <article>
          <span>Running</span>

          <strong>{accountStats.running}</strong>

          <small>Live browser sessions</small>
        </article>

        <article>
          <span>Proxy Attention</span>

          <strong>{accountStats.proxyAttention}</strong>

          <small>IP or proxy not verified</small>
        </article>
      </section>

      {pageError ? <div className={styles.error}>{pageError}</div> : null}

      {actionMessage ? (
        <div className={styles.success}>{actionMessage}</div>
      ) : null}

      <section className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span aria-hidden="true" className={styles.searchIcon}>
            ⌕
          </span>

          <input
            className={styles.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search account, profile, IP or status…"
          />
        </div>

        <div className={styles.toolbarActions}>
          <span className={styles.selectionCount}>
            {selectedForBatch.size} selected
          </span>

          <button
            className={styles.primaryButton}
            type="button"
            disabled={selectedForBatch.size === 0}
            onClick={() => void verifySelected()}
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
                      filteredAccounts.length > 0 &&
                      filteredAccounts.every((account) =>
                        selectedForBatch.has(account.id),
                      )
                    }
                    onChange={toggleAllVisible}
                  />
                </th>

                <th>Account</th>
                <th>Login</th>
                <th>Cookie</th>
                <th>Proxy</th>
                <th>Browser</th>
                <th>IP</th>
                <th>Last verified</th>
                <th className={styles.quickActionHeader}>Quick Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td className={styles.emptyCell} colSpan={9}>
                    Loading browser accounts…
                  </td>
                </tr>
              ) : null}

              {!loading && !pageError && !filteredAccounts.length ? (
                <tr>
                  <td className={styles.emptyCell} colSpan={9}>
                    No independent browser accounts found.
                  </td>
                </tr>
              ) : null}

              {filteredAccounts.map((account) => {
                const runtime = runtimes[account.id] || EMPTY_RUNTIME;

                const selected = selectedId === account.id;

                return (
                  <tr
                    className={selected ? styles.selectedRow : undefined}
                    key={account.id}
                    onClick={() => setSelectedId(account.id)}
                  >
                    <td
                      className={styles.checkboxCell}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedForBatch.has(account.id)}
                        onChange={() => toggleBatch(account.id)}
                      />
                    </td>

                    <td>
                      <div className={styles.accountIdentity}>
                        <span
                          aria-hidden="true"
                          className={styles.accountAvatar}
                        >
                          {(account.facebookUserName || account.displayName)
                            .trim()
                            .slice(0, 1)
                            .toUpperCase() || "B"}
                        </span>

                        <div>
                          <strong>
                            {account.facebookUserName || account.displayName}
                          </strong>

                          <small>
                            {[
                              account.facebookUserName
                                ? account.displayName
                                : null,
                              account.maskedEmail,
                              account.browserProfileName,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span
                        className={[
                          styles.status,
                          loginStatusClass(account.loginStatus),
                        ].join(" ")}
                      >
                        {readableStatus(account.loginStatus)}
                      </span>
                    </td>

                    <td>
                      <span
                        className={[
                          styles.status,
                          account.cookieStatus === "ACTIVE"
                            ? styles.good
                            : styles.neutral,
                        ].join(" ")}
                      >
                        {readableStatus(account.cookieStatus)}
                      </span>
                    </td>

                    <td>
                      <strong>{account.proxyType}</strong>

                      <small>{account.proxyCountry || "—"}</small>
                    </td>

                    <td>
                      <span
                        className={[
                          styles.status,
                          runtime.running ? styles.good : styles.neutral,
                        ].join(" ")}
                      >
                        {runtime.loading
                          ? "CHECKING"
                          : runtime.running
                            ? "RUNNING"
                            : "STOPPED"}
                      </span>
                    </td>

                    <td>{account.lastKnownIp || "—"}</td>

                    <td>{formatDate(account.lastVerifiedAt)}</td>

                    <td
                      className={styles.quickActionCell}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className={styles.rowActions}>
                        <button
                          className={styles.rowActionPrimary}
                          type="button"
                          disabled={runtime.loading}
                          onClick={() => {
                            setSelectedId(account.id);

                            if (runtime.running) {
                              void connectSecureBrowserViewer()
                                .then(() => {
                                  setViewerOpen(true);
                                  setViewerKey((current) => current + 1);
                                })
                                .catch((error) =>
                                  setGlobalError(
                                    error instanceof Error
                                      ? error.message
                                      : "Unable to open Live Browser.",
                                  ),
                                );
                              return;
                            }

                            void openBrowser(account.id).catch((error) =>
                              setGlobalError(
                                error instanceof Error
                                  ? error.message
                                  : "Unable to open browser.",
                              ),
                            );
                          }}
                        >
                          {runtime.running ? "View" : "Open"}
                        </button>

                        <button
                          type="button"
                          disabled={runtime.loading}
                          onClick={() => {
                            setSelectedId(account.id);

                            void verifyLogin(account.id).catch((error) =>
                              setGlobalError(
                                error instanceof Error
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
                            setSelectedId(account.id);

                            openEdit(account);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.healthMonitor}>
        <div className={styles.healthMonitorHeader}>
          <div>
            <p className={styles.eyebrow}>ACCOUNT HEALTH MONITOR</p>

            <h2>Facebook Account Health</h2>

            <p>
              Check every browser profile and verify whether its stored Facebook
              identity is still usable.
            </p>
          </div>

          <button
            type="button"
            className={styles.primaryButton}
            disabled={healthCheckRunning || accounts.length === 0}
            onClick={() => {
              void runAllHealthChecks();
            }}
          >
            {healthCheckRunning ? "Checking…" : "Check All Accounts"}
          </button>
        </div>

        {healthCheckProgress ? (
          <div className={styles.healthProgress}>{healthCheckProgress}</div>
        ) : null}

        <div className={styles.healthAccountGrid}>
          {accounts.map((account) => {
            const result = healthResults[account.id];

            const status =
              result?.status || healthStatusFromLogin(account.loginStatus);

            const runtime = runtimes[account.id];

            return (
              <article key={account.id}>
                <div className={styles.healthAccountTop}>
                  <strong>{account.displayName}</strong>

                  <span data-health-status={status}>{status}</span>
                </div>

                <small>
                  {result
                    ? result.message
                    : facebookIdentityMessage(account.loginStatus)}
                </small>

                <div className={styles.healthMeta}>
                  <span>
                    Facebook:{" "}
                    {result
                      ? readableStatus(result.loginStatus)
                      : readableStatus(account.loginStatus)}
                  </span>

                  <span>
                    Browser: {runtime?.running ? "RUNNING" : "STOPPED"}
                  </span>

                  {result ? (
                    <span>Checked: {formatDate(result.checkedAt)}</span>
                  ) : null}
                </div>
              </article>
            );
          })}
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
                ["actions", "Actions"],
                ["automation", "Automation"],
                ["timeline", "Timeline"],
                ["onboarding", "Onboarding"],
              ].map(([section, label]) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => scrollToDetailSection(section)}
                >
                  {label}
                </button>
              ))}
            </nav>

            <AccountOverview
              account={selectedAccount}
              runtime={selectedRuntime}
              brands={brands}
            />

            {selectedRuntime.error ? (
              <div className={styles.error}>{selectedRuntime.error}</div>
            ) : null}

            <AccountActions
              account={selectedAccount}
              runtime={selectedRuntime}
              onEdit={openEdit}
              onOpenBrowser={openBrowser}
              onVerifyLogin={verifyLogin}
              onCloseBrowser={closeBrowser}
              onError={setGlobalError}
            />

            {viewerOpen && selectedAccount ? (
              <LiveBrowserViewer
                account={selectedAccount}
                runtime={selectedRuntime}
                viewerUrl={viewerUrl}
                viewerKey={viewerKey}
                viewerRef={viewerRef}
                onReload={async () => {
                  await connectSecureBrowserViewer();
                  setViewerKey((current) => current + 1);
                }}
                onOpenNewTab={async () => {
                  const popup = window.open("", "_blank");

                  try {
                    const nextUrl = await connectSecureBrowserViewer();

                    if (!popup) {
                      throw new Error("Browser blocked the new tab.");
                    }

                    popup.opener = null;
                    popup.location.href = nextUrl;
                  } catch (error) {
                    popup?.close();
                    throw error;
                  }
                }}
                onHide={() => {
                  setViewerOpen(false);
                  setViewerUrl(null);
                }}
                onError={setGlobalError}
              />
            ) : null}

            <section
              className={styles.accountSection}
              id={`browser-account-${selectedAccount.id}-automation`}
            >
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>Automation</p>

                  <h3>Automation Policy</h3>
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
                      checked={automationPolicy.autoVerifyLogin}
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoVerifyLogin: event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>Auto Verify Login</strong>

                      <small>
                        Automatically verify the current Facebook session.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={automationPolicy.autoDiscoverPages}
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoDiscoverPages: event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>Auto Discover Pages</strong>

                      <small>
                        Discover Facebook Pages after login verification.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={automationPolicy.autoSyncPages}
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoSyncPages: event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>Auto Sync Pages</strong>

                      <small>
                        Sync discovered Pages into Connected Platforms.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={automationPolicy.autoHealthCheck}
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoHealthCheck: event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>Auto Health Check</strong>

                      <small>
                        Monitor browser, cookie, proxy and session health.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={automationPolicy.autoNotifications}
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoNotifications: event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>Auto Notifications</strong>

                      <small>
                        Notify when login, sync or health checks fail.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={automationPolicy.autoCloseBrowser}
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          autoCloseBrowser: event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>Auto Close Browser</strong>

                      <small>
                        Close the browser after onboarding completes.
                      </small>
                    </span>
                  </label>

                  <label className={styles.policyOption}>
                    <input
                      type="checkbox"
                      checked={automationPolicy.keepBrowserOpenAfterLogin}
                      disabled={policySaving}
                      onChange={(event) =>
                        void updateAutomationPolicy({
                          keepBrowserOpenAfterLogin: event.target.checked,
                        })
                      }
                    />

                    <span>
                      <strong>Keep Browser Open</strong>

                      <small>
                        Keep the live browser available after login.
                      </small>
                    </span>
                  </label>
                </div>
              )}
            </section>

            <section
              className={styles.accountSection}
              id={`browser-account-${selectedAccount.id}-timeline`}
            >
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>Activity</p>

                  <h3>Timeline</h3>
                </div>

                <button
                  className={styles.secondaryButton}
                  type="button"
                  disabled={timelineLoading}
                  onClick={() => void loadTimeline(selectedAccount.id)}
                >
                  {timelineLoading ? "Refreshing…" : "Refresh Timeline"}
                </button>
              </div>

              {timelineLoading && !timeline.length ? (
                <div className={styles.sectionEmpty}>Loading timeline…</div>
              ) : null}

              {!timelineLoading && !timeline.length ? (
                <div className={styles.sectionEmpty}>
                  No browser activity recorded yet.
                </div>
              ) : null}

              <div className={styles.timeline}>
                {timeline.map((event) => (
                  <article className={styles.timelineItem} key={event.id}>
                    <span
                      className={[
                        styles.timelineDot,
                        timelineStatusClass(event.status),
                      ].join(" ")}
                    />

                    <div className={styles.timelineContent}>
                      <div className={styles.timelineTitle}>
                        <strong>{event.title}</strong>

                        <time>{formatDate(event.createdAt)}</time>
                      </div>

                      {event.message ? <p>{event.message}</p> : null}

                      <small>{readableStatus(event.eventType)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section
              className={styles.onboardingPanel}
              id={`browser-account-${selectedAccount.id}-onboarding`}
            >
              <div className={styles.onboardingHeader}>
                <div>
                  <p className={styles.eyebrow}>Guided Setup</p>

                  <h3>Complete Onboarding</h3>

                  <p>
                    Verify login, discover Pages, sync Connected Platforms and
                    refresh account health.
                  </p>

                  <p>
                    Current Brand: {brands.find(
                      (brand) => brand.id === selectedAccount.brandId,
                    )?.name || "Not selected"}
                  </p>
                </div>

                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={onboardingRunning || selectedRuntime.loading}
                  onClick={() => void runOnboarding(selectedAccount.id)}
                >
                  {onboardingRunning ? "Running…" : "Complete Onboarding"}
                </button>
              </div>

              <div className={styles.onboardingSteps}>
                {["VERIFYING", "DISCOVERING", "SYNCING", "COMPLETED"].map(
                  (step) => {
                    const order = [
                      "VERIFYING",
                      "DISCOVERING",
                      "SYNCING",
                      "COMPLETED",
                    ];

                    const currentIndex = order.indexOf(onboardingStep);

                    const stepIndex = order.indexOf(step);

                    const active = onboardingStep === step;

                    const done =
                      currentIndex > stepIndex ||
                      onboardingStep === "COMPLETED";

                    return (
                      <div
                        className={[
                          styles.onboardingStep,
                          active ? styles.onboardingStepActive : "",
                          done ? styles.onboardingStepDone : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={step}
                      >
                        <span>{done ? "✓" : stepIndex + 1}</span>

                        <strong>
                          {onboardingStepLabel(step as OnboardingStep)}
                        </strong>
                      </div>
                    );
                  },
                )}
              </div>

              {onboardingStep === "ATTENTION" ? (
                <div className={styles.warningMessage}>
                  <span>
                    Onboarding needs attention:{" "}
                    {onboardingResult?.step || "UNKNOWN"}
                  </span>

                  {onboardingResult?.step === "SELECT_BRAND" ? (
                    <select
                      aria-label="Select Brand and continue onboarding"
                      disabled={brandSaving || onboardingRunning}
                      defaultValue={selectedAccount.brandId || ""}
                      onChange={(event) =>
                        void assignBrandAndContinue(
                          selectedAccount.id,
                          event.target.value,
                        )
                      }
                    >
                      <option value="">Select Brand</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {onboardingResult?.step === "LOGIN" ? (
                    <>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => void openBrowser(selectedAccount.id)}
                      >
                        Open Facebook Login
                      </button>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        disabled={onboardingRunning}
                        onClick={() =>
                          void verifyLoginAndContinue(selectedAccount.id)
                        }
                      >
                        I&apos;ve Logged In — Verify &amp; Continue
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}

              {onboardingStep === "FAILED" ? (
                <div className={styles.error}>
                  <strong>Automatic onboarding failed.</strong>
                  <p>{onboardingError || "Unable to complete onboarding."}</p>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={onboardingRunning}
                    onClick={() => void runOnboarding(selectedAccount.id)}
                  >
                    Retry Onboarding
                  </button>
                </div>
              ) : null}
            </section>
          </>
        )}
      </section>

      {createAccountOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCreateAccountOpen(false);
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
                <p className={styles.eyebrow}>Browser Account V2</p>

                <h2>Add Account</h2>

                <p>
                  Create one independent Facebook browser identity with its own
                  profile, cookie storage and proxy.
                </p>
              </div>

              <button
                aria-label="Close add account dialog"
                className={styles.iconButton}
                type="button"
                onClick={() => setCreateAccountOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={styles.entryOptions}>
              <article>
                <span className={styles.entryIcon}>+</span>

                <div>
                  <strong>Create Manually</strong>

                  <p>
                    Enter account name, browser profile, locale, timezone and
                    proxy settings.
                  </p>
                </div>

                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => {
                    setCreateAccountOpen(false);
                    setManualCreateOpen(true);
                    setCreateError(null);
                  }}
                >
                  Continue
                </button>
              </article>

              <article>
                <span className={styles.entryIcon}>⇩</span>

                <div>
                  <strong>Import from Excel</strong>

                  <p>
                    Create multiple independent Browser Accounts from one
                    spreadsheet.
                  </p>
                </div>

                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => {
                    setCreateAccountOpen(false);
                    setImportAccountsOpen(true);
                  }}
                >
                  Import Accounts
                </button>
              </article>
            </div>
          </section>
        </div>
      ) : null}

      {manualCreateOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setManualCreateOpen(false);
            }
          }}
        >
          <section
            aria-label="Create browser account"
            aria-modal="true"
            className={styles.entryModal}
            role="dialog"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.eyebrow}>Browser Account V2</p>

                <h2>Create Account</h2>

                <p>
                  Create one independent Facebook account identity with its own
                  browser profile, cookie storage and proxy.
                </p>
              </div>

              <button
                aria-label="Close create account dialog"
                className={styles.iconButton}
                type="button"
                onClick={() => setManualCreateOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={styles.manualCreateForm}>
              <label>
                <span>Facebook Email</span>

                <input
                  autoComplete="username"
                  type="email"
                  value={createForm.facebookEmail}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      facebookEmail: event.target.value,
                    }))
                  }
                />
              </label>

              <label>
                <span>Facebook Password</span>

                <input
                  autoComplete="current-password"
                  type="password"
                  value={createForm.facebookPassword}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      facebookPassword: event.target.value,
                    }))
                  }
                />
              </label>

              <div className={styles.formGrid}>
                <label>
                  <span>Proxy Host</span>

                  <input
                    placeholder="Optional"
                    value={createForm.proxyHost}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        proxyHost: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Proxy Port</span>

                  <input
                    inputMode="numeric"
                    placeholder="Optional"
                    value={createForm.proxyPort}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        proxyPort: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className={styles.formGrid}>
                <label>
                  <span>Proxy Username</span>

                  <input
                    placeholder="Optional"
                    value={createForm.proxyUsername}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        proxyUsername: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  <span>Proxy Password</span>

                  <input
                    placeholder="Optional"
                    type="password"
                    value={createForm.proxyPassword}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        proxyPassword: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className={styles.identitySummary}>
                <strong>Identity defaults</strong>

                <span>Chromium · macOS · 1440 × 900</span>

                <span>en-MY · Asia/Kuala_Lumpur</span>

                <span>Fingerprint locked · isolated cookie profile</span>
              </div>

              {createError ? (
                <div className={styles.formError}>{createError}</div>
              ) : null}
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={createSubmitting}
                onClick={() => setManualCreateOpen(false)}
              >
                Cancel
              </button>

              <button
                className={styles.primaryButton}
                type="button"
                disabled={createSubmitting}
                onClick={() => void submitManualAccount()}
              >
                {createSubmitting ? "Creating…" : "Create Account"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {importAccountsOpen ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImportAccountsOpen(false);
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
                <p className={styles.eyebrow}>Bulk Account Setup</p>

                <h2>Import Excel</h2>

                <p>
                  This V2 importer creates BrowserAccount records directly. It
                  does not write into legacy Channel Runtime Profiles.
                </p>
              </div>

              <button
                aria-label="Close import dialog"
                className={styles.iconButton}
                type="button"
                onClick={() => setImportAccountsOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={styles.importNotice}>
              <strong>Excel columns</strong>

              <code>
                displayName, browserProfileName, locale, timezone, proxyType,
                proxyHost, proxyPort, proxyUsername, proxyPassword, proxyCountry
              </code>

              <p>
                The V2 upload parser will be connected in the next step. Legacy
                Bulk Login remains disabled here to prevent duplicate browser
                identities.
              </p>
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setImportAccountsOpen(false)}
              >
                Close
              </button>

              <button className={styles.primaryButton} type="button" disabled>
                Upload Excel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editOpen && editForm && selectedAccount ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
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
                <p className={styles.eyebrow}>Browser Profile</p>

                <h2>Edit Account</h2>

                <p>{selectedAccount.browserProfileKey}</p>
              </div>

              <button
                className={styles.iconButton}
                type="button"
                aria-label="Close edit dialog"
                onClick={() => setEditOpen(false)}
              >
                ×
              </button>
            </div>

            {selectedRuntime.running ? (
              <div className={styles.warningMessage}>
                Close this browser before changing profile or proxy settings.
              </div>
            ) : null}

            <div className={styles.formGrid}>
              <label>
                <span>Account name</span>

                <input
                  value={editForm.displayName}
                  onChange={(event) =>
                    updateEditField("displayName", event.target.value)
                  }
                />
              </label>

              <label>
                <span>Browser profile name</span>

                <input
                  value={editForm.browserProfileName}
                  onChange={(event) =>
                    updateEditField("browserProfileName", event.target.value)
                  }
                />
              </label>

              <label>
                <span>Brand</span>

                <select
                  value={editForm.brandId}
                  onChange={(event) =>
                    updateEditField("brandId", event.target.value)
                  }
                >
                  <option value="">Select Brand</option>

                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Locale</span>

                <input
                  value={editForm.locale}
                  onChange={(event) =>
                    updateEditField("locale", event.target.value)
                  }
                  placeholder="en-MY"
                />
              </label>

              <label>
                <span>Timezone</span>

                <input
                  value={editForm.timezone}
                  onChange={(event) =>
                    updateEditField("timezone", event.target.value)
                  }
                  placeholder="Asia/Kuala_Lumpur"
                />
              </label>

              <label>
                <span>Proxy type</span>

                <select
                  value={editForm.proxyType}
                  onChange={(event) =>
                    updateEditField(
                      "proxyType",
                      event.target.value as ProxyType,
                    )
                  }
                >
                  <option value="DIRECT">DIRECT</option>
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                  <option value="SOCKS5">SOCKS5</option>
                </select>
              </label>

              <label>
                <span>Proxy country</span>

                <input
                  disabled={editForm.proxyType === "DIRECT"}
                  value={editForm.proxyCountry}
                  onChange={(event) =>
                    updateEditField("proxyCountry", event.target.value)
                  }
                  placeholder="MY"
                />
              </label>

              <label>
                <span>Proxy host</span>

                <input
                  disabled={editForm.proxyType === "DIRECT"}
                  value={editForm.proxyHost}
                  onChange={(event) =>
                    updateEditField("proxyHost", event.target.value)
                  }
                />
              </label>

              <label>
                <span>Proxy port</span>

                <input
                  disabled={editForm.proxyType === "DIRECT"}
                  inputMode="numeric"
                  value={editForm.proxyPort}
                  onChange={(event) =>
                    updateEditField("proxyPort", event.target.value)
                  }
                />
              </label>

              <label>
                <span>New proxy username</span>

                <input
                  disabled={editForm.proxyType === "DIRECT"}
                  value={editForm.proxyUsername}
                  onChange={(event) =>
                    updateEditField("proxyUsername", event.target.value)
                  }
                  placeholder={
                    selectedAccount.hasProxyUsername
                      ? "Leave blank to keep current"
                      : "Optional"
                  }
                />
              </label>

              <label>
                <span>New proxy password</span>

                <input
                  disabled={editForm.proxyType === "DIRECT"}
                  type="password"
                  value={editForm.proxyPassword}
                  onChange={(event) =>
                    updateEditField("proxyPassword", event.target.value)
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
                checked={editForm.clearProxyCredentials}
                onChange={(event) =>
                  updateEditField("clearProxyCredentials", event.target.checked)
                }
              />

              <span>Clear saved proxy username and password</span>
            </label>

            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={editSaving}
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>

              <button
                className={styles.primaryButton}
                type="button"
                disabled={editSaving || selectedRuntime.running}
                onClick={() => void saveEdit()}
              >
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

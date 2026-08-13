export type ProxyType = "DIRECT" | "HTTP" | "HTTPS" | "SOCKS5";

export type LoginStatus =
  | "PENDING"
  | "BROWSER_OPEN"
  | "BROWSER_CLOSED"
  | "LOGIN_REQUIRED"
  | "LOGGED_IN"
  | "TWO_FACTOR_REQUIRED"
  | "CHECKPOINT_REQUIRED"
  | "UNKNOWN"
  | string;

export type BrowserAccount = {
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

export type BrowserSession = {
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

export type AccountRuntime = {
  loading: boolean;
  running: boolean;
  session: BrowserSession | null;
  error: string;
};

export type EditAccountForm = {
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

export type BrandOption = {
  id: string;
  name: string;
  workspaceId?: string | null;
};

export type AutomationPolicy = {
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

export type TimelineEvent = {
  id: string;
  browserAccountId: string;
  eventType: string;
  status: string;
  title: string;
  message: string | null;
  metadata?: unknown;
  createdAt: string;
};

export type OnboardingStep =
  | "IDLE"
  | "VERIFYING"
  | "DISCOVERING"
  | "SYNCING"
  | "COMPLETED"
  | "ATTENTION"
  | "FAILED";

export type OnboardingResult = {
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

export type InspectionResult = {
  loginStatus?: string;
  loginLikely?: boolean;
  loginRequired?: boolean;
  twoFactorRequired?: boolean;
  checkpointRequired?: boolean;
};

export type AccountHealthResult = {
  accountId: string;
  status: "READY" | "LOGIN_REQUIRED" | "ATTENTION" | "UNKNOWN" | "FAILED";
  loginStatus: string;
  browserWasRunning: boolean;
  checkedAt: string;
  message: string;
};

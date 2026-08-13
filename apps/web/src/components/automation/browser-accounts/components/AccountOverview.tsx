import styles from "../../BrowserAccountsManagerV2.module.css";

import type {
  AccountRuntime,
  BrandOption,
  BrowserAccount,
} from "../types";

import { formatDate } from "../utils/format";

import {
  facebookIdentityMessage,
  loginStatusClass,
  readableStatus,
} from "../utils/status";

type AccountOverviewProps = {
  account: BrowserAccount;
  runtime: AccountRuntime;
  brands: BrandOption[];
};

export function AccountOverview({
  account,
  runtime,
  brands,
}: AccountOverviewProps) {
  const brandName =
    brands.find((brand) => brand.id === account.brandId)?.name ||
    "Not selected";

  return (
    <>
      <div
        className={styles.detailsHeader}
        id={`browser-account-${account.id}-overview`}
      >
        <div>
          <p className={styles.eyebrow}>Account Details</p>

          <h2>{account.displayName}</h2>

          <p>{account.browserProfileKey}</p>
        </div>

        <span
          className={[
            styles.largeStatus,
            loginStatusClass(account.loginStatus),
          ].join(" ")}
        >
          {readableStatus(account.loginStatus)}
        </span>
      </div>

      <div className={styles.metrics}>
        <article>
          <span>Browser</span>
          <strong>{runtime.running ? "RUNNING" : "STOPPED"}</strong>
        </article>

        <article>
          <span>Cookie</span>
          <strong>{readableStatus(account.cookieStatus)}</strong>
        </article>

        <article>
          <span>Proxy</span>
          <strong>{account.proxyType}</strong>
        </article>

        <article>
          <span>Pages</span>
          <strong>{account.channels.length}</strong>
        </article>
      </div>

      <div className={styles.identityStatusGrid}>
        <article>
          <span>BROWSER</span>

          <strong className={runtime.running ? styles.good : styles.neutral}>
            {runtime.loading
              ? "CHECKING"
              : runtime.running
                ? "RUNNING"
                : "STOPPED"}
          </strong>

          <small>
            {runtime.running
              ? "Remote Chromium session is active."
              : "Browser session is currently closed."}
          </small>
        </article>

        <article>
          <span>FACEBOOK IDENTITY</span>

          <strong className={loginStatusClass(account.loginStatus)}>
            {readableStatus(account.loginStatus)}
          </strong>

          <small>{facebookIdentityMessage(account.loginStatus)}</small>
        </article>
      </div>

      <dl className={styles.definitionList}>
        <div>
          <dt>Brand</dt>
          <dd>{brandName}</dd>
        </div>

        <div>
          <dt>Profile name</dt>
          <dd>{account.browserProfileName}</dd>
        </div>

        <div>
          <dt>Current URL</dt>
          <dd>{runtime.session?.currentUrl || "—"}</dd>
        </div>

        <div>
          <dt>Profile directory</dt>
          <dd>{runtime.session?.profileDirectory || "Created when opened"}</dd>
        </div>

        <div>
          <dt>Locale / Timezone</dt>
          <dd>
            {account.locale} / {account.timezone}
          </dd>
        </div>

        <div>
          <dt>Last login</dt>
          <dd>{formatDate(account.lastLoginAt)}</dd>
        </div>

        <div>
          <dt>Last verified</dt>
          <dd>{formatDate(account.lastVerifiedAt)}</dd>
        </div>

        <div>
          <dt>Last heartbeat</dt>
          <dd>{formatDate(account.lastHeartbeatAt)}</dd>
        </div>

        <div>
          <dt>Last error</dt>
          <dd>{account.lastLoginError || "—"}</dd>
        </div>
      </dl>
    </>
  );
}

import styles from "../../BrowserAccountsManagerV2.module.css";

import type { AccountRuntime, BrowserAccount } from "../types";

type AccountActionsProps = {
  account: BrowserAccount;
  runtime: AccountRuntime;
  onEdit: (account: BrowserAccount) => void;
  onOpenBrowser: (accountId: string) => Promise<unknown>;
  onVerifyLogin: (accountId: string) => Promise<unknown>;
  onCloseBrowser: (accountId: string) => Promise<unknown>;
  onError: (message: string) => void;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AccountActions({
  account,
  runtime,
  onEdit,
  onOpenBrowser,
  onVerifyLogin,
  onCloseBrowser,
  onError,
}: AccountActionsProps) {
  return (
    <div
      className={styles.actions}
      id={`browser-account-${account.id}-actions`}
    >
      <button
        className={styles.secondaryButton}
        type="button"
        disabled={runtime.loading}
        onClick={() => onEdit(account)}
      >
        Edit Account
      </button>

      <button
        className={styles.primaryButton}
        type="button"
        disabled={runtime.loading}
        onClick={() =>
          void onOpenBrowser(account.id).catch((error) =>
            onError(errorMessage(error, "Unable to open browser.")),
          )
        }
      >
        Open Browser
      </button>

      <button
        className={styles.secondaryButton}
        type="button"
        disabled={runtime.loading}
        onClick={() =>
          void onVerifyLogin(account.id).catch((error) =>
            onError(errorMessage(error, "Unable to verify login.")),
          )
        }
      >
        Verify Login
      </button>

      <button
        className={styles.dangerButton}
        type="button"
        disabled={runtime.loading || !runtime.running}
        onClick={() =>
          void onCloseBrowser(account.id).catch((error) =>
            onError(errorMessage(error, "Unable to close browser.")),
          )
        }
      >
        Close Browser
      </button>
    </div>
  );
}

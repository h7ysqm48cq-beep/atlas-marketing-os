import type { RefObject } from "react";

import styles from "../../BrowserAccountsManagerV2.module.css";

import type { AccountRuntime, BrowserAccount } from "../types";

type LiveBrowserViewerProps = {
  account: BrowserAccount;
  runtime: AccountRuntime;
  viewerUrl: string | null;
  viewerKey: number;
  viewerRef: RefObject<HTMLElement | null>;
  onReload: () => Promise<unknown>;
  onOpenNewTab: () => Promise<unknown>;
  onHide: () => void;
  onError: (message: string) => void;
};

export function LiveBrowserViewer({
  account,
  runtime,
  viewerUrl,
  viewerKey,
  viewerRef,
  onReload,
  onOpenNewTab,
  onHide,
  onError,
}: LiveBrowserViewerProps) {
  return (
    <section ref={viewerRef} className={styles.viewerPanel}>
      <div className={styles.viewerHeader}>
        <div>
          <p className={styles.eyebrow}>Live Browser</p>

          <h2>{account.displayName}</h2>

          <p>{runtime.session?.currentUrl || "Remote Chromium session"}</p>
        </div>

        <div className={styles.viewerActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => {
              void onReload().catch((error) => {
                onError(
                  error instanceof Error
                    ? error.message
                    : "Unable to reload Live Browser.",
                );
              });
            }}
          >
            Reload Viewer
          </button>

          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => {
              void onOpenNewTab().catch((error) => {
                onError(
                  error instanceof Error
                    ? error.message
                    : "Unable to open Live Browser.",
                );
              });
            }}
          >
            Open in New Tab
          </button>

          <button
            className={styles.dangerButton}
            type="button"
            onClick={onHide}
          >
            Hide Viewer
          </button>
        </div>
      </div>

      <div className={styles.viewerFrameWrap}>
        {viewerUrl ? (
          <iframe
            className={styles.viewerFrame}
            key={viewerKey}
            src={viewerUrl}
            title={`${account.displayName} browser viewer`}
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : (
          <div className={styles.previewEmpty}>
            Authorizing secure Live Browser…
          </div>
        )}
      </div>
    </section>
  );
}

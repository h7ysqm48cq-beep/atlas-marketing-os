import type { Page } from "playwright-core";

type PreparedPageOwner = {
  preparedPage?: Pick<Page, "isClosed" | "close"> | null;
};

export async function releasePreparedPage(owner: PreparedPageOwner) {
  const page = owner.preparedPage;
  owner.preparedPage = null;

  if (!page || page.isClosed()) {
    return;
  }

  await page.close().catch(() => undefined);
}

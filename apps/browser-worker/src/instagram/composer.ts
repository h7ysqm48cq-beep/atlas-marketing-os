import type { Locator, Page } from "playwright-core";

export async function openInstagramComposer(page: Page) {
  const triggers = [
    page.locator('a[href="/create/select/"]'),
    page.locator('[aria-label="New post"]'),
    page.locator('svg[aria-label="New post"]').locator(".."),
    page.getByText(/^Create$/i),
  ];

  for (const trigger of triggers) {
    const count = await trigger.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = trigger.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      if (await candidate.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
        await page.waitForTimeout(800);

        // Instagram can open a create-type menu before it mounts the upload
        // input. Select the regular Post option when that intermediate menu
        // is present, then wait for the actual composer to be ready.
        if (!(await hasInstagramFileInput(page, 2500))) {
          await clickInstagramPostOption(page);
          await clickInstagramUploadTrigger(page);
        }

        if (await hasInstagramFileInput(page, 15000)) {
          return findInstagramDialog(page);
        }

        throw new Error("Instagram upload control was not found after opening the Post composer.");
      }
    }
  }

  throw new Error("Instagram create-post control was not found.");
}

async function hasInstagramFileInput(page: Page, timeout: number) {
  const input = page.locator('input[type="file"]').last();

  return input
    .waitFor({ state: "attached", timeout })
    .then(() => true)
    .catch(() => false);
}

async function clickInstagramPostOption(page: Page) {
  const choices = [
    page.getByRole("menuitem", { name: /^Post$/i }),
    page.getByRole("button", { name: /^Post$/i }),
    page.getByRole("link", { name: /^Post$/i }),
    page.locator('[role="dialog"]').getByText(/^Post$/i),
    page.getByText(/^Post$/i),
  ];

  for (const choice of choices) {
    const count = await choice.count().catch(() => 0);

    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = choice.nth(index);

      if (!(await candidate.isVisible().catch(() => false))) continue;

      if (await candidate.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
        await page.waitForTimeout(800);
        return true;
      }
    }
  }

  return false;
}

async function clickInstagramUploadTrigger(page: Page) {
  const triggers = [
    page.getByRole("button", { name: /select from computer|choose from computer/i }),
    page.getByText(/^Select from computer$/i),
    page.getByText(/^Choose from computer$/i),
  ];

  for (const trigger of triggers) {
    const count = await trigger.count().catch(() => 0);

    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = trigger.nth(index);

      if (!(await candidate.isVisible().catch(() => false))) continue;

      if (await candidate.click({ timeout: 5000 }).then(() => true).catch(() => false)) {
        await page.waitForTimeout(500);
        return true;
      }
    }
  }

  return false;
}

export async function attachInstagramMedia(page: Page, imagePaths: string | string[]) {
  const input = page.locator('input[type="file"]').last();
  await input.waitFor({ state: "attached", timeout: 10000 });
  const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  await input.setInputFiles(paths);
  await page.waitForTimeout(1200);
  return paths.length;
}

export async function fillInstagramCaption(page: Page, caption: string) {
  const expected = caption.trim();
  if (!expected) throw new Error("Instagram caption cannot be empty.");

  const editors = [
    page.locator('textarea[aria-label*="caption" i]'),
    page.locator('textarea[placeholder*="caption" i]'),
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"]'),
  ];

  for (const locator of editors) {
    const count = await locator.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const editor = locator.nth(index);
      if (!(await editor.isVisible().catch(() => false))) continue;
      if (await editor.getAttribute("aria-label").then((value) => /comment|reply/i.test(value || "")).catch(() => false)) continue;
      await editor.fill(expected).catch(async () => {
        await editor.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type(expected);
      });
      return editor;
    }
  }

  throw new Error("Instagram caption editor was not found.");
}

export function findInstagramDialog(page: Page): Locator {
  return page.locator('[role="dialog"]').last();
}

export async function clickInstagramNext(page: Page) {
  const next = page.getByRole("button", { name: /^Next$/i }).last();
  if (await next.isVisible().catch(() => false)) {
    await next.click({ timeout: 5000 });
    await page.waitForTimeout(900);
    return true;
  }
  return false;
}

export async function clickInstagramShare(page: Page) {
  const share = page.getByRole("button", { name: /^Share$/i }).last();
  if (!(await share.isVisible().catch(() => false))) {
    throw new Error("Instagram Share button was not found.");
  }
  await share.click({ timeout: 5000 });

  // Instagram can take several seconds to replace the composer with the
  // confirmation state. Poll the rendered page so a successful post is not
  // reported as a false failure during the transition.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    if (/post shared|your post has been shared|shared|posted/.test(bodyText)) {
      return true;
    }
    await page.waitForTimeout(1000);
  }

  return false;
}

import assert from "node:assert/strict";
import test from "node:test";
import type {
  Locator,
  Page,
} from "playwright-core";
import {
  countFacebookComposerImagePreviewCandidates,
  isFacebookComposerImagePreviewCandidate,
  normalizeFacebookComposerImagePreviewSource,
  uploadFacebookComposerImages,
  type FacebookComposerImagePreviewCandidate,
} from "./composer.js";

const createCandidate = (
  overrides: Partial<FacebookComposerImagePreviewCandidate> = {},
): FacebookComposerImagePreviewCandidate => ({
  tagName: "IMG",
  role: null,
  sourceType: "IMG",
  source: "blob:https://www.facebook.com/upload-preview",
  display: "block",
  visibility: "visible",
  opacity: 1,
  width: 640,
  height: 640,
  naturalWidth: 1200,
  naturalHeight: 1200,
  ...overrides,
});

test("accepts a visible large Facebook img preview", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate(),
    ),
    true,
  );
});

test("accepts a visible Facebook background-image preview", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        tagName: "DIV",
        role: "img",
        sourceType: "BACKGROUND",
        source:
          'url("blob:https://www.facebook.com/background-preview")',
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ),
    true,
  );
});

test("rejects small avatars and emoji images", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        width: 40,
        height: 40,
      }),
    ),
    false,
  );
});

test("rejects hidden or transparent candidates", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        display: "none",
      }),
    ),
    false,
  );
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        opacity: 0,
      }),
    ),
    false,
  );
});

test("rejects unloaded and broken img candidates", () => {
  assert.equal(
    isFacebookComposerImagePreviewCandidate(
      createCandidate({
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ),
    false,
  );
});

test("normalizes CSS url preview sources", () => {
  assert.equal(
    normalizeFacebookComposerImagePreviewSource(
      'url("blob:https://www.facebook.com/preview")',
    ),
    "blob:https://www.facebook.com/preview",
  );
});

test("counts one upload once when img and background wrappers share a source", () => {
  assert.equal(
    countFacebookComposerImagePreviewCandidates([
      createCandidate({
        source:
          "blob:https://www.facebook.com/shared-preview",
      }),
      createCandidate({
        tagName: "DIV",
        role: "img",
        sourceType: "BACKGROUND",
        source:
          'url("blob:https://www.facebook.com/shared-preview")',
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ]),
    1,
  );
});

type MockLocatorOptions = {
  count?: number;
  visible?: boolean;
  accept?: string | null;
  multiple?: boolean;
  retainedFileCount?: number;
  onClick?: () => void;
  onSetInputFiles?: (
    imagePaths: string[],
  ) => void;
};

const createMockLocator = (
  options: MockLocatorOptions = {},
): Locator => {
  const locator = {
    count: async () =>
      options.count ?? 1,
    nth: () => locator,
    isVisible: async () =>
      options.visible ?? true,
    click: async () => {
      options.onClick?.();
    },
    getAttribute: async (
      name: string,
    ) => {
      if (name === "accept") {
        return options.accept ?? null;
      }

      if (name === "multiple") {
        return options.multiple
          ? ""
          : null;
      }

      return null;
    },
    setInputFiles: async (
      imagePaths: string[],
    ) => {
      options.onSetInputFiles?.(
        imagePaths,
      );
    },
    evaluate: async () =>
      options.retainedFileCount ?? 0,
  };

  return locator as unknown as Locator;
};

const createUploadDialog = (input: {
  photoButton: Locator;
  fileInputs?: Locator;
}) => ({
  getByRole: () =>
    input.photoButton,
  locator: (selector: string) => {
    if (
      selector ===
      'input[type="file"]'
    ) {
      return (
        input.fileInputs ||
        createMockLocator({
          count: 0,
        })
      );
    }

    return createMockLocator({
      count: 0,
    });
  },
}) as unknown as Locator;

test("prefers the Photo/video file chooser and verifies the chooser input", async () => {
  const selectedPaths:
    string[][] = [];
  let photoButtonClicks = 0;

  const chooserInput =
    createMockLocator({
      accept:
        "image/*,video/*",
      retainedFileCount: 2,
    });
  const chooser = {
    setFiles: async (
      imagePaths: string[],
    ) => {
      selectedPaths.push(
        imagePaths,
      );
    },
    element: () =>
      chooserInput,
    isMultiple: () =>
      true,
  };
  const page = {
    waitForEvent: async () =>
      chooser,
  } as unknown as Page;
  const dialog =
    createUploadDialog({
      photoButton:
        createMockLocator({
          onClick: () => {
            photoButtonClicks += 1;
          },
        }),
    });

  const result =
    await uploadFacebookComposerImages(
      page,
      dialog,
      [
        "/tmp/one.jpg",
        "/tmp/two.jpg",
      ],
    );

  assert.equal(
    result.strategy,
    "PHOTO_VIDEO_FILE_CHOOSER",
  );
  assert.equal(
    result.inputFileCount,
    2,
  );
  assert.equal(
    result.photoButtonClicked,
    true,
  );
  assert.equal(
    photoButtonClicks,
    1,
  );
  assert.deepEqual(
    selectedPaths,
    [[
      "/tmp/one.jpg",
      "/tmp/two.jpg",
    ]],
  );
});

test("falls back only to the active composer image input when no chooser opens", async () => {
  const selectedPaths:
    string[][] = [];
  const fileInput =
    createMockLocator({
      accept:
        ".jpg,.png",
      multiple: true,
      retainedFileCount: 1,
      onSetInputFiles: (
        imagePaths,
      ) => {
        selectedPaths.push(
          imagePaths,
        );
      },
    });
  const page = {
    waitForEvent: async () => {
      throw new Error(
        "No file chooser",
      );
    },
  } as unknown as Page;
  const dialog =
    createUploadDialog({
      photoButton:
        createMockLocator(),
      fileInputs:
        fileInput,
    });

  const result =
    await uploadFacebookComposerImages(
      page,
      dialog,
      ["/tmp/one.jpg"],
    );

  assert.equal(
    result.strategy,
    "COMPOSER_FILE_INPUT",
  );
  assert.equal(
    result.inputFileCount,
    1,
  );
  assert.equal(
    result.photoButtonClicked,
    true,
  );
  assert.deepEqual(
    selectedPaths,
    [["/tmp/one.jpg"]],
  );
});

test("rejects a chooser that does not retain every selected image", async () => {
  const chooserInput =
    createMockLocator({
      accept: "image/*",
      retainedFileCount: 0,
    });
  const page = {
    waitForEvent: async () => ({
      setFiles: async () =>
        undefined,
      element: () =>
        chooserInput,
      isMultiple: () =>
        true,
    }),
  } as unknown as Page;
  const dialog =
    createUploadDialog({
      photoButton:
        createMockLocator(),
    });

  await assert.rejects(
    uploadFacebookComposerImages(
      page,
      dialog,
      ["/tmp/one.jpg"],
    ),
    /file chooser did not retain all selected images/i,
  );
});

test("does not use unrelated page-level file inputs", async () => {
  const page = {
    waitForEvent: async () => {
      throw new Error(
        "No file chooser",
      );
    },
  } as unknown as Page;
  const dialog =
    createUploadDialog({
      photoButton:
        createMockLocator({
          count: 0,
        }),
    });

  await assert.rejects(
    uploadFacebookComposerImages(
      page,
      dialog,
      ["/tmp/one.jpg"],
    ),
    /Photo\/video control was not found in the active composer/i,
  );
});

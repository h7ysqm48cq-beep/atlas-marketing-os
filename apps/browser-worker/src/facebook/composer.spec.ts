import assert from "node:assert/strict";
import test from "node:test";
import type {
  Locator,
  Page,
} from "playwright-core";
import {
  countFacebookComposerImagePreviewCandidates,
  FacebookComposerImageUploadError,
  findFacebookCreatePostDialog,
  isFacebookComposerImagePreviewCandidate,
  normalizeFacebookComposerImagePreviewSource,
  uploadFacebookComposerImages,
  type FacebookComposerImagePreviewCandidate,
  type FacebookComposerMediaControlDiagnostics,
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
  rowControl?: Locator;
  rowDiagnostics?:
    FacebookComposerMediaControlDiagnostics;
  evaluationError?: Error;
}) => ({
  evaluate: async () => {
    if (input.evaluationError) {
      throw input.evaluationError;
    }

    return input.rowDiagnostics || {
      anchorFound: false,
      anchorText: null,
      evaluationError: null,
      strategy: null,
      candidates: [],
      selected: null,
    };
  },
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

    if (
      selector ===
      '[data-atlas-facebook-media-control="selected"]'
    ) {
      return (
        input.rowControl ||
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

test("uses the first interactive media control on the Add to your post row", async () => {
  const selectedPaths:
    string[][] = [];
  let rowControlClicks = 0;
  const selectedCandidate = {
    depth: 2,
    index: 0,
    tagName: "DIV",
    role: "button",
    ariaLabel: null,
    text: "",
    tabIndex: 0,
    disabled: false,
    visible: true,
    sameRow: true,
    rightOfAnchor: true,
    rect: {
      x: 410,
      y: 620,
      width: 36,
      height: 36,
    },
  };
  const chooserInput =
    createMockLocator({
      accept: "image/*",
      retainedFileCount: 1,
    });
  const page = {
    waitForEvent: async () => ({
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
    }),
  } as unknown as Page;
  const dialog =
    createUploadDialog({
      photoButton:
        createMockLocator({
          count: 0,
        }),
      rowControl:
        createMockLocator({
          onClick: () => {
            rowControlClicks += 1;
          },
        }),
      rowDiagnostics: {
        anchorFound: true,
        anchorText:
          "Add to your post",
        evaluationError: null,
        strategy:
          "ADD_TO_YOUR_POST_ROW",
        candidates: [
          selectedCandidate,
        ],
        selected:
          selectedCandidate,
      },
    });

  const result =
    await uploadFacebookComposerImages(
      page,
      dialog,
      ["/tmp/one.jpg"],
    );

  assert.equal(
    rowControlClicks,
    1,
  );
  assert.equal(
    result.controlDiagnostics
      .strategy,
    "ADD_TO_YOUR_POST_ROW",
  );
  assert.deepEqual(
    result.controlDiagnostics
      .selected,
    selectedCandidate,
  );
  assert.deepEqual(
    selectedPaths,
    [["/tmp/one.jpg"]],
  );
});

test("preserves the original media-control evaluation error", async () => {
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
      evaluationError:
        new Error(
          "Target page, context or browser has been closed",
        ),
    });

  await assert.rejects(
    uploadFacebookComposerImages(
      page,
      dialog,
      ["/tmp/one.jpg"],
    ),
    (error: unknown) => {
      assert.ok(
        error instanceof
          FacebookComposerImageUploadError,
      );
      assert.match(
        error.diagnostics
          .evaluationError || "",
        /Target page, context or browser has been closed/,
      );
      return true;
    },
  );
});

test("finds the active Create post dialog with a semantic locator", async () => {
  const selectors: string[] = [];
  let nthCalled = false;
  const semanticDialog = {
    filter: () =>
      semanticDialog,
    first: () =>
      semanticDialog,
    count: async () => 1,
    isVisible: async () => true,
    nth: () => {
      nthCalled = true;
      return semanticDialog;
    },
  } as unknown as Locator;
  const page = {
    locator: (selector: string) => {
      selectors.push(selector);
      return semanticDialog;
    },
    waitForTimeout: async () =>
      undefined,
  } as unknown as Page;

  const result =
    await findFacebookCreatePostDialog(
      page,
      100,
    );

  assert.equal(
    result,
    semanticDialog,
  );
  assert.equal(
    nthCalled,
    false,
  );
  assert.deepEqual(
    selectors,
    [
      [
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="plaintext-only"][role="textbox"]',
        '[contenteditable="true"][data-lexical-editor="true"]',
        '[contenteditable="true"][aria-label]',
        '[contenteditable="true"][aria-placeholder]',
        '[role="textbox"][aria-label*="mind" i]',
        '[contenteditable="true"]',
      ].join(", "),
      [
        '[aria-label*="Photo" i]',
        '[aria-label*="Video" i]',
        'input[type="file"][accept*="image" i]',
      ].join(", "),
      '[role="dialog"]:visible',
    ],
  );
});

test("accepts one unambiguous localized dialog with an editor variant", async () => {
  const uniqueDialog = {
    isVisible: async () => true,
  } as unknown as Locator;
  const noMatch = {
    first: () => noMatch,
    count: async () => 0,
    isVisible: async () => false,
  } as unknown as Locator;
  const editorDialogs = {
    filter: () => noMatch,
    first: () => uniqueDialog,
    count: async () => 1,
  } as unknown as Locator;
  const visibleDialogs = {
    filter: () => editorDialogs,
  } as unknown as Locator;
  const genericLocator = {} as Locator;
  const page = {
    locator: (selector: string) =>
      selector ===
      '[role="dialog"]:visible'
        ? visibleDialogs
        : genericLocator,
    waitForTimeout: async () =>
      undefined,
  } as unknown as Page;

  const result =
    await findFacebookCreatePostDialog(
      page,
      100,
    );

  assert.equal(
    result,
    uniqueDialog,
  );
});

test("accepts a full-page composer with one visible editor", async () => {
  const editorSelector = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="plaintext-only"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"][aria-label]',
    '[contenteditable="true"][aria-placeholder]',
    '[role="textbox"][aria-label*="mind" i]',
    '[contenteditable="true"]',
  ].join(", ");
  const uniqueEditor = {
    count: async () => 1,
  } as unknown as Locator;
  const noMatch = {
    first: () => noMatch,
    filter: () => noMatch,
    count: async () => 0,
    isVisible: async () => false,
  } as unknown as Locator;
  const body = {
    isVisible: async () => true,
  } as unknown as Locator;
  const page = {
    locator: (selector: string) => {
      if (selector === editorSelector) {
        return uniqueEditor;
      }

      if (selector === `${editorSelector}:visible`) {
        return uniqueEditor;
      }

      if (selector === "body") {
        return body;
      }

      return noMatch;
    },
    waitForTimeout: async () => undefined,
  } as unknown as Page;

  const result = await findFacebookCreatePostDialog(page, 100);

  assert.equal(result, body);
});

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

test("defers a consumed chooser input to composer preview verification", async () => {
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

  const result =
    await uploadFacebookComposerImages(
      page,
      dialog,
      ["/tmp/one.jpg"],
    );

  assert.equal(
    result.strategy,
    "PHOTO_VIDEO_FILE_CHOOSER",
  );
  assert.equal(
    result.expectedFileCount,
    1,
  );
  assert.equal(
    result.inputFileCount,
    0,
  );
});

test("defers a consumed composer-scoped input to preview verification", async () => {
  const fileInput =
    createMockLocator({
      accept: "image/*",
      retainedFileCount: 0,
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
    result.expectedFileCount,
    1,
  );
  assert.equal(
    result.inputFileCount,
    0,
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

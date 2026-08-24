import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFacebookPublishedPostReference,
  createFacebookCaptionFingerprint,
  extractFacebookPageId,
} from "./published-post.js";

test("uses the first content line as the caption fingerprint", () => {
  assert.equal(
    createFacebookCaptionFingerprint(
      "🏢 M BUSINESS｜M STORY 016\n\n麦当劳的成功关键",
    ),
    "M BUSINESS｜M STORY 016",
  );
});

test("extracts a numeric Facebook page id", () => {
  assert.equal(
    extractFacebookPageId(
      "https://www.facebook.com/profile.php?id=61592884960509",
    ),
    "61592884960509",
  );
});

test("prefers a multi-image pcb set as the published post id", () => {
  assert.deepEqual(
    buildFacebookPublishedPostReference(
      "https://www.facebook.com/profile.php?id=61592884960509",
      [
        "/photo/?fbid=122112144357429498&set=pcb.122112144501429498",
        "/photo/?fbid=122112144327429498&set=pcb.122112144501429498",
      ],
    ),
    {
      pageId: "61592884960509",
      facebookPostId: "122112144501429498",
      externalPostId: "61592884960509_122112144501429498",
      postUrl:
        "https://www.facebook.com/permalink.php?story_fbid=122112144501429498&id=61592884960509",
      matchedBy: "photo-set",
    },
  );
});

test("supports text-only post permalinks", () => {
  assert.equal(
    buildFacebookPublishedPostReference(
      "https://www.facebook.com/61592884960509",
      ["/61592884960509/posts/122112144501429498/"],
    )?.externalPostId,
    "61592884960509_122112144501429498",
  );
});

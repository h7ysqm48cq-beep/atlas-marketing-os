import assert from "node:assert/strict";
import test from "node:test";

import {
  filterFacebookPageCandidates,
} from "./page-discovery";

test("filters Facebook composer and notification anchors from discovered Pages", () => {
  const validPage = {
    pageId: "61588932607346",
    name: "专治你没瓜看",
    url: "https://www.facebook.com/profile.php?id=61588932607346",
    imageUrl: "https://example.com/page.jpg",
  };

  assert.deepEqual(
    filterFacebookPageCandidates([
      {
        pageId: "1281719171682210",
        name: "Create Post",
        url: "https://www.facebook.com/profile.php?id=1281719171682210&modal=composer",
        imageUrl: null,
      },
      {
        pageId: "1292937667230187",
        name: "UnreadWelcome to 大马吹水总会",
        url: "https://www.facebook.com/profile.php?id=1292937667230187",
        imageUrl: null,
      },
      {
        pageId: "1152201331300072",
        name: "A real Page with a composer link",
        url: "https://www.facebook.com/profile.php?id=1152201331300072&modal=composer",
        imageUrl: null,
      },
      validPage,
    ]),
    [validPage],
  );
});

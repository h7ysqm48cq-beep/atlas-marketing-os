require("dotenv").config();

const fs = require("fs");
const path = require("path");

const candidates = [
  path.resolve(
    __dirname,
    "../dist/copilot/conversation-recall-context.builder.js",
  ),
  path.resolve(
    __dirname,
    "../dist/src/copilot/conversation-recall-context.builder.js",
  ),
];

const compiledBuilderPath = candidates.find(
  (candidate) => fs.existsSync(candidate),
);

if (!compiledBuilderPath) {
  throw new Error(
    [
      "Compiled ConversationRecallContextBuilder not found.",
      "Run npm run build --workspace apps/api first.",
      ...candidates,
    ].join("\n"),
  );
}

const {
  ConversationRecallContextBuilder,
} = require(compiledBuilderPath);

const builder = new ConversationRecallContextBuilder();

let passed = 0;
let failed = 0;

function test(name, messages, expectations) {
  console.log("\n========================================");
  console.log(name);

  const result = builder.buildMessages(messages);

  console.log("\nRESULT:");
  console.log(result);

  const errors = [];

  for (const expectation of expectations) {
    if (
      expectation.includes &&
      !result.includes(expectation.includes)
    ) {
      errors.push(
        `Expected output to contain: ${expectation.includes}`,
      );
    }

    if (
      expectation.excludes &&
      result.includes(expectation.excludes)
    ) {
      errors.push(
        `Expected output NOT to contain: ${expectation.excludes}`,
      );
    }
  }

  if (errors.length) {
    failed++;

    console.log("\n✗ FAILED");

    for (const error of errors) {
      console.log(`  ${error}`);
    }

    return;
  }

  passed++;
  console.log("\n✓ PASSED");
}

/*
 * CASE 1
 *
 * Assistant gives the wrong answer.
 * User explicitly corrects it.
 * Recall should start from the correction.
 */
test(
  "CASE 1 — Wrong answer -> user correction -> corrected answer",
  [
    {
      role: "USER",
      content: "M MARKET 是什么方向？",
    },
    {
      role: "ASSISTANT",
      content: "M MARKET 是生活好物和优惠资讯。",
    },
    {
      role: "USER",
      content:
        "你又忘记了，M MARKET 是金融、经济与市场变化。",
    },
    {
      role: "ASSISTANT",
      content:
        "对，M MARKET = 金融、经济与市场变化。",
    },
  ],
  [
    {
      includes: "USER CORRECTION",
    },
    {
      includes: "金融、经济与市场变化",
    },
    {
      excludes: "生活好物和优惠资讯",
    },
  ],
);

/*
 * CASE 2
 *
 * Earlier draft is replaced by a later user decision.
 */
test(
  "CASE 2 — Draft -> user changes decision -> latest version wins",
  [
    {
      role: "ASSISTANT",
      content:
        "建议栏目名称叫 M Future。",
    },
    {
      role: "USER",
      content:
        "改成 M NEXT，以这个为准。",
    },
    {
      role: "ASSISTANT",
      content:
        "收到，之后使用 M NEXT。",
    },
  ],
  [
    {
      includes: "USER CORRECTION",
    },
    {
      includes: "USER CONFIRMATION",
    },
    {
      includes: "M NEXT",
    },
    {
      excludes: "M Future",
    },
  ],
);

/*
 * CASE 3
 *
 * Assistant suggestion is not automatically a user preference.
 *
 * It may remain conversational context, but it must NOT be
 * labelled as a user confirmation.
 */
test(
  "CASE 3 — Assistant suggestion without user confirmation",
  [
    {
      role: "USER",
      content: "这个图片可以怎么设计？",
    },
    {
      role: "ASSISTANT",
      content:
        "我建议以后所有图片都使用黑金风格。",
    },
  ],
  [
    {
      includes: "我建议以后所有图片都使用黑金风格",
    },
    {
      excludes: "USER CONFIRMATION",
    },
  ],
);

/*
 * CASE 4
 *
 * Explicit user confirmation should be preserved and labelled.
 */
test(
  "CASE 4 — Explicit confirmed decision",
  [
    {
      role: "ASSISTANT",
      content:
        "Logo 可以保持右下角小尺寸。",
    },
    {
      role: "USER",
      content:
        "对，就是这个，以这个为准，记住。",
    },
    {
      role: "ASSISTANT",
      content:
        "收到，之后 Logo 保持右下角小尺寸。",
    },
  ],
  [
    {
      includes: "USER CONFIRMATION",
    },
    {
      includes: "以这个为准",
    },
    {
      includes: "Logo 保持右下角小尺寸",
    },
  ],
);

/*
 * CASE 5
 *
 * Multiple corrections.
 * The LAST explicit correction must win.
 */
test(
  "CASE 5 — Multiple corrections -> latest correction wins",
  [
    {
      role: "USER",
      content:
        "星期五做 M MARKET。",
    },
    {
      role: "ASSISTANT",
      content:
        "收到，星期五是 M MARKET。",
    },
    {
      role: "USER",
      content:
        "不对，星期五应该是 M CONSUMER。",
    },
    {
      role: "ASSISTANT",
      content:
        "收到，星期五是 M CONSUMER。",
    },
    {
      role: "USER",
      content:
        "以这个为准，星期六才是 M MARKET。",
    },
    {
      role: "ASSISTANT",
      content:
        "确认，星期五 M CONSUMER，星期六 M MARKET。",
    },
  ],
  [
    {
      includes: "USER CONFIRMATION",
    },
    {
      includes: "星期六才是 M MARKET",
    },
    {
      includes:
        "星期五 M CONSUMER，星期六 M MARKET",
    },
    {
      excludes: "星期五应该是 M CONSUMER",
    },
  ],
);

console.log("\n========================================");
console.log("CORRECTION ACCEPTANCE SUMMARY");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(
    "✓ Correction-aware conversation recall accepted",
  );
}

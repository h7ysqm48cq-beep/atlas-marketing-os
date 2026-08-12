require('dotenv').config();

const BASE_URL =
  process.env.ATLAS_API_URL ||
  process.env.API_URL ||
  'http://localhost:3001';

const TESTS = [
  {
    name: 'M-series weekly schedule recall',
    message:
      '我们之前已经讨论过每周 M 系列的栏目安排。不要重新设计，请直接告诉我星期一到星期日分别是什么。',
  },
  {
    name: 'MGM visual style recall',
    message:
      '我们之前已经讨论过满贯门图片和 Logo 的风格。不要重新设计，请根据之前讨论的内容总结。',
  },
  {
    name: 'M CONSUMER continuation',
    message:
      '继续我们之前的 M CONSUMER 方向。先告诉我之前讨论的核心定位和内容方向，不要重新设计。',
  },
  {
    name: 'Historical correction handling',
    message:
      'M MARKET 之前讨论过什么方向？请以我们后来确认和纠正过的版本为准。',
  },
  {
    name: 'Unconfirmed assistant suggestion protection',
    message:
      '根据我们之前已经确认的图片偏好，总结满贯门视觉规则。不要把你以前只是建议、但我没有确认的内容当成我的偏好。',
  },
];

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}\n${
        typeof data === 'string'
          ? data
          : JSON.stringify(data, null, 2)
      }`,
    );
  }

  return data;
}

async function runTest(test, index) {
  console.log('\n========================================');
  console.log(`CASE ${index + 1} — ${test.name}`);
  console.log('========================================');

  console.log('\nUSER:');
  console.log(test.message);

  try {
    const result = await request('/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'chat',
        messages: [
          {
            role: 'user',
            content: test.message,
          },
        ],
      }),
    });

    const reply =
      result?.reply ||
      result?.response ||
      result?.message ||
      result?.content ||
      null;

    console.log('\nELENA:');

    if (reply) {
      console.log(reply);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    console.log('\n✓ REQUEST COMPLETED');

    return {
      name: test.name,
      success: true,
      reply,
      raw: result,
    };
  } catch (error) {
    console.log('\n✗ REQUEST FAILED');
    console.log(
      error instanceof Error ? error.message : String(error),
    );

    return {
      name: test.name,
      success: false,
      error:
        error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log('========================================');
  console.log('ATLAS RECALL E2E ACCEPTANCE');
  console.log('========================================');
  console.log(`API: ${BASE_URL}`);

  const results = [];

  for (let i = 0; i < TESTS.length; i++) {
    results.push(await runTest(TESTS[i], i));
  }

  const completed = results.filter(
    (result) => result.success,
  ).length;

  console.log('\n========================================');
  console.log('E2E REQUEST SUMMARY');
  console.log('========================================');
  console.log(`Completed: ${completed}/${results.length}`);
  console.log(`Failed: ${results.length - completed}`);

  if (completed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

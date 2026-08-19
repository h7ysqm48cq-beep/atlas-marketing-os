const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const apiRoot = join(__dirname, '..');
const copilotDir = join(apiRoot, 'src', 'copilot');

const legacyFiles = [
  'jobs/copilot-job.processor.ts',
  'jobs/copilot-job.service.ts',
  'jobs/copilot-job.controller.ts',
];

for (const file of legacyFiles) {
  if (existsSync(join(copilotDir, file))) {
    throw new Error(`Legacy Copilot background-job implementation detected: ${file}`);
  }
}

const workerSource = readFileSync(
  join(copilotDir, 'copilot-background-job.service.ts'),
  'utf8',
);

for (const forbidden of ['@Interval(', 'setInterval(', "from '@nestjs/schedule'"]) {
  if (workerSource.includes(forbidden)) {
    throw new Error(`Periodic BackgroundJob polling is forbidden: ${forbidden}`);
  }
}

if (!workerSource.includes('this.requestProcessing();')) {
  throw new Error('Canonical Copilot worker must be event-triggered via requestProcessing().');
}

const moduleSource = readFileSync(join(copilotDir, 'copilot.module.ts'), 'utf8');

for (const forbidden of ['CopilotJobProcessor', 'CopilotJobService', 'CopilotJobController']) {
  if (moduleSource.includes(forbidden)) {
    throw new Error(`Legacy Copilot worker registration detected: ${forbidden}`);
  }
}

if (!moduleSource.includes('CopilotBackgroundJobService')) {
  throw new Error('Canonical CopilotBackgroundJobService is not registered.');
}

console.log('Background job regression guard passed.');

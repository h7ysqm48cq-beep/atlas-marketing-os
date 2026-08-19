import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Copilot background job regression guards', () => {
  const copilotDir = __dirname;

  it('does not keep the legacy competing worker implementation', () => {
    const legacyFiles = [
      'jobs/copilot-job.processor.ts',
      'jobs/copilot-job.service.ts',
      'jobs/copilot-job.controller.ts',
    ];

    for (const file of legacyFiles) {
      expect(existsSync(join(copilotDir, file))).toBe(false);
    }
  });

  it('does not periodically poll BackgroundJob', () => {
    const source = readFileSync(
      join(copilotDir, 'copilot-background-job.service.ts'),
      'utf8',
    );

    expect(source).not.toContain('@Interval(');
    expect(source).not.toContain('setInterval(');
    expect(source).not.toContain("from '@nestjs/schedule'");
    expect(source).toContain('this.requestProcessing();');
  });

  it('registers only the canonical Copilot background job service', () => {
    const source = readFileSync(
      join(copilotDir, 'copilot.module.ts'),
      'utf8',
    );

    expect(source).toContain('CopilotBackgroundJobService');
    expect(source).not.toContain('CopilotJobProcessor');
    expect(source).not.toContain('CopilotJobService');
    expect(source).not.toContain('CopilotJobController');
  });
});

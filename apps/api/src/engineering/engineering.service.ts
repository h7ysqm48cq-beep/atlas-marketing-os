import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  execFile,
} from 'node:child_process';
import {
  promisify,
} from 'node:util';
import {
  resolve,
} from 'node:path';

import {
  AnalyzeEngineeringRequestDto,
} from './dto/analyze-engineering-request.dto';

const execFileAsync = promisify(execFile);

type EngineeringCliResult = {
  success: boolean;
  intent?: Record<string, unknown>;
  adaptation?: Record<string, unknown> | null;
  engineering_plan?: Record<string, unknown> | null;
  engineer_result?: Record<string, unknown> | null;
  requires_review?: boolean;
  executed?: boolean;
  error?: string | null;
};

@Injectable()
export class EngineeringService {
  async analyze(
    input: AnalyzeEngineeringRequestDto,
  ): Promise<EngineeringCliResult> {
    const repositoryRoot = resolve(
      process.cwd(),
      '../../',
    );

    const requestedRoot = input.projectRoot
      ? resolve(input.projectRoot)
      : repositoryRoot;

    if (
      requestedRoot !== repositoryRoot
    ) {
      throw new BadRequestException(
        'Engineering analysis is limited to the Atlas repository.',
      );
    }

    const pythonCommand =
      process.env.ATLAS_PYTHON_COMMAND ||
      'python3';

    try {
      const {
        stdout,
        stderr,
      } = await execFileAsync(
        pythonCommand,
        [
          '-m',
          'tools.ai_engineer.cli',
          '--project',
          repositoryRoot,
          '--text',
          input.text,
          '--mode',
          'plan',
        ],
        {
          cwd: repositoryRoot,
          timeout: 120_000,
          maxBuffer:
            10 * 1024 * 1024,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
        },
      );

      if (!stdout.trim()) {
        throw new Error(
          stderr.trim() ||
            'Engineering CLI returned no output.',
        );
      }

      const result = JSON.parse(
        stdout,
      ) as EngineeringCliResult;

      if (!result.success) {
        throw new BadRequestException(
          result.error ||
            'Engineering analysis failed.',
        );
      }

      return result;
    } catch (error) {
      if (
        error instanceof
        BadRequestException
      ) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Engineering analysis failed.';

      throw new InternalServerErrorException(
        message,
      );
    }
  }
}

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { SupervisorSystemController } from './supervisor-system.controller';
import {
  SUPERVISOR_SYSTEM_PURPOSE,
  SupervisorSystemGuard,
} from './supervisor-system.guard';

describe('SupervisorSystemController auth surface', () => {
  it('bypasses user-session auth but still requires the system assertion guard', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        SupervisorSystemController,
      ),
    ).toBe(true);

    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        SupervisorSystemController,
      ),
    ).toEqual([SupervisorSystemGuard]);

    expect(
      Reflect.getMetadata(
        SUPERVISOR_SYSTEM_PURPOSE,
        SupervisorSystemController.prototype.admit,
      ),
    ).toBe('ADMISSION');
  });
});

import { datadogLogPayload } from './datadog-log';

describe('datadogLogPayload', () => {
  it('builds a service-scoped log payload', () => {
    expect(datadogLogPayload('atlas-api', 'production', 'error', 'failed')).toEqual({
      message: 'failed', service: 'atlas-api', ddsource: 'nodejs', ddtags: 'env:production', status: 'error',
    });
  });
});

import { Injectable } from '@nestjs/common';

@Injectable()
export class GrowthService {
  getStatus() {
    return {
      engine: 'Atlas Growth Engine',
      version: '1.0',
      status: 'ready',
      capabilities: {
        audience: true,
        leads: true,
        scoring: true,
        analytics: true,
      },
    };
  }
}

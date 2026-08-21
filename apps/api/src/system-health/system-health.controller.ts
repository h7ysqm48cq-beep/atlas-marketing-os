
import { Controller, Get } from "@nestjs/common";
import { SystemHealthService } from "./system-health.service";

@Controller("system-health")
export class SystemHealthController {

  constructor(
    private readonly healthService: SystemHealthService,
  ) {}

  @Get()
  async health() {
    return this.healthService.getSystemHealth();
  }
}


import { Controller, Get } from "@nestjs/common";
import { SystemHealthService } from "./system-health.service";
import { Public } from "../auth/public.decorator";

@Controller("system-health")
@Public()
export class SystemHealthController {

  constructor(
    private readonly healthService: SystemHealthService,
  ) {}

  @Get()
  async health() {
    return this.healthService.getSystemHealth();
  }
}

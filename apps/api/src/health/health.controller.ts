import { Controller, Get } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";

import { MiniAppAuthBypass } from "../auth/mini-app-auth.decorator.js";

@ApiTags("platform")
@Controller("health")
export class HealthController {
  @Get()
  @MiniAppAuthBypass("health")
  @ApiExcludeEndpoint()
  @ApiOperation({
    operationId: "getHealth",
    summary: "Check API process health",
    description: "Platform health endpoint. It explicitly bypasses Mini App authentication.",
  })
  getHealth(): { readonly status: "ok"; readonly service: "api"; readonly timestamp: string } {
    return {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    };
  }
}

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { ApiConfigModule } from "../config/api-config.module.js";
import { MiniAppAuthGuard } from "./mini-app-auth.guard.js";

@Module({
  imports: [ApiConfigModule],
  providers: [
    MiniAppAuthGuard,
    {
      provide: APP_GUARD,
      useExisting: MiniAppAuthGuard,
    },
  ],
  exports: [MiniAppAuthGuard],
})
export class AuthModule {}

export * from "./mini-app-auth.constants.js";
export * from "./mini-app-auth.decorator.js";
export * from "./mini-app-auth.guard.js";

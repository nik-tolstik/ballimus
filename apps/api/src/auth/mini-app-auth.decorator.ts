import { SetMetadata } from "@nestjs/common";

import {
  MINI_APP_AUTH_BYPASS_METADATA,
  MINI_APP_AUTH_BYPASS_SCOPES,
  type MiniAppAuthBypassScope,
} from "./mini-app-auth.constants.js";

export function MiniAppAuthBypass(scope: MiniAppAuthBypassScope): MethodDecorator & ClassDecorator {
  if (!MINI_APP_AUTH_BYPASS_SCOPES.includes(scope)) {
    throw new Error("Unsupported Mini App authentication bypass scope");
  }

  return SetMetadata(MINI_APP_AUTH_BYPASS_METADATA, scope);
}

import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";

import { type MiniAppAuthenticatedUser } from "../auth/mini-app-auth.guard.js";
import { MINI_APP_REQUEST_USER } from "../auth/mini-app-auth.constants.js";

interface AuthenticatedRequest {
  [MINI_APP_REQUEST_USER]?: MiniAppAuthenticatedUser;
}

/** Reads the identity attached by the platform Mini App guard. */
export const CurrentOwnerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): bigint => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request[MINI_APP_REQUEST_USER];
    if (user === undefined) {
      throw new UnauthorizedException({
        code: "TELEGRAM_INIT_DATA_REQUIRED",
        message: "Telegram Mini App authentication is required.",
      });
    }
    return user.id;
  },
);

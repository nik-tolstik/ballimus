import { Controller, Delete, Get, Header, HttpCode, HttpStatus, Inject, Param, Put } from "@nestjs/common";
import {
  ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiSecurity, ApiTags,
} from "@nestjs/swagger";

import { MiniAppAccessService } from "../auth/mini-app-access.service.js";
import { MINI_APP_ROLES, type MiniAppRole } from "../auth/mini-app-auth.constants.js";
import { MiniAppAccess } from "../auth/mini-app-auth.decorator.js";
import type { MiniAppAuthenticatedUser } from "../auth/mini-app-auth.guard.js";
import { TelegramGroupMembersService, type TelegramGroupMember } from "../telegram/telegram-group-members.service.js";
import { CurrentMiniAppUser } from "./rest.decorator.js";

class MiniAppSessionResponseDto {
  @ApiProperty({ type: String })
  telegramUserId!: string;

  @ApiProperty({ enum: MINI_APP_ROLES })
  role!: MiniAppRole;
}

class MiniAppAdminsResponseDto {
  @ApiProperty({ type: [String] })
  telegramUserIds!: string[];
}

class MiniAppGroupMemberResponseDto implements TelegramGroupMember {
  @ApiProperty({ type: String })
  telegramUserId!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  username!: string | null;
}

class MiniAppGroupMembersResponseDto {
  @ApiProperty({ type: [MiniAppGroupMemberResponseDto] })
  members!: MiniAppGroupMemberResponseDto[];
}

@ApiTags("access")
@ApiSecurity("telegramMiniApp")
@Controller("access")
@MiniAppAccess("owner")
export class AccessController {
  public constructor(
    @Inject(MiniAppAccessService) private readonly access: MiniAppAccessService,
    @Inject(TelegramGroupMembersService) private readonly groupMembers: TelegramGroupMembersService,
  ) {}

  @Get("session")
  @Header("Cache-Control", "private, no-store")
  @MiniAppAccess("authenticated")
  @ApiOperation({ operationId: "getMiniAppSession", summary: "Load the signed-in Telegram identity and current Mini App role" })
  @ApiOkResponse({ type: MiniAppSessionResponseDto })
  public session(@CurrentMiniAppUser() user: MiniAppAuthenticatedUser): MiniAppSessionResponseDto {
    return { telegramUserId: String(user.id), role: user.role };
  }

  @Get("admins")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "listMiniAppAdmins", summary: "List Mini App administrators as the owner" })
  @ApiOkResponse({ type: MiniAppAdminsResponseDto })
  public async list(): Promise<MiniAppAdminsResponseDto> {
    return { telegramUserIds: await this.access.listAdmins() };
  }

  @Get("group-members")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ operationId: "listMiniAppGroupMembers", summary: "List current Telegram group members as the owner" })
  @ApiOkResponse({ type: MiniAppGroupMembersResponseDto })
  public async listGroupMembers(): Promise<MiniAppGroupMembersResponseDto> {
    return { members: await this.groupMembers.list() };
  }

  @Put("admins/:telegramUserId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: "grantMiniAppAdmin", summary: "Grant Mini App administrator access as the owner" })
  @ApiParam({ name: "telegramUserId", type: String })
  @ApiNoContentResponse()
  public async grant(@Param("telegramUserId") telegramUserId: string): Promise<void> {
    const target = this.access.adminTarget(telegramUserId);
    await this.groupMembers.assertMember(target);
    return this.access.setAdmin(target, true);
  }

  @Delete("admins/:telegramUserId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: "revokeMiniAppAdmin", summary: "Revoke Mini App administrator access as the owner" })
  @ApiParam({ name: "telegramUserId", type: String })
  @ApiNoContentResponse()
  public revoke(@Param("telegramUserId") telegramUserId: string): Promise<void> {
    return this.access.setAdmin(this.access.adminTarget(telegramUserId), false);
  }
}

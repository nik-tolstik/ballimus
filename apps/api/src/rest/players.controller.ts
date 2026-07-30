import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentOwnerId } from "./rest.decorator.js";
import {
  CreateAliasDto,
  PlayerListQueryDto,
  UpdateAliasDto,
  UpdatePlayerDto,
} from "./rest.dto.js";
import { PositiveBigIntPipe, RestQueryPipe } from "./rest.pipe.js";
import { OwnerRestService } from "./rest.service.js";
import {
  AliasMutationResponseDto,
  AliasRemovalResponseDto,
  PlayerEnvelopeResponseDto,
  PlayerListResponseDto,
} from "./rest.response.dto.js";

@ApiTags("players")
@ApiSecurity("telegramMiniApp")
@Controller("players")
export class PlayersController {
  public constructor(@Inject(OwnerRestService) private readonly service: OwnerRestService) {}

  @Get()
  @ApiOperation({ operationId: "listOwnerPlayers", summary: "Search owner players and aliases" })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiQuery({ name: "confirmed", required: false, type: Boolean })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiOkResponse({
    description: "Players with confirmed or unconfirmed state and aliases.",
    type: PlayerListResponseDto,
  })
  public list(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Query(new RestQueryPipe(PlayerListQueryDto)) query: PlayerListQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.service.listPlayers(ownerTelegramUserId, query);
  }

  @Get(":id")
  @ApiOperation({ operationId: "getOwnerPlayer", summary: "Load one player and aliases" })
  @ApiParam({ name: "id", description: "Decimal player identifier", type: String })
  @ApiOkResponse({
    description: "Player profile and aliases.",
    type: PlayerEnvelopeResponseDto,
  })
  public get(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Param("id", PositiveBigIntPipe) playerId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.getPlayer(ownerTelegramUserId, playerId);
  }

  @Post("aliases")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "createOwnerPlayerAlias", summary: "Create an owner-managed username alias" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateAliasDto })
  @ApiOkResponse({
    description: "Created or updated alias and readable name.",
    type: AliasMutationResponseDto,
  })
  public createAlias(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: CreateAliasDto,
  ): Promise<Record<string, unknown>> {
    return this.service.createAlias(ownerTelegramUserId, idempotencyKey, input);
  }

  @Patch("aliases/:username")
  @ApiOperation({ operationId: "updateOwnerPlayerAlias", summary: "Edit an alias readable name" })
  @ApiParam({ name: "username", description: "Telegram username, with or without @", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: UpdateAliasDto })
  @ApiOkResponse({
    description: "Updated alias readable name.",
    type: AliasMutationResponseDto,
  })
  public updateAlias(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("username") username: string,
    @Body() input: UpdateAliasDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updateAlias(ownerTelegramUserId, idempotencyKey, username, input);
  }

  @Delete("aliases/:username")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "removeOwnerPlayerAlias", summary: "Remove an unconfirmed username alias" })
  @ApiParam({ name: "username", description: "Telegram username, with or without @", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({
    description: "Removed alias.",
    type: AliasRemovalResponseDto,
  })
  public removeAlias(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("username") username: string,
  ): Promise<Record<string, unknown>> {
    return this.service.removeAlias(ownerTelegramUserId, idempotencyKey, username);
  }

  @Patch(":id")
  @ApiOperation({ operationId: "updateOwnerPlayerReadableName", summary: "Edit a player's readable name" })
  @ApiParam({ name: "id", description: "Decimal player identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: UpdatePlayerDto })
  @ApiOkResponse({
    description: "Updated readable name and affected card snapshots.",
    type: PlayerEnvelopeResponseDto,
  })
  public updatePlayer(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) playerId: bigint,
    @Body() input: UpdatePlayerDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updatePlayer(ownerTelegramUserId, idempotencyKey, playerId, input);
  }
}

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
  ApiCreatedResponse,
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
  CancelMatchDto,
  ExternalParticipantCreateDto,
  ExternalParticipantUpdateDto,
  FinalizeMatchDto,
  MatchCreateDto,
  MatchListQueryDto,
  PatchMatchDto,
  ReconcileMatchDto,
  RefreshMatchDto,
  VenueCreateDto,
  VenueListQueryDto,
  VenueUpdateDto,
  VoteCorrectionDto,
} from "./rest.dto.js";
import { OwnerRestService } from "./rest.service.js";
import { PositiveBigIntPipe, RestQueryPipe } from "./rest.pipe.js";
import {
  BootstrapResponseDto,
  CardPreviewResponseDto,
  MatchEnvelopeResponseDto,
  MatchListResponseDto,
  MatchMutationResponseDto,
  VenueEnvelopeResponseDto,
  VenueListResponseDto,
  WeatherSendResponseDto,
} from "./rest.response.dto.js";

@ApiTags("bootstrap")
@ApiSecurity("telegramMiniApp")
@Controller("bootstrap")
export class BootstrapController {
  public constructor(@Inject(OwnerRestService) private readonly service: OwnerRestService) {}

  @Get()
  @ApiOperation({ operationId: "getOwnerBootstrap", summary: "Load owner Mini App bootstrap data" })
  @ApiOkResponse({
    description: "Owner configuration and grouped match summaries.",
    type: BootstrapResponseDto,
  })
  public getBootstrap(@CurrentOwnerId() ownerTelegramUserId: bigint): Promise<Record<string, unknown>> {
    return this.service.getBootstrap(ownerTelegramUserId);
  }
}

@ApiTags("matches")
@ApiSecurity("telegramMiniApp")
@Controller("matches")
export class MatchesController {
  public constructor(@Inject(OwnerRestService) private readonly service: OwnerRestService) {}

  @Get()
  @ApiOperation({ operationId: "listOwnerMatches", summary: "List owner matches" })
  @ApiQuery({ name: "status", required: false, enum: ["draft", "active", "confirmed", "completed", "cancelled"] })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiOkResponse({
    description: "Match summaries.",
    type: MatchListResponseDto,
  })
  public listMatches(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Query(new RestQueryPipe(MatchListQueryDto)) query: MatchListQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.service.listMatches(ownerTelegramUserId, query);
  }

  @Get(":id")
  @ApiOperation({ operationId: "getOwnerMatch", summary: "Load an owner match and roster" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiOkResponse({
    description: "Match details, roster, and public-card state.",
    type: MatchEnvelopeResponseDto,
  })
  public getMatch(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.getMatch(ownerTelegramUserId, matchId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: "createOwnerMatch", summary: "Create and publish a match" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: MatchCreateDto })
  @ApiCreatedResponse({
    description: "Created active match with publication accepted into the durable outbox.",
    type: MatchMutationResponseDto,
  })
  public createMatch(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: MatchCreateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.createMatch(ownerTelegramUserId, idempotencyKey, input);
  }

  @Patch(":id")
  @ApiOperation({ operationId: "patchOwnerMatch", summary: "Edit a match with optimistic concurrency" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true, description: "Current match version, such as 3 or \"3\"." })
  @ApiBody({ type: PatchMatchDto })
  @ApiOkResponse({
    description: "Updated match.",
    type: MatchMutationResponseDto,
  })
  public patchMatch(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: PatchMatchDto,
  ): Promise<Record<string, unknown>> {
    return this.service.patchMatch(ownerTelegramUserId, idempotencyKey, ifMatch, matchId, input);
  }

  @Post(":id/preview")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "previewOwnerMatchCard", summary: "Render the public match card preview" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({
    description: "Preview rendered by the domain card formatter.",
    type: CardPreviewResponseDto,
  })
  public preview(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.previewMatch(ownerTelegramUserId, idempotencyKey, matchId);
  }

  @Post(":id/publish")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "publishOwnerMatch", summary: "Publish a legacy unpublished match" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: false })
  @ApiOkResponse({
    description: "Publication accepted into the durable outbox.",
    type: MatchMutationResponseDto,
  })
  public publish(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.publishMatch(ownerTelegramUserId, idempotencyKey, ifMatch, matchId);
  }

  @Post(":id/finalize")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "finalizeOwnerMatch", summary: "Set booked match details and confirm the match" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: false })
  @ApiBody({ type: FinalizeMatchDto })
  @ApiOkResponse({
    description: "Confirmed match with a queued card refresh and chat notification.",
    type: MatchMutationResponseDto,
  })
  public finalize(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: FinalizeMatchDto,
  ): Promise<Record<string, unknown>> {
    return this.service.finalizeMatch(ownerTelegramUserId, idempotencyKey, ifMatch, matchId, input);
  }

  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "confirmOwnerMatch", summary: "Confirm an active match" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: false })
  @ApiOkResponse({
    description: "Confirmed match and queued card refresh.",
    type: MatchMutationResponseDto,
  })
  public confirm(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.confirmMatch(ownerTelegramUserId, idempotencyKey, ifMatch, matchId);
  }

  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "completeOwnerMatch", summary: "Complete a confirmed match" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: false })
  @ApiOkResponse({
    description: "Completed match and queued public-card deletion.",
    type: MatchMutationResponseDto,
  })
  public complete(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.completeMatch(ownerTelegramUserId, idempotencyKey, ifMatch, matchId);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "cancelOwnerMatch", summary: "Cancel a match with a reason" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: false })
  @ApiBody({ type: CancelMatchDto })
  @ApiOkResponse({
    description: "Cancelled match and queued public-card deletion.",
    type: MatchMutationResponseDto,
  })
  public cancel(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: CancelMatchDto,
  ): Promise<Record<string, unknown>> {
    return this.service.cancelMatch(ownerTelegramUserId, idempotencyKey, ifMatch, matchId, input);
  }

  @Post(":id/refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "refreshOwnerMatchCard", summary: "Queue a public-card refresh" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: RefreshMatchDto, required: false })
  @ApiOkResponse({
    description: "Refresh queued.",
    type: MatchMutationResponseDto,
  })
  public refresh(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: RefreshMatchDto | undefined,
  ): Promise<Record<string, unknown>> {
    return this.service.refreshMatch(ownerTelegramUserId, idempotencyKey, matchId, input);
  }

  @Post(":id/weather")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "sendOwnerMatchWeather", summary: "Send the weather forecast immediately" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiOkResponse({
    description: "Weather forecast sent to the configured chat topic.",
    type: WeatherSendResponseDto,
  })
  public sendWeather(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.sendWeatherForecast(ownerTelegramUserId, matchId);
  }

  @Post(":id/reconcile")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "reconcileOwnerMatchCard", summary: "Repair an uncertain public-card publication" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ReconcileMatchDto })
  @ApiOkResponse({
    description: "Existing card attached or a confirmed-safe publication retry queued.",
    type: MatchMutationResponseDto,
  })
  public reconcile(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: ReconcileMatchDto,
  ): Promise<Record<string, unknown>> {
    return this.service.reconcileMatch(ownerTelegramUserId, idempotencyKey, matchId, input);
  }

  @Post(":id/roster/votes")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "correctOwnerMatchVote", summary: "Correct a known player's vote" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: VoteCorrectionDto })
  @ApiOkResponse({
    description: "Corrected roster and queued card refresh.",
    type: MatchMutationResponseDto,
  })
  public correctVote(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: VoteCorrectionDto,
  ): Promise<Record<string, unknown>> {
    return this.service.correctVote(ownerTelegramUserId, idempotencyKey, matchId, input);
  }

  @Delete(":id/roster/votes/:playerId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "removeOwnerMatchVote", summary: "Remove a known player's vote" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiParam({ name: "playerId", description: "Decimal player identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({
    description: "Removed roster vote and queued card refresh.",
    type: MatchMutationResponseDto,
  })
  public removeVote(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Param("playerId", PositiveBigIntPipe) playerId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.removeVote(ownerTelegramUserId, idempotencyKey, matchId, playerId);
  }

  @Post(":id/roster/external-participants")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "createOwnerExternalParticipant", summary: "Add individually editable external players" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ExternalParticipantCreateDto })
  @ApiOkResponse({
    description: "Added external participants and queued card refresh.",
    type: MatchMutationResponseDto,
  })
  public addExternalParticipant(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: ExternalParticipantCreateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.addExternalParticipant(ownerTelegramUserId, idempotencyKey, matchId, input);
  }

  @Patch(":id/roster/external-participants/:participantId")
  @ApiOperation({ operationId: "updateOwnerExternalParticipant", summary: "Rename an external player" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiParam({ name: "participantId", description: "Decimal external participant identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: ExternalParticipantUpdateDto })
  @ApiOkResponse({
    description: "Updated external participants and queued card refresh.",
    type: MatchMutationResponseDto,
  })
  public updateExternalParticipant(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Param("participantId", PositiveBigIntPipe) participantId: bigint,
    @Body() input: ExternalParticipantUpdateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updateExternalParticipant(ownerTelegramUserId, idempotencyKey, matchId, participantId, input);
  }

  @Delete(":id/roster/external-participants/:participantId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "removeOwnerExternalParticipant", summary: "Remove an external participant entry" })
  @ApiParam({ name: "id", description: "Decimal match identifier", type: String })
  @ApiParam({ name: "participantId", description: "Decimal external participant identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({
    description: "Removed external participants and queued card refresh.",
    type: MatchMutationResponseDto,
  })
  public removeExternalParticipant(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Param("participantId", PositiveBigIntPipe) participantId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.removeExternalParticipant(ownerTelegramUserId, idempotencyKey, matchId, participantId);
  }
}

@ApiTags("venues")
@ApiSecurity("telegramMiniApp")
@Controller("venues")
export class VenuesController {
  public constructor(@Inject(OwnerRestService) private readonly service: OwnerRestService) {}

  @Get()
  @ApiOperation({ operationId: "listOwnerVenues", summary: "List owner venues" })
  @ApiQuery({ name: "includeArchived", required: false, type: Boolean })
  @ApiOkResponse({ type: VenueListResponseDto })
  public list(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Query(new RestQueryPipe(VenueListQueryDto)) query: VenueListQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.service.listVenues(ownerTelegramUserId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: "createOwnerVenue", summary: "Create an owner venue" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: VenueCreateDto })
  @ApiCreatedResponse({ type: VenueEnvelopeResponseDto })
  public create(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: VenueCreateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.createVenue(ownerTelegramUserId, idempotencyKey, input);
  }

  @Patch(":id")
  @ApiOperation({ operationId: "updateOwnerVenue", summary: "Edit an owner venue" })
  @ApiParam({ name: "id", description: "Decimal venue identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiBody({ type: VenueUpdateDto })
  @ApiOkResponse({ type: VenueEnvelopeResponseDto })
  public update(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) venueId: bigint,
    @Body() input: VenueUpdateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updateVenue(ownerTelegramUserId, idempotencyKey, ifMatch, venueId, input);
  }

  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "archiveOwnerVenue", summary: "Archive an owner venue" })
  @ApiParam({ name: "id", description: "Decimal venue identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOkResponse({ type: VenueEnvelopeResponseDto })
  public archive(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) venueId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.setVenueArchived(ownerTelegramUserId, idempotencyKey, ifMatch, venueId, true);
  }

  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "restoreOwnerVenue", summary: "Restore an owner venue" })
  @ApiParam({ name: "id", description: "Decimal venue identifier", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOkResponse({ type: VenueEnvelopeResponseDto })
  public restore(
    @CurrentOwnerId() ownerTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) venueId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.setVenueArchived(ownerTelegramUserId, idempotencyKey, ifMatch, venueId, false);
  }
}

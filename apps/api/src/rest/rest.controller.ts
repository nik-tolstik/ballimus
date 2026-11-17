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
  ApiExcludeEndpoint,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";

import { MiniAppAccess } from "../auth/mini-app-auth.decorator.js";
import { CurrentMiniAppUser } from "./rest.decorator.js";
import {
  MatchCreateDto,
  MatchListQueryDto,
  PatchMatchDto,
  PollCreateDto,
  PollListQueryDto,
  PollNotificationSettingsUpdateDto,
  PollVoteHistoryQueryDto,
  VenueCreateDto,
  VenueUpdateDto,
} from "./rest.dto.js";
import { PositiveBigIntPipe, RestQueryPipe } from "./rest.pipe.js";
import {
  BootstrapResponseDto,
  ArchivedPollDeletionResponseDto,
  MatchEnvelopeResponseDto,
  MatchListResponseDto,
  PollEnvelopeResponseDto,
  PollListResponseDto,
  PollVoteHistoryResponseDto,
  VenueEnvelopeResponseDto,
  VenueListResponseDto,
  WeatherCurrentResponseDto,
} from "./rest.response.dto.js";
import { RestService } from "./rest.service.js";

@ApiTags("bootstrap")
@ApiSecurity("telegramMiniApp")
@Controller("bootstrap")
@MiniAppAccess("admin")
export class BootstrapController {
  public constructor(@Inject(RestService) private readonly service: RestService) {}

  @Get()
  @ApiOperation({ operationId: "getOwnerBootstrap", summary: "Load Mini App bootstrap data" })
  @ApiOkResponse({ type: BootstrapResponseDto })
  public getBootstrap(): Promise<Record<string, unknown>> {
    return this.service.getBootstrap();
  }
}

@ApiTags("matches")
@ApiSecurity("telegramMiniApp")
@Controller("matches")
@MiniAppAccess("admin")
export class MatchesController {
  public constructor(@Inject(RestService) private readonly service: RestService) {}

  @Get()
  @ApiOperation({ operationId: "listOwnerMatches", summary: "List active or archived information cards" })
  @ApiQuery({ name: "venueId", required: false, type: String })
  @ApiQuery({ name: "archived", required: false, type: Boolean })
  @ApiOkResponse({ type: MatchListResponseDto })
  public list(
    @Query(new RestQueryPipe(MatchListQueryDto)) query: MatchListQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.service.listMatches(query);
  }

  @Get(":id")
  @ApiOperation({ operationId: "getOwnerMatch", summary: "Load one information card" })
  @ApiParam({ name: "id", type: String })
  @ApiOkResponse({ type: MatchEnvelopeResponseDto })
  public get(
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.getMatch(matchId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: "createOwnerMatch", summary: "Create and publish an information card" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: MatchCreateDto })
  @ApiCreatedResponse({ type: MatchEnvelopeResponseDto })
  public create(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: MatchCreateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.createMatch(actorTelegramUserId, idempotencyKey, input);
  }

  @Patch(":id")
  @ApiOperation({ operationId: "updateOwnerMatch", summary: "Update an information card" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiBody({ type: PatchMatchDto })
  @ApiOkResponse({ type: MatchEnvelopeResponseDto })
  public update(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
    @Body() input: PatchMatchDto,
  ): Promise<Record<string, unknown>> {
    return this.service.patchMatch(actorTelegramUserId, idempotencyKey, ifMatch, matchId, input);
  }

  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "archiveOwnerMatch", summary: "Archive an information card and delete its Telegram message" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOkResponse({ type: MatchEnvelopeResponseDto })
  public archive(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.archiveMatch(actorTelegramUserId, idempotencyKey, ifMatch, matchId);
  }

  @Delete(":id/archive")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "deleteArchivedOwnerMatch", summary: "Permanently delete an archived match" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOkResponse({ schema: { example: { deleted: true, matchId: "42" } } })
  public deleteArchived(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.deleteArchivedMatch(actorTelegramUserId, idempotencyKey, ifMatch, matchId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "deleteOwnerMatch", summary: "Delete an information card" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOkResponse({ schema: { example: { deleted: true, matchId: "42" } } })
  public delete(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.deleteMatch(actorTelegramUserId, idempotencyKey, ifMatch, matchId);
  }

  @Post(":id/republish")
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "republishOwnerMatch", summary: "Republish an information card" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOkResponse({ type: MatchEnvelopeResponseDto })
  public republish(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) matchId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.republishMatch(actorTelegramUserId, idempotencyKey, ifMatch, matchId);
  }
}

@ApiTags("polls")
@ApiSecurity("telegramMiniApp")
@Controller("polls")
@MiniAppAccess("admin")
export class PollsController {
  public constructor(@Inject(RestService) private readonly service: RestService) {}

  @Get()
  @ApiOperation({ operationId: "listOwnerPolls", summary: "List active or archived native Telegram polls" })
  @ApiQuery({ name: "archived", required: false, type: Boolean })
  @ApiOkResponse({ type: PollListResponseDto })
  public list(
    @Query(new RestQueryPipe(PollListQueryDto)) query: PollListQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.service.listPolls(query);
  }

  @Get(":id/vote-history")
  @ApiOperation({ operationId: "getOwnerPollVoteHistory", summary: "List native Telegram poll vote history" })
  @ApiParam({ name: "id", type: String })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiOkResponse({ type: PollVoteHistoryResponseDto })
  public listVoteHistory(
    @Param("id", PositiveBigIntPipe) pollId: bigint,
    @Query(new RestQueryPipe(PollVoteHistoryQueryDto)) query: PollVoteHistoryQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.service.listPollVoteHistory(pollId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: "createOwnerPoll", summary: "Create and publish a native Telegram poll" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: PollCreateDto })
  @ApiCreatedResponse({ type: PollEnvelopeResponseDto })
  public create(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: PollCreateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.createPoll(actorTelegramUserId, idempotencyKey, input);
  }

  @Patch(":id/notification-settings")
  @ApiOperation({ operationId: "updateOwnerPollNotificationSettings", summary: "Update native poll option notification settings" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: PollNotificationSettingsUpdateDto })
  @ApiOkResponse({ type: PollEnvelopeResponseDto })
  public updateNotificationSettings(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) pollId: bigint,
    @Body() input: PollNotificationSettingsUpdateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updatePollNotificationSettings(actorTelegramUserId, idempotencyKey, pollId, input);
  }

  @Post(":id/republish")
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "republishOwnerPoll", summary: "Make one new attempt to publish a native Telegram poll" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({ type: PollEnvelopeResponseDto })
  public republish(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) pollId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.republishPoll(actorTelegramUserId, idempotencyKey, pollId);
  }

  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "archiveOwnerPoll", summary: "Archive a poll and delete its Telegram message" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({ type: PollEnvelopeResponseDto })
  public archive(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) pollId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.archivePoll(actorTelegramUserId, idempotencyKey, pollId);
  }

  @Delete(":id/archive")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "deleteArchivedOwnerPoll", summary: "Permanently delete an archived native Telegram poll" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({ type: ArchivedPollDeletionResponseDto })
  public deleteArchived(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Param("id", PositiveBigIntPipe) pollId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.deleteArchivedPoll(actorTelegramUserId, idempotencyKey, pollId);
  }
}

@ApiTags("weather")
@ApiSecurity("telegramMiniApp")
@Controller("weather")
export class WeatherController {
  public constructor(@Inject(RestService) private readonly service: RestService) {}

  @Post("current")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "sendCurrentWeather", summary: "Send current Minsk weather to Telegram" })
  @ApiOkResponse({ type: WeatherCurrentResponseDto })
  public current(): Promise<Record<string, unknown>> {
    return this.service.sendCurrentWeather();
  }
}

@ApiTags("venues")
@ApiSecurity("telegramMiniApp")
@Controller("venues")
@MiniAppAccess("admin")
export class VenuesController {
  public constructor(@Inject(RestService) private readonly service: RestService) {}

  @Get()
  @ApiOperation({ operationId: "listOwnerVenues", summary: "List venue catalog entries" })
  @ApiOkResponse({ type: VenueListResponseDto })
  public list(): Promise<Record<string, unknown>> {
    return this.service.listVenues();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: "createOwnerVenue", summary: "Create a venue catalog entry" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: VenueCreateDto })
  @ApiCreatedResponse({ type: VenueEnvelopeResponseDto })
  public create(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: VenueCreateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.createVenue(actorTelegramUserId, idempotencyKey, input);
  }

  @Patch(":id")
  @ApiOperation({ operationId: "updateOwnerVenue", summary: "Update a venue catalog entry" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiBody({ type: VenueUpdateDto })
  @ApiOkResponse({ type: VenueEnvelopeResponseDto })
  public update(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) venueId: bigint,
    @Body() input: VenueUpdateDto,
  ): Promise<Record<string, unknown>> {
    return this.service.updateVenue(actorTelegramUserId, idempotencyKey, ifMatch, venueId, input);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: "deleteOwnerVenue", summary: "Permanently delete a venue catalog entry" })
  @ApiParam({ name: "id", type: String })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "If-Match", required: true })
  @ApiOkResponse({ schema: { example: { deleted: true, venueId: "42" } } })
  public delete(
    @CurrentMiniAppUser("id") actorTelegramUserId: bigint,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Param("id", PositiveBigIntPipe) venueId: bigint,
  ): Promise<Record<string, unknown>> {
    return this.service.deleteVenue(actorTelegramUserId, idempotencyKey, ifMatch, venueId);
  }
}

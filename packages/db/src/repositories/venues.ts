import { and, asc, eq, sql } from "drizzle-orm";

import { matches, venues, type BookingContact, type Venue, type VenueType } from "../schema.js";
import {
  effectiveNow,
  nonEmpty,
  optionalText,
  positiveBigInt,
  type DatabaseExecutor,
  type DatabaseIdentifier,
} from "./common.js";
import {
  NotFoundRepositoryError,
  OptimisticConcurrencyError,
  ValidationRepositoryError,
  VenueInUseRepositoryError,
} from "./errors.js";

export interface CreateVenueInput {
  readonly name: string;
  readonly mapUrl: string;
  readonly venueType: VenueType;
  readonly bookingContacts?: readonly BookingContact[];
  readonly websiteUrl?: string | null;
  readonly createdAt?: Date;
}

export interface UpdateVenueInput {
  readonly name?: string;
  readonly mapUrl?: string;
  readonly venueType?: VenueType;
  readonly bookingContacts?: readonly BookingContact[];
  readonly websiteUrl?: string | null;
  readonly expectedVersion?: number;
  readonly now?: Date;
}

function venueId(id: DatabaseIdentifier): bigint {
  return positiveBigInt(id, "venueId");
}

function versionOrUndefined(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationRepositoryError("expectedVersion must be a positive safe integer");
  }
  return value;
}

function normalizedUrl(value: string, fieldName: string): string {
  return nonEmpty(value, fieldName, 2_000);
}

function normalizedContacts(values: readonly BookingContact[] | undefined): BookingContact[] {
  if (values === undefined) return [];
  if (values.length > 5) throw new ValidationRepositoryError("bookingContacts can contain at most five values");
  const contacts = values.map((value) => {
    const name = optionalText(value.name, "bookingContact.name", 100);
    return name === null
      ? { phone: nonEmpty(value.phone, "bookingContact.phone", 50) }
      : { name, phone: nonEmpty(value.phone, "bookingContact.phone", 50) };
  });
  if (new Set(contacts.map((contact) => contact.phone)).size !== contacts.length) {
    throw new ValidationRepositoryError("bookingContacts must not contain duplicate phones");
  }
  return contacts;
}

function requireVenue(record: Venue | undefined, id: bigint): Venue {
  if (record === undefined) throw new NotFoundRepositoryError(`Venue ${id.toString(10)} was not found`);
  return record;
}

/** PostgreSQL repository for the owner-maintained venue catalog. */
export class VenuesRepository {
  public constructor(private readonly db: DatabaseExecutor) {}

  public async list(): Promise<Venue[]> {
    return this.db
      .select()
      .from(venues)
      .orderBy(asc(venues.name));
  }

  public async findById(id: DatabaseIdentifier): Promise<Venue | undefined> {
    const rows = await this.db.select().from(venues).where(eq(venues.id, venueId(id))).limit(1);
    return rows[0];
  }

  public async getById(id: DatabaseIdentifier): Promise<Venue> {
    const parsedId = venueId(id);
    return requireVenue(await this.findById(parsedId), parsedId);
  }

  public async findForUpdate(id: DatabaseIdentifier): Promise<Venue | undefined> {
    const rows = await this.db
      .select()
      .from(venues)
      .where(eq(venues.id, venueId(id)))
      .limit(1)
      .for("update");
    return rows[0];
  }

  public async getForUpdate(id: DatabaseIdentifier): Promise<Venue> {
    const parsedId = venueId(id);
    return requireVenue(await this.findForUpdate(parsedId), parsedId);
  }

  public async create(input: CreateVenueInput): Promise<Venue> {
    const now = effectiveNow(input.createdAt);
    const rows = await this.db
      .insert(venues)
      .values({
        name: nonEmpty(input.name, "name", 200),
        mapUrl: normalizedUrl(input.mapUrl, "mapUrl"),
        venueType: input.venueType,
        bookingContacts: normalizedContacts(input.bookingContacts),
        websiteUrl: input.websiteUrl === undefined ? null : optionalText(input.websiteUrl, "websiteUrl", 2_000),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return requireVenue(rows[0], 0n);
  }

  public async update(id: DatabaseIdentifier, input: UpdateVenueInput): Promise<Venue> {
    const parsedId = venueId(id);
    const expected = versionOrUndefined(input.expectedVersion);
    const current = await this.getForUpdate(parsedId);
    if (expected !== undefined && current.version !== expected) {
      throw new OptimisticConcurrencyError(expected, current.version);
    }
    const values: {
      name?: string;
      mapUrl?: string;
      venueType?: VenueType;
      bookingContacts?: BookingContact[];
      websiteUrl?: string | null;
      version: ReturnType<typeof sql>;
      updatedAt: Date;
    } = {
      version: sql`${venues.version} + 1`,
      updatedAt: effectiveNow(input.now),
    };
    if (input.name !== undefined) values.name = nonEmpty(input.name, "name", 200);
    if (input.mapUrl !== undefined) values.mapUrl = normalizedUrl(input.mapUrl, "mapUrl");
    if (input.venueType !== undefined) values.venueType = input.venueType;
    if (input.bookingContacts !== undefined) values.bookingContacts = normalizedContacts(input.bookingContacts);
    if (input.websiteUrl !== undefined) values.websiteUrl = optionalText(input.websiteUrl, "websiteUrl", 2_000);
    const rows = await this.db
      .update(venues)
      .set(values)
      .where(and(eq(venues.id, parsedId), ...(expected === undefined ? [] : [eq(venues.version, expected)])))
      .returning();
    return requireVenue(rows[0], parsedId);
  }

  public async delete(id: DatabaseIdentifier, expectedVersion?: number): Promise<boolean> {
    const parsedId = venueId(id);
    const expected = versionOrUndefined(expectedVersion);
    const current = await this.getForUpdate(parsedId);
    if (expected !== undefined && current.version !== expected) {
      throw new OptimisticConcurrencyError(expected, current.version);
    }
    const references = await this.db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.venueId, parsedId))
      .limit(1);
    if (references.length > 0) throw new VenueInUseRepositoryError();
    const rows = await this.db
      .delete(venues)
      .where(and(eq(venues.id, parsedId), ...(expected === undefined ? [] : [eq(venues.version, expected)])))
      .returning({ id: venues.id });
    return rows.length > 0;
  }
}

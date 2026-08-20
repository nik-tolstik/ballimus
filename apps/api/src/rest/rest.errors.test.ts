import { describe, expect, it } from "vitest";
import { VenueInUseRepositoryError } from "@football/db";

import { mapRestError } from "./rest.errors.js";

describe("venue deletion REST errors", () => {
  it("returns a clear conflict when a venue is referenced by a match", () => {
    expect(mapRestError(new VenueInUseRepositoryError())).toEqual({
      status: 409,
      body: {
        code: "VENUE_IN_USE",
        message: "The venue cannot be deleted while it is used by an existing match.",
      },
    });
  });
});

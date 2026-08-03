import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import { VenueCreateDto } from "./rest.dto.js";

describe("VenueCreateDto", () => {
  it("accepts HTTP(S) links and up to five distinct booking phones", async () => {
    const input = plainToInstance(VenueCreateDto, {
      name: "  BOX365 Октябрьская  ",
      mapUrl: "https://maps.example.test/box365",
      venueType: "indoor",
      bookingPhones: ["+375 29 123-45-67", "+375 44 765-43-21"],
      websiteUrl: "https://box365.example.test",
    });

    expect(await validate(input)).toEqual([]);
    expect(input.name).toBe("BOX365 Октябрьская");
  });

  it("rejects non-HTTP links, duplicate phones, and more than five phone numbers", async () => {
    const input = plainToInstance(VenueCreateDto, {
      name: "BOX365 Октябрьская",
      mapUrl: "mailto:booking@example.test",
      venueType: "indoor",
      bookingPhones: ["+375 29 123-45-67", "+375 29 123-45-67", "+375 44 765-43-21", "+375 33 111-22-33", "+375 25 444-55-66", "+375 29 777-88-99"],
      websiteUrl: "ftp://box365.example.test",
    });

    const errors = await validate(input);
    expect(errors.map((error) => error.property).sort()).toEqual(["bookingPhones", "mapUrl", "websiteUrl"]);
  });
});

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import { VenueCreateDto, VenueUpdateDto } from "./rest.dto.js";

describe("Venue contact DTOs", () => {
  it("accepts HTTP(S) links and up to five distinct booking contacts", async () => {
    const input = plainToInstance(VenueCreateDto, {
      name: "  BOX365 Октябрьская  ",
      mapUrl: "https://maps.example.test/box365",
      venueType: "indoor",
      bookingContacts: [
        { name: "  Администратор  ", phone: "+375 29 123-45-67" },
        { name: "", phone: "+375 44 765-43-21" },
      ],
      websiteUrl: "https://box365.example.test",
    });

    expect(await validate(input)).toEqual([]);
    expect(input.name).toBe("BOX365 Октябрьская");
    expect(input.bookingContacts).toEqual([
      { name: "Администратор", phone: "+375 29 123-45-67" },
      { phone: "+375 44 765-43-21" },
    ]);
  });

  it("rejects non-HTTP links, invalid contacts, duplicate phones, and more than five contacts", async () => {
    const input = plainToInstance(VenueCreateDto, {
      name: "BOX365 Октябрьская",
      mapUrl: "mailto:booking@example.test",
      venueType: "indoor",
      bookingContacts: [
        { name: "", phone: "+375 29 123-45-67" },
        { phone: "+375 29 123-45-67" },
        { phone: "+375 44 765-43-21" },
        { phone: "+375 33 111-22-33" },
        { phone: "+375 25 444-55-66" },
        { phone: "invalid" },
      ],
      websiteUrl: "ftp://box365.example.test",
    });

    const errors = await validate(input);
    expect(errors.map((error) => error.property).sort()).toEqual(["bookingContacts", "mapUrl", "websiteUrl"]);
  });

  it("accepts an omitted contact name when updating a venue", async () => {
    const input = plainToInstance(VenueUpdateDto, {
      bookingContacts: [{ phone: "+375 29 123-45-67" }],
    });

    expect(await validate(input)).toEqual([]);
  });
});

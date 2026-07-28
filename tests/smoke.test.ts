import { describe, expect, it } from "vitest";

import { main } from "../src/main.js";

describe("project bootstrap", () => {
  it("exposes the application entry point", () => {
    expect(main).toBeTypeOf("function");
  });
});

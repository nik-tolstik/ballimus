import { defineConfig } from "orval";

export default defineConfig({
  football: {
    input: {
      target: process.env["ORVAL_INPUT"] ?? "../../apps/api/openapi.json",
    },
    output: {
      mode: "tags-split",
      target: process.env["ORVAL_OUTPUT"] ?? "src/generated",
      schemas: process.env["ORVAL_SCHEMAS"] ?? "src/generated/model",
      client: "react-query",
      clean: true,
      headers: true,
      indexFiles: true,
      override: {
        mutator: {
          path: "./src/mutator.ts",
          name: "customInstance",
        },
        query: {
          options: {
            retry: false,
          },
        },
      },
    },
  },
});

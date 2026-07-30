# @football/api-client

Nest Swagger/OpenAPI is the REST-contract source of truth. Orval generates the TypeScript models and TanStack Query hooks in `src/generated`.

Regenerate the contract client after updating the API specification:

```sh
pnpm --filter @football/api openapi:write
pnpm --filter @football/api-client generate
```

The handwritten mutator in `src/mutator.ts` owns transport concerns only: API base URL selection, Telegram Mini App authentication, mutation headers, cancellation, normalized errors, and retry policy. Do not add handwritten REST contracts to this package.

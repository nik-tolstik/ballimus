# Repository Instructions

- Use `pnpm` as the package manager. Do not use `npm` or `yarn` unless the repository explicitly requires it.
- Write code comments and documentation in English.

## Development startup

- This repository is a Telegram Mini App. The default local launch path is `pnpm dev` from the repository root.
- Start the local PostgreSQL container separately in Docker Desktop and apply migrations explicitly with `pnpm db:migrate`. The ngrok workflow opens the API and Web HTTPS tunnels, starts the API and Vite, and registers the local webhook.
- Keep `.env.local`, the ngrok configuration, the bot, group, database, and webhook strictly local/non-production.

## Documentation

- [Documentation index](docs/README.md)
- [Bot guide](docs/bot-guide.md)
- [Architecture](docs/architecture.md)
- [Project structure](docs/project-structure.md)
- [Development guide](docs/development.md)

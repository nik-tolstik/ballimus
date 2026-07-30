# Repository Instructions

- Use `pnpm` as the package manager. Do not use `npm` or `yarn` unless the repository explicitly requires it.
- Write code comments and documentation in English.

## Development startup

- This repository is a Telegram Mini App. The default local launch path is `pnpm dev:ngrok -- --register-webhook` from the repository root.
- Use the printed public Mini App URL from the configured non-production Telegram bot. The ngrok workflow starts local PostgreSQL, applies migrations, opens the API and Web HTTPS tunnels, starts the API and Vite, and registers the local webhook.
- Do not use the root `pnpm dev` command for Telegram Mini App testing. It is only a localhost API/Vite watcher and does not start PostgreSQL, apply migrations, or configure Telegram URLs and webhooks.
- Keep `.env.local`, the ngrok configuration, the bot, group, database, and webhook strictly local/non-production.

## Documentation

- [Documentation index](docs/README.md)
- [Bot guide](docs/bot-guide.md)
- [Architecture](docs/architecture.md)
- [Project structure](docs/project-structure.md)
- [Development guide](docs/development.md)

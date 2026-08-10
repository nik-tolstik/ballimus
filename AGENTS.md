# Repository Instructions

- Use `pnpm` as the package manager. Do not use `npm` or `yarn` unless the repository explicitly requires it.
- Write code comments and documentation in English.

## Development startup

- This repository is a Telegram Mini App. The default local launch path is `pnpm dev` from the repository root.
- Start the local PostgreSQL container separately in Docker Desktop and apply migrations explicitly with `pnpm db:migrate`. The ngrok workflow opens the API and Web HTTPS tunnels and starts the API and Vite.
- Keep `.env.local`, the ngrok configuration, the bot, group, and database strictly local/non-production.
- When creating a worktree, copy every existing non-example `.env*` file from the source checkout before starting the project. Keep those files local, do not print their contents, and never commit them.
- After a worktree branch is merged into `main`, remove that worktree and its local branch unless the user explicitly asks to keep them.
- Start every non-trivial implementation task with an issue in the `FBOT` team and Football Bot project. Before implementation, verify the issue has no active executor, move it to `In Progress`, and assign it to the agent when possible. Use a dedicated worktree and an issue-based branch name; move the issue to `Done` only after the pull request is merged, CI is green, and the change is in `main`. See `docs/linear.md` for the complete workflow and exceptions.

## Production verification

- Production PostgreSQL may be queried read-only for diagnosis when the user requests production analysis. Use the configured Railway or database access path, inspect only the minimum data needed, and never print credentials, tokens, connection strings, or signed Telegram data.
- A production PostgreSQL mutation is allowed only when the user explicitly requests that specific database change. Resolve and verify the exact target with read-only checks first, keep the change narrow and auditable, and do not infer permission to deploy code, run migrations, change a webhook, change BotFather settings, or send Telegram messages.
- Production deployment, migrations, legacy webhook removal, BotFather changes, and Telegram messages still require explicit owner authorization.
- `pnpm release:verify-production` is the minimum post-deploy check. It is read-only: it validates GitHub CI and Vercel status, Railway API and Jobs, API health and CORS, and the migration ledger. It must never deploy, migrate, change Telegram configuration, or create Telegram data.
- The command reads only public verifier settings from the ignored `.env.production.local`; do not put Telegram or PostgreSQL secrets in those verifier settings. It requires authenticated `gh` and `railway` CLIs.
- A full information-card create/edit/delete/weather smoke test is an extended check. Run it only in `Футбол тест` and only after separate explicit owner authorization; never create smoke-test matches in the real group.

## Browser verification

- For every rendered frontend task, run Playwright verification before completion with `pnpm test:e2e` (or a focused Playwright command when appropriate). Local Playwright is confirmed to work with the repository's mocked API and Telegram WebApp fixture.
- Browser QA is disabled for this repository because Codex has a known runtime blocker: `sandboxCwd is not a local file URI`. Do not use Browser QA as a substitute for Playwright unless the user explicitly requests it.
- Report any Playwright limitation and do not claim visual QA passed when the relevant check could not run.

## Documentation

- [Documentation index](docs/README.md)
- [Bot guide](docs/bot-guide.md)
- [Architecture](docs/architecture.md)
- [Project structure](docs/project-structure.md)
- [Development guide](docs/development.md)

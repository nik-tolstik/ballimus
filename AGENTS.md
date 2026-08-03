# Repository Instructions

- Use `pnpm` as the package manager. Do not use `npm` or `yarn` unless the repository explicitly requires it.
- Write code comments and documentation in English.

## Development startup

- This repository is a Telegram Mini App. The default local launch path is `pnpm dev` from the repository root.
- Start the local PostgreSQL container separately in Docker Desktop and apply migrations explicitly with `pnpm db:migrate`. The ngrok workflow opens the API and Web HTTPS tunnels, starts the API and Vite, and registers the local webhook.
- Keep `.env.local`, the ngrok configuration, the bot, group, database, and webhook strictly local/non-production.
- When creating a worktree, copy every existing non-example `.env*` file from the source checkout before starting the project. Keep those files local, do not print their contents, and never commit them.
- After a worktree branch is merged into `main`, remove that worktree and its local branch unless the user explicitly asks to keep them.
- Start every non-trivial implementation task with an issue in the `FBOT` team and Football Bot project. Before implementation, verify the issue has no active executor, move it to `In Progress`, and assign it to the agent when possible. Use a dedicated worktree and an issue-based branch name; move the issue to `Done` only after the pull request is merged, CI is green, and the change is in `main`. See `docs/linear.md` for the complete workflow and exceptions.

## Production verification

- Production deployment, migrations, webhook registration, BotFather changes, and Telegram messages still require explicit owner authorization.
- `pnpm release:verify-production` is the minimum post-deploy check. It is read-only: it validates GitHub CI and Vercel status, Railway API and Jobs, API health and CORS, the migration ledger, and Telegram webhook health. It must never deploy, migrate, change a webhook, or create Telegram data.
- The command reads only public verifier settings from the ignored `.env.production.local`; do not put Telegram or PostgreSQL secrets in those verifier settings. It requires authenticated `gh` and `railway` CLIs.
- A full publish/vote/idempotency/cancel smoke test is an extended check. Run it only in `Футбол тест` and only after separate explicit owner authorization; never create smoke-test matches in the real group.

## Browser verification

- For every rendered frontend task, use Playwright-based verification before completion.
- Browser-based verification is disabled for this repository because Codex has a known runtime blocker: `sandboxCwd is not a local file URI`. Do not attempt it unless the user explicitly requests it.
- Report any Playwright limitation and do not claim visual QA passed when the relevant check could not run.

## Documentation

- [Documentation index](docs/README.md)
- [Bot guide](docs/bot-guide.md)
- [Architecture](docs/architecture.md)
- [Project structure](docs/project-structure.md)
- [Development guide](docs/development.md)

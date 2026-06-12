# CLAUDE.md — forest-onboard

Guidance for Claude working on this repo. Read this before editing or running the CLI.

## What this is

`forest-onboard` is a CLI (oclif, ESM, TypeScript) that performs a **complete Forest Admin
onboarding end-to-end**: authentication → project creation → `agent-nodejs` scaffolding →
agent start → verification that the environment is live. Built from the `mynewcli` oclif
skeleton.

## Commands (dev)

```sh
yarn install            # deps (note: this repo is on Yarn 4, node-modules linker)
yarn build              # tsc -> dist/   (run after every change before using the bin)
yarn test               # mocha (test/**/*.test.ts)
yarn lint               # eslint (Airbnb/oclif config — strict)
node ./bin/run.js <cmd> # run a command locally (after build)
```

⚠️ **Yarn 4 does NOT auto-run `pre`/`post` scripts.** `yarn test` does NOT run `posttest`
lint. Always run `yarn lint` explicitly. Keep lint at **0 errors** after each change
(warnings from the deprecated `valid-jsdoc` rule are tolerated).

## Architecture

```
src/
  commands/        # oclif commands (file name = command name)
    init.ts        # the main 5-step onboarding orchestrator
    signup.ts      # create an account (email/pass via API, or --oauth in browser)
    login.ts       # authenticate and store the token
    logout.ts      # clear the stored token
  services/
    config.ts        # resolveServerUrl / resolveAppUrl (prod vs dev vs custom)
    credentials.ts   # token persistence (~/.config/forest-onboard/credentials.json, 0600) + JWT exp
    api-client.ts    # ForestApiClient + ForestApiError (native fetch, injectable for tests)
    auth.ts          # ensureLoggedIn: FOREST_TOKEN > stored token > interactive (email/pass+2FA, or OAuth)
    oauth.ts         # OIDC device flow (RFC 8628), raw fetch — Google/SSO login + signup
    signup.ts        # password policy (isValidPassword, PASSWORD_HINT)
    project.ts       # createProject (+ parse default environment + secret)
    scaffolder.ts    # generate the agent-nodejs project files (pure builder + writer)
    database.ts      # --database-url (validate Postgres) OR docker sample Postgres + seed
    agent-runner.ts  # install deps, spawn the agent, capture output
    verifier.ts      # poll until the environment is active (injectable now/sleep)
    process-utils.ts # runCommand / spawnProcess (always shell:false)
    prompts.ts       # real @inquirer prompts (injectable AuthPrompts elsewhere)
    cli-helpers.ts   # shared flags (server/verbose/insecure/oauth) + makeClient
```

**Design rule everywhere:** side effects (fetch, child processes, prompts, clock) are
**injectable** so units test without network/TTY/real time. Keep it that way when extending.

## End-to-end onboarding (how to set up a project)

The whole flow is `init`:

```sh
# Interactive, against production:
node ./bin/run.js init --name "My Project"

# Against a local dev stack, reusing an existing Postgres:
FOREST_URL=http://localhost:3001 node ./bin/run.js init \
  --name "My Project" \
  --database-url postgres://user:pass@localhost:5432/mydb
```

Steps performed (see `commands/init.ts`):
1. **Auth** — `ensureLoggedIn` (reuses a stored token; prompts otherwise).
2. **Project** — `POST /api/projects`, then fetch the env secret.
3. **Database** — provision a docker sample Postgres, or use `--database-url`.
4. **Scaffold + install** — write `<slug>/` (agent-nodejs, `.env`, secrets), `npm install`,
   then `PUT /api/environments/:id` to set `apiEndpoint`.
5. **Start + verify** — spawn the agent, poll `GET /api/environments/:id` until `is_active`.

Run the generated agent later with `cd <slug> && npm start` (the DB must be up).

## Server API contracts (verified against the running server)

Base URL from `resolveServerUrl` (flag `--server` > `$FOREST_URL` > `$FOREST_SERVER_URL` > prod).
All JSON.

| Purpose | Call | Notes |
|---|---|---|
| Login | `POST /api/sessions` `{email,password,timeBasedOneTimePassword?}` | → `{token, refreshToken}` (flat JSON) |
| Signup | `POST /api/users` JSON:API `{email, first_name, last_name, password}` | public; password: ≥8, upper+lower+digit, no space |
| Create project | `POST /api/projects` JSON:API `{name, agent, architecture, databaseType}` | returns existing project if name taken |
| Env secret | `GET /api/environments/:id/secretKey` | → `{secretKey}` (flat JSON) = `FOREST_ENV_SECRET` |
| Set endpoint | `PUT /api/environments/:id` JSON:API `{apiEndpoint}` | declare where the agent listens |
| Verify | `GET /api/environments/:id` | read `is_active` (see snake_case gotcha) |
| App token | `POST /api/application-tokens` JSON:API `{name}` (Bearer = OIDC access token) | → `data.attributes.token` (long-lived) |
| OIDC | `GET /oidc/.well-known/openid-configuration`, `POST /oidc/reg`, `POST /oidc/device/auth`, `POST /oidc/token` | JSON bodies; device grant supported |

## GOTCHAS (learned the hard way — do not re-discover)

1. **Server serializes JSON:API attributes in `snake_case`** (`is_active`, `api_endpoint`,
   `first_name`, `secret_key`), NOT camelCase. Reading `attributes.isActive` returns
   `undefined` → false negatives. `api-client.ts` reads `is_active` (with camelCase
   fallback). When parsing any new attribute, use the snake_case key. These files carry a
   file-level `/* eslint-disable camelcase */` for this reason (`api-client.ts`, `oauth.ts`,
   `project.ts`, and snake_case test files).

2. **@inquirer prompts need a real TTY.** Piping stdin (`printf ... | node bin/run.js`) makes
   the first prompt swallow all input and later prompts hit EOF. To drive interactive
   commands in automation, allocate a PTY with `expect`:
   ```sh
   expect <<'EOF'
   set timeout 420
   spawn node ./bin/run.js init --name "My Project"
   expect "Email"; send "me@example.com\r"
   expect "Mot de passe"; send "Password1\r"
   expect eof
   EOF
   ```

3. **OAuth device flow needs an existing web session.** Forest's `/oidc/confirm` page (and
   `/oidc/auth`) require being logged into the app, and the post-login redirect drops the
   `?user_code` query param → user lands on the home page, "no code". Fix in UX: log in to
   the app FIRST, THEN open the complete confirm URL (`/oidc/confirm?user_code=...`) — the
   page reads the code from the URL (no manual field). There is **no Google signup API** for
   a CLI: a Google account is created in the browser on first sign-in; `signup --oauth` and
   `login --oauth` are the same device flow.

4. **OIDC discovery returns the server's PUBLIC host** (e.g. `api.development.forestadmin.com`)
   even when you pass `--server http://localhost:3001`. `oauth.ts` uses the endpoints FROM
   discovery — that's correct (matches the official forest-cli).

5. **Docker sample DB uses host port 5446.** If a leftover `sample-db` container holds it,
   reuse it via `--database-url postgres://postgres:forest@localhost:5446/sample` instead of
   re-provisioning (avoids the port clash). Agent listens on `3310` (override `--port`).

6. **The agent posts its schema on start** ("Schema was updated, sending new version" in
   `agent.log`) — that's what flips `is_active` true. The env's `apiEndpoint` is `localhost`,
   which Forest's cloud does NOT need to reach for a dev environment.

7. **`GET /api/layout/:p/:e/:t` ALWAYS returns `[]`** — by construction: the patch
   controller reads `rendering['layout']` but the renderings table has no `layout` column
   (it has sections/collections/dashboards/workspaces/inboxes). The real read path for the
   layout domain is `GET /api/renderings/:p/:e/:t` (JSON:API, snake_case, resources split
   into `included`); `src/services/layout/rendering-mapper.ts` inverts it into the
   patchable configuration shape. Folders/workflows GETs work as documented. Wire quirks:
   columns expose `is_hidden` (canonical `isVisible = !is_hidden`); resource ids are
   prefixed `<collection>-<field>`.

8. **Layout PATCH semantics**: body = raw RFC 6902 array; headers `forest-environment-id`
   + `forest-team-id` required; ids in paths are NAMES or numeric/uuid ids (never array
   indexes); reorders are `replace .../position`; 422 body carries
   `Not-supported patch: {op:'…',path:'…'}` (mapped back to the YAML key by
   `plan-format.ts`). The diff engine only emits ops pre-validated against the whitelist
   mirror in `patch-rules.ts` — keep it in sync with the server's
   make-layout-patch-patterns.ts when extending.

9. **BEFORE composing any layout patch, read `docs/LAYOUT-PATCHES.md`** — the full catalog
   of supported paths/ops/value shapes (charts, workspace components, folders, workflows,
   premium gates, known traps), verified against the live server. Use it instead of
   re-reading the forestadmin-server source. Manual snapshot (June 2026): on an unexpected
   422, the server may have evolved — re-check the source patterns then update the doc.

## Auth & credentials

- Token precedence: `FOREST_TOKEN` env > stored file (checked for JWT expiry) > interactive.
- Stored at `~/.config/forest-onboard/credentials.json` (file 0600, dir 0700), keyed by
  server URL so prod and dev tokens don't collide.
- `--verbose` logs HTTP with secrets redacted; `--insecure` (explicit) disables TLS verify
  for local https dev only.

## Conventions

- ESM + `Node16` module resolution → **relative imports need the `.js` extension**.
- Errors: throw typed errors (`ForestApiError`, `AuthError`, `DatabaseError`, `ProjectError`,
  `OAuthError`), never raw strings; `init` maps them to clean CLI exits.
- French user-facing strings; English code/comments.
- Add tests for every service (`test/services/*.test.ts`); commands are validated via the
  end-to-end run (and PTY for interactive ones).

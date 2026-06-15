castor 🦫
=========

**Build your Forest with your castor companion.**

`castor` is a CLI (oclif, TypeScript, ESM) that covers the whole lifecycle of a Forest
Admin project from the terminal: end-to-end **onboarding**, **layout-as-code**,
**driving the agent's data**, and the **workflow engine** (create, run, executor).

## Install (dev)

```sh
yarn install
yarn build          # tsc -> dist/  (re-run after each change)
node ./bin/run.js <command>
```

> Yarn 4, node-modules linker. `yarn test` does NOT run `yarn lint` (Yarn 4 doesn't run
> `pre/post` scripts) — run `yarn lint` explicitly, target **0 errors**.

## 1. Onboarding — `init`

From zero to a running Forest agent in one command: login → project creation → database
→ `agent-nodejs` scaffolding → start → verification.

```sh
# Interactive, against production:
node ./bin/run.js init --name "My Project"

# Against a dev server, reusing an existing database:
FOREST_URL=http://localhost:3001 node ./bin/run.js init \
  --name "My Project" \
  --database-url postgres://user:pass@localhost:5432/mydb

# With a workflow executor wired in from the start:
node ./bin/run.js init --name "My Project" --with-executor
```

Without `--database-url`, a sample Postgres database is provisioned via Docker.
Auth: `login`, `signup` (email/password or `--oauth` for Google/SSO), `logout`.

**Long-lived token** — the session token is short-lived; for unattended/CI use, mint a
~100-year application token:

```sh
node ./bin/run.js token create --name "ci @my-laptop"   # prints the token
node ./bin/run.js token create --save                   # also stores it (stay logged in)
```

Use the printed token as `$FOREST_TOKEN`, or `--save` to keep `castor` logged in without
re-login. Treat it like a password; revoke it from the Forest UI if it leaks.

## 2. Layout-as-code — `layout`

Version and apply the layout (collections, dashboards, folders, workflows) as code.

```sh
node ./bin/run.js layout pull            # export the layout to forest-layout.yml
node ./bin/run.js layout diff            # plan of changes
node ./bin/run.js layout apply           # apply (atomic patch per domain)
node ./bin/run.js layout patch --domain layout --file ops.json   # raw JSON Patch
```

Full catalog of supported patches: **`docs/LAYOUT-PATCHES.md`**.

## 3. Drive the agent — `agent`

Query and mutate the data served by a running agent (via `@forestadmin/agent-client`,
with a token minted locally from `FOREST_AUTH_SECRET`).

```sh
node ./bin/run.js agent describe customers --project-dir ./my-project
node ./bin/run.js agent list customers --filter '{"field":"email","operator":"Contains","value":"a"}'
node ./bin/run.js agent create customers --data '{"email":"a@b.com"}'
node ./bin/run.js agent export orders -o orders.csv
```

Subcommands: `describe, list, get, count, create, update, delete, export, relation,
associate, dissociate, action, chart`.

## 4. Workflows — `workflow`

Create, run and drive the **workflow orchestrator engine** (orchestrator-engine
environments only).

```sh
# Create a workflow from a YAML spec (compiled to BPMN):
node ./bin/run.js workflow create -f workflow.yml --project "My Project"

# Run it end-to-end (autopilot):
node ./bin/run.js workflow run --workflow <uuid> --collection customers --record 1 \
  --project-dir ./my-project --inputs '{"1":{"userConfirmed":true,"value":"x@y.z"}}'

# Install + start the workflow executor (the service that runs the steps):
node ./bin/run.js workflow setup-executor --project-dir ./my-project --in-memory
```

Example spec (`workflow.yml`):

```yaml
name: Update the email
collection: customers
steps:
  - {id: read, type: read, title: Read the record, auto: true, next: update}
  - {id: update, type: update, title: Update the email, next: done}
  - {id: done, type: end, title: Finished}
```

Subcommands: `create, run, list, start, resume, continue, revise, abort,
handle-manually, escalate, trigger` + `setup-executor`.
The full runtime model (state machine, drive loop, per-step-type payloads) is documented
in **`docs/WORKFLOWS.md`**.

## 5. Public API — `public-api`

Read Forest's **public API** (a separate, versioned, read-only REST API for audit and
observability data). Project/environment are resolved by name from the scope flags.

```sh
node ./bin/run.js public-api activity-logs --project "My Project" --env Production --limit 20
node ./bin/run.js public-api activity-logs --collection customers --action update
node ./bin/run.js public-api notes --collection customers --record 42
node ./bin/run.js public-api admin-logs --resource Team --type update --created-after 2026-06-01
```

Subcommands: `activity-logs`, `notes`, `admin-logs`. Shared filters: `--limit` (1-100),
`--user-email`, `--user-id`, `--created-after/before` (ISO). Auth reuses your session
token; pass a long-lived application token via `--api-token` / `$FOREST_API_TOKEN` for
unattended use. The host is derived from `--server` (`api.*` → `public-api.*`) or set with
`--public-api-url` / `$FOREST_PUBLIC_API_URL`. These endpoints are **plan-gated** — a `402`
means the feature isn't enabled on your Forest plan.

## Conventions

- ESM + `Node16` → relative imports carry the `.js` extension.
- Typed errors (`ForestApiError`, `AuthError`, `WorkflowError`, `AgentError`, …), never
  raw strings.
- Side effects (fetch, processes, prompts, clock) are **injectable** for tests.
- English everywhere — `castor` (French for "beaver") is just the brand name.
- Token stored at `~/.config/castor/credentials.json` (0600), keyed by server URL.

## Tests

```sh
yarn test           # mocha (test/**/*.test.ts)
yarn lint           # eslint — expect 0 errors
```

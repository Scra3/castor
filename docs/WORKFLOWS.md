# Driving Forest Admin workflows from the CLI

How the **workflow engine orchestrator** actually behaves at runtime, learned by
driving real runs end-to-end with the `workflow` topic. Read this before scripting
workflow runs — the state machine has non-obvious traps.

Verified June 2026 against `forestadmin-server` (`packages/private-api/.../workflow-orchestrator`)
and `@forestadmin/workflow-executor` (agent-nodejs), driving runs on a live agent.

---

## 1. The three moving parts

| Part | Holds | How the CLI talks to it |
|---|---|---|
| **Orchestrator** (Forest server, `/api/workflow-orchestrator/*`) | run **STATE**: `workflowHistory`, `runState`, step definitions | Bearer session JWT + header `forest-rendering-id`. Ops: start/resume/continue/revise/abort/handle-manually/escalate |
| **Executor** (`@forestadmin/workflow-executor`, separate process, port 3400) | per-step **DATA**: `executionResult`, `updatedValues`, `selectedRecordRef` | `GET /runs/:runId`, `POST /runs/:runId/trigger` — Bearer JWT minted from `FOREST_AUTH_SECRET` (node:http; native fetch fails against its koa server). Polls the orchestrator + runs steps against the agent. |
| **Agent** | the actual data (collections) | the executor reads/writes records via agent-client; the agent also **proxies** trigger/status to the executor at `/_internal/workflow-executions/:runId[/trigger]` **only when started with `workflowExecutorUrl`** (this is what exposes the executor to Forest's UI). |

**Prerequisite:** the environment must run the **orchestrator** engine
(`workflowEngine: 'orchestrator'`). On a `browser` env every op fails with a clear
`WorkflowError` (the CLI checks up front). The executor needs **Node ≥ 22.12.0**.

---

## 2. Run state machine (the important part)

States (`WorkflowRunState`): `loading` · `pending` · `started` · `aborted` · `finished`.

After a step finishes, the orchestrator sets the next state from the step's
`executionType` and **whether the run was claimed by the executor's poll**
(`workflow-history-navigator.ts`):

| step executionType | driven by **trigger** | claimed by the **30 s poll** |
|---|---|---|
| `fully-automated` / `automated-with-confirmation` | → **`pending`** (re-triggerable) | → **`loading`** ⚠️ |
| manual (no auto) | → `started` | → `started` |

- **`trigger` (executor) accepts only `started` / `pending`** → a `loading` run is
  **not triggerable** (`404 "Run not found or unavailable"`).
- **`continue` (orchestrator) needs `started`** (`getStartedWorkflowRunById`) → a
  `pending`/`loading`/locked run gives `409 "not in loading or started state"`.
- **`resume` is read-only** (hydrates state, re-assigns the run to you, logs) — safe
  to call any time; it does NOT change the run state.

### ⚠️ The "loading" trap
If the executor's background poll (every `POLLING_INTERVAL_S`, default 30 s) **claims**
the run and runs an automatic step, the run lands in **`loading`** — which is neither
triggerable nor continuable, and you're stuck until the lock expires.
**→ Drive runs yourself with `trigger`, faster than the poll interval.** A
trigger-driven step leaves the run in `started`/`pending`, so you keep control.
(`workflow abort <runId>` to recover a wedged run.)

---

## 3. The drive loop that works

```sh
S="--project P --env E --team T --yes"                 # orchestrator scope
SE="$S --project-dir ./agent-dir --executor-port 3400" # + executor access (reads FOREST_AUTH_SECRET)

# 1. create the run (state: pending)
RID=$(forest-onboard workflow start --workflow <uuid> --collection <col> --record <id> $S | grep '"id"' | head -1 | grep -oE '[0-9]+')

# 2. run step 0 (e.g. read/get-data) — run becomes "started"
forest-onboard workflow trigger $RID $SE

# 3. advance to the next step (orchestrator) — dispatches it, run becomes "pending"
forest-onboard workflow continue $RID $S

# 4. an input/confirmation step runs its FIRST CALL (computes + saves pendingData,
#    state "awaiting-input"). For update-record this happens once the step is dispatched.
forest-onboard workflow trigger $RID $SE                       # first call (no data)

# 5. CONFIRM with the input — this is the call that actually applies the step
forest-onboard workflow trigger $RID $SE --data '{"userConfirmed":true,"value":"<new value>"}'

# 6. advance until the End step → "finished"
forest-onboard workflow continue $RID $S
```

> **Two triggers on an input step.** The first trigger is the step's *first call*
> (the executor computes the field/value and stores `pendingData`, returning
> `awaiting-input`); a confirm payload sent on that first call is **ignored**. The
> **second** trigger, with `{userConfirmed:true, …}`, is what executes it. Sending
> only one data-trigger silently leaves the record unchanged.

---

## 4. `trigger` payloads per step type

`POST /runs/:runId/trigger` body is `{ "pendingData": <patch> }`. The executor
validates `<patch>` with a **strict** zod schema per step type
(`workflow-executor/src/http/pending-data-validators.ts`) → wrong shape = `503
"This step couldn't be completed"` / "Unrecognized key". Verified shapes:

| step type | `pendingData` patch |
|---|---|
| `update-record` | `{ "userConfirmed": true, "value"?: <new field value> }` — `value` overrides the auto-suggested value (omit to accept it; `userConfirmed:false` skips the update) |
| `condition` | `{ "selectedOption": "<branch>" }` |
| `trigger-action` | `{ "userConfirmed": true, "actionResult"?: <opaque> }` |
| `mcp` | `{ "userConfirmed": true }` |
| `load-related-record` | `{ "userConfirmed"?: bool, "fieldName"?: string, "selectedRecordId"?: string[] }` |
| `guidance` | `{ "userInput"?: string }` |

The CLI's `trigger --data '<json>'` passes the JSON straight through as `pendingData`.

---

## 5. Assembled view (`resume --project-dir …`)

`resume` returns the orchestrator run; with `--project-dir` (+ `--executor-port`) it
also fetches `GET /runs/:runId` from the executor and **merges per-step data by
`stepIndex`** into `workflowHistory[].execution`. So one call shows both *what* each
step did (definition, `done`, status) and *the data* it read/wrote
(`executionResult.fields`, `updatedValues`). Without `--project-dir` it shows
orchestrator state only (best-effort: an unreachable executor just warns).

---

## 6. HTTP error cheat-sheet (observed)

- `409 active workflow run already exists … on record` → one active run per
  (workflow, record); `abort` the old one first.
- `409 not in loading or started state` → `continue` on a non-`started` run (it was
  poll-claimed into `loading`, or is `pending`). Drive via `trigger`, or `abort`.
- `404 Run not found or unavailable` → `trigger` on a `loading`/`finished`/`aborted`
  run (executor only serves `started`/`pending`).
- `503 This step couldn't be completed` → wrong `pendingData` shape (see §4), or the
  run isn't retrievable yet.
- `403` (orchestrator) → wrong engine / no access to the rendering.

---

## 7. Endpoints (reference)

**Orchestrator** — Bearer + `forest-rendering-id`, response `{status, response}` (the
CLI returns `response`; some builds return the run raw): `POST /start`
`{workflowId,collectionId,selectedRecordId}` · `GET /resume/:runId` ·
`POST /continue/:runId` · `POST /revise {runId,stepIndex}` · `POST /abort/:runId` ·
`POST /handle-manually/:runId` · `POST /escalate/:runId {inboxId}`.
**Executor** — Bearer (HS256 from `FOREST_AUTH_SECRET`): `GET /health` ·
`GET /runs/:runId` · `POST /runs/:runId/trigger {pendingData}`. Executor↔orchestrator
endpoints (`pending-run`, `update-step`, `available-run`, `collection-schema`,
`access-check`) use `forest-secret-key` and are internal — not driven from the CLI.

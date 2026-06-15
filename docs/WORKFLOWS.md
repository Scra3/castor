# Driving Forest Admin workflows from the CLI

How the **workflow engine orchestrator** behaves at runtime, and how to drive a run
with the `workflow` topic. Read this before scripting workflow runs — the state
machine has a few non-obvious rules.

Source of truth: `forestadmin-server` (`packages/private-api/.../workflow-orchestrator`)
and `@forestadmin/workflow-executor` (agent-nodejs). Snapshot June 2026 — on an
unexpected status, re-check those sources.

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
| `fully-automated` / `automated-with-confirmation` | → **`pending`** (re-triggerable) | → **`loading`** (executor-owned) |
| manual (no auto) | → `started` | → `started` |

- **`trigger` (executor) accepts only `started` / `pending`** → a `loading` run is
  **not triggerable** (`404 "Run not found or unavailable"`).
- **`continue` (orchestrator) needs `started`** (`getStartedWorkflowRunById`) → a
  `pending`/`loading`/locked run gives `409 "not in loading or started state"`.
- **`resume` is read-only** (hydrates state, re-assigns the run to you, logs) — safe
  to call any time; it does NOT change the run state.

### `loading` = the executor owns the run (poll contention)
`loading` is the run's initial state at `start`, and the state an automatic step lands
in when the run was **claimed by the executor's background poll** (every
`POLLING_INTERVAL_S`, default 30 s): the run is locked (`lockedAt` set) and the executor
is the party expected to advance it. It is not an error — the executor processes
`loading` runs itself, and orphaned locks expire (`releaseExpiredLockedRuns`).

It only matters when **you** drive a run by hand: `trigger`/`continue` act on
`started`/`pending`, not `loading`, so if the poll claims the run mid-drive your manual
loop and the executor contend for it. To stay in control, drive with `trigger` faster
than the poll interval (a trigger-driven step leaves the run `started`/`pending`); if a
run is wedged in `loading`, wait for the lock to expire or `workflow abort <runId>`.

### Transient trigger races (retry, don't fail)
A `trigger` can hit a window where the orchestrator has **no claimable step** for the run
*right now* — just after `start`/`continue`, or while the 30 s poll holds it. The executor
then returns a **transient** status, not a real failure:
`404` (RunNotFound "not found or unavailable") · `503` (store/port transient) · `400` whose
body matches `already being processed` (RunAlreadyInFlight). This is **not** a concurrency
limit — the executor runs many runs in parallel; it's the orchestrator's atomic claim
returning nothing for that instant. **Retry with backoff.** Everything else is fatal and must
**not** be retried: other `400` (e.g. `InvalidPendingData` "request body is invalid"), `403`
(UserMismatch), parse/network errors. (`workflow run` does this automatically —
`isTransientTriggerError` + `triggerExecutorRunWithRetry`, `--trigger-retries`; so N parallel
`workflow run` finish reliably without staggering launches.)

---

## 3. The drive loop (any workflow, any number/order of steps)

A workflow is an arbitrary graph of steps (read, condition, update, action, mcp,
escalation, sub-workflow, end…). You don't hardcode a fixed sequence — you **loop**
until `runState` is `finished`, reacting to whatever the current step needs:

```
start the run
loop until runState == finished (or aborted):
    state = resume(runId)                      # read-only snapshot (state + assembled data)
    last  = state.workflowHistory[-1]
    if last.done:                              # current step finished → move on
        continue(runId)                        # orchestrator dispatches the next step
    else if last needs input (awaiting-input): # an interactive step is waiting
        trigger(runId)                         # 1st call: lets the executor compute + save pendingData
        trigger(runId, pendingData=<patch for last.type>)   # 2nd call: confirm/supply input (§4)
    else:                                      # an automated step is queued but not run yet
        trigger(runId)                         # run it now (don't wait for the 30 s poll)
```

Key invariants (independent of the workflow's shape):
- **`trigger` runs the current step on the executor; `continue` advances to the next
  step on the orchestrator.** Alternate between them as steps complete.
- **An interactive step needs TWO triggers**: the *first call* makes the executor
  compute and store `pendingData` (→ `awaiting-input`); a confirm payload sent on that
  first call is **ignored**. The **second** trigger, with the patch for that step type
  (§4), is what actually executes it. One data-trigger alone silently does nothing.
- **Fully-automated steps** take a single `trigger` (no input) and then `continue`.
- Keep driving with `trigger` faster than the poll interval to avoid contending with the poll over a `loading` run (§2); `resume` between calls is free and tells you exactly what to do next.

Examples of the same loop on different step graphs:
- read → update → end: `start · trigger · continue · trigger · trigger(confirm
  `{userConfirmed,value}`) · continue`.
- condition → action → end: `start · trigger · continue · trigger(confirm
  `{selectedOption}`) · continue · trigger · trigger(confirm `{userConfirmed}`) ·
  continue`.

---

## 4. `trigger` payloads per step type

`POST /runs/:runId/trigger` body is `{ "pendingData": <patch> }`. The executor
validates `<patch>` with a **strict** zod schema per step type
(`workflow-executor/src/http/pending-data-validators.ts`) → wrong shape = `503
"This step couldn't be completed"` / "Unrecognized key":

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

## 5 bis. Creating a workflow (`workflow create`)

`workflow create -f spec.yml` authors a workflow from a YAML spec, compiles it to BPMN,
and deploys it (orchestrator engine only). Three server calls (verified):
1. `patchLayoutDomain('workflows', [add /workflows/-], {environmentId, teamId})` — shell
   `{id(uuid), name, collectionId, segmentIds, isVisible, position}` (name unique per collection).
2. `POST /api/workflows/:id/generate-presigned-request?collectionId=<col>` (header
   `forest-rendering-id`) → `{url, fields}`; **multipart POST** the BPMN to S3 — the
   upload's `x-amz-version-id` is the `bpmnAwsS3Identifier`.
3. `patchLayoutDomain('workflows', [replace /workflows/:id/bpmnAwsS3Identifier])`.

YAML spec = a step graph (`src/services/workflow/bpmn.ts` compiles it):
```yaml
name: Update email
collection: customers
start: read              # optional, defaults to first step
steps:
  - {id: read, type: read, title: Read, auto: true, next: update}
  - {id: update, type: update, title: Update the email, next: done}
  - {id: done, type: end, title: Finished}
# condition: {id: g, type: condition, branches: [{answer: Yes, color: green, next: u}, {answer: No, next: done}]}
```
Step `type` → BPMN: `read`→get-data, `update`→update-data, `guidance`→guideline,
`action`→trigger-action, `mcp`→mcp-server (needs `mcpServerId`), `load-related`→
load-related-record, `condition`→exclusiveGateway (≥2 branches), `escalation`→
intermediateThrowEvent (needs `inboxId`), `end`→endEvent. `auto:true` →
fully-automated (else automated-with-confirmation); `prompt` → forest:description.
**Limit:** the BPMN carries structure + prompt + flags only — per-field args (read/
update) and action wiring resolve at runtime (AI + prompt + the `trigger` input).

---

## 6. HTTP error cheat-sheet

- `409 active workflow run already exists … on record` → one active run per
  (workflow, record); `abort` the old one first.
- `409 not in loading or started state` → `continue` on a non-`started` run (it was
  claimed by the poll into `loading`, or is `pending`). Drive via `trigger`, or `abort`.
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

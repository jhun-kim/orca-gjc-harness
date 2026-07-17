---
name: orca-gjc-harness
description: Run GJC coding agents as constrained workers in Orca-owned child worktrees, task dispatches, terminals, evidence, validation, and cleanup. Use only for an Orca-supervised run with a verified GJC binary; otherwise use the non-GJC direct workflow boundary.
---

# Orca GJC Harness

Orca is the sole control plane. It owns the run manifest, task DAG, worktrees, terminals, prompt delivery, decisions, integration, validation, evidence, and cleanup. GJC is a stateless worker process inside a single Orca-created child worktree; it must not create worktrees, tmux teams, daemons, nested harnesses, plugins, setup/update operations, or any second coordination plane.

## Activation and boundary

Activate only when all conditions hold:

1. The coordinator is running inside an Orca-managed worktree and `orca status --json` is healthy.
2. The requested work benefits from isolated GJC workers rather than a direct local workflow.
3. The intended `gjc` executable and requested model have passed the trusted-controller preflight below.
4. The repository trust gate permits the required worker tools and commands.

Do not activate for a missing, untrusted, or model-incompatible GJC binary; an unavailable Orca runtime; a request needing parent-checkout mutation; a task that cannot fit an isolated worktree; or work requiring credentials that cannot stay outside prompts, logs, artifacts, and command lines. Stop this harness and transfer ownership to a separately scoped, non-GJC direct workflow. Do not silently substitute another agent, provider, model, effort, terminal manager, or worktree manager.

## Hard invariants

- Orca creates every task, dispatch, child worktree, and terminal. GJC is never invoked with `--worktree`, `--tmux`, `team`, `harness`, `daemon`, `setup`, `update`, `plugin`, `completion --install`, or a global-default mutation command.
- The parent worktree is read-only to this harness: never commit, merge, push, reset, stash, clean, delete branches, or change its checkout.
- One writer owns each path or module at a time. Shared manifests, generated files, lockfiles, migrations, and glue belong to an explicit integration worker.
- The manifest is the authoritative run record. Every artifact, task, dispatch, terminal, worktree, handoff, validation, and cleanup decision is run-scoped.
- Never place a secret, token, authorization header, credential file, shell snapshot, environment dump, or credential-helper output in a prompt, receipt, artifact, diff, terminal title, or completion message.
- Fail closed on an ambiguous handle, changed immutable input, missing handoff hash, model mismatch, dirty/unknown state, or unverified result. Preserve evidence; never repair uncertainty with reset, stash, clean, or deletion.

## Preflight and trust

Create a lowercase run identifier matching `^[a-z0-9][a-z0-9-]{0,62}$`, a UTC timestamp, and a private evidence root outside the repository. Before writing or dispatching, record all of these in the run manifest:

```text
orca status --json
orca worktree current --json
orca orchestration task-list --json
orca terminal list --json
orca worktree ps --json
git rev-parse --show-toplevel
git branch --show-current
git rev-parse --verify HEAD
git status --porcelain=v1 --untracked-files=all
```

Classify the target as `trusted`, `untrusted`, or `unknown`; locality does not imply trust. Inventory without executing repository content: setup policy, Git hooks and `core.hooksPath`, lifecycle scripts, proposed tests/builds, submodules, symlinks, tracked and untracked `.env` files, `.gjc`/plugin registries, LSP/MCP configuration, executable files, and shell startup exposure. Record the evidence and the policy decision.

For `unknown` or `untrusted`, use `orca worktree create --setup skip` and do not run repository-controlled setup, hooks, lifecycle scripts, binaries, tests, shell/profile commands, project plugins, LSP servers, or MCP servers until the relevant command gate is recorded. `--setup skip` is not enough if checkout hooks can still execute; block worktree creation unless the hook boundary is disabled or explicitly approved. Untrusted execution needs an approved OS/container sandbox with a narrow environment; otherwise stop.

## GJC binary, model, and environment gate

Resolve the absolute `gjc` executable outside the target repository. From a clean controller directory, record its absolute path, version/package output, SHA-256, installation provenance, `--help` result, and `--list-models` result. Do not execute a repository-provided GJC wrapper during preflight.

Default routing is provider `openai-codex`, model `gpt-5.6-sol`, `high` thinking, and the verified context limit reported by the selected GJC model catalog. Verify that exact provider/model selector in trusted-context `gjc --list-models` output before dispatch. GJC 0.11.1 accepts `ultra`, `high`, `medium`, and `low` thinking values. The manifest records separate requested and resolved provider, model, thinking, and context-limit values; whether clamping occurred; every adjustment with evidence; the ordered fallback attempts; a rejection reason and hashed receipt for each rejected fallback; and the selected source. The default fallback list is empty. With no selected fallback, requested and resolved provider/model must match. A different worker route requires a separate reviewed run manifest rather than a duplicated per-task runtime identity.

Every worker invocation supplies explicit flags:

```text
gjc --model openai-codex/gpt-5.6-sol --thinking high --session-dir /private/<run>/runtime/session --no-session --no-extensions --no-skills --no-rules --no-pty --tools read,search,find
```

`--model` selects a model; `--thinking` accepts `ultra`, `high`, `medium`, or `low`; `--session-dir` identifies the run-private session directory; `--no-session` disables session persistence; `--no-extensions`, `--no-skills`, and `--no-rules` disable those project surfaces; `--no-pty` prevents PTY use; and `--tools` is a comma-separated allowlist. Use read-only `read,search,find` first. The `goal` tool can remain enabled despite that allowlist, so a strict read-only run also requires `goal.enabled=false` in the isolated config. Add `edit,write` only for an owned implementation slice. Add `bash` only after a command-specific trust gate.

Do not use `--api-key`, `--mpreset`, `--default`, provider-default persistence, or a command-line secret. `--no-extensions` and `--no-skills` are required controls, but they do not replace configuration isolation and repository trust gates. `--no-pty` alone also does not prevent the bash tool from snapshotting shell rc state.

Configuration, sessions, and authentication are separate. Keep `GJC_CONFIG_DIR` and the `--session-dir` target in fresh run-private directories outside evidence and the repository, and write only the reviewed minimal config needed to set `goal.enabled=false`. Prefer a brokered provider session, but keep every broker or credential selector entirely outside serialized argv, prompts, receipts, evidence, terminal metadata, and completion messages. Persist only authentication mode, authenticated-or-blocked status, a non-secret reason when blocked, and redacted evidence metadata. If broker mode is unavailable, the sole fallback is a constrained `trusted-controller-vault` mapping that reuses only the trusted controller credential store; it must not inspect, copy, export, or serialize credentials. Do not create a fresh `GJC_CODING_AGENT_DIR` when it contains trusted controller authentication state.

Launch GJC with an allowlisted, run-scoped environment. Remove `GJC_SHELL_PREFIX` and legacy aliases; set `GJC_NO_PTY=1`, `GJC_BASH_NO_LOGIN=1`, `SHELL=/bin/sh`, `BASH_ENV=/dev/null`, `ENV=/dev/null`, `GIT_TERMINAL_PROMPT=0`, and `GIT_ASKPASS=/usr/bin/false`; and neutralize Git hooks through reviewed Git environment configuration. Retain only necessary OS variables, temporary directories, and the selected authentication mode. Hash the exact child environment and sanitized native argv without dumping their contents. Never log an authentication selector, credential store, or raw environment.

Before creating a child terminal, execute a non-mutating authenticated model probe with the exact reviewed child environment and launch envelope. Record its mode, authenticated-or-blocked status, timestamp, environment hash, sanitized-argv hash and array, and redacted non-empty artifact. The sanitized argv must omit every credential or broker selector. A failed probe is still a valid blocked receipt, but it forces manifest status `blocked`, an empty task list, and no terminal creation or dispatch; never retry with copied credentials or a weaker environment.
## Baseline and manifest

Before creating a child, capture the parent resolved path, branch-or-detached state, full HEAD object ID, and exact porcelain status. The parent must be clean when a worker needs its base. If a worker depends on dirty parent state, stop this harness; do not launch a same-worktree writer.

Create the durable run root with `manifest.json`, `tasks/`, `handoffs/`, `receipts/`, `validation/`, `cleanup/`, and `logs-redacted/`. Serialize JSON with a real serializer; never build it with shell interpolation. Use [`schemas/run-manifest.schema.json`](schemas/run-manifest.schema.json) and [`templates/run-manifest.template.json`](templates/run-manifest.template.json) as the contract. Record the run identity, parent invariant, trust decision, one runtime resolution and exact-environment probe, selected mode, fixed liveness policy, approval policy, and task records. Each task owns one nested lifecycle object with at most one dispatch, prompt delivery, monitoring record, decision, completion, and cleanup receipt.

Every task record includes its returned task ID, phase, dependencies, required flag, one child-worktree identity and recorded base, exclusive ownership, literal prompt path/hash/bytes, acceptance criteria, native-argv validation commands, hashed handoff inputs/outputs, and its singular lifecycle. The dispatch ID and terminal identity exist once in that lifecycle and every prompt, decision, and completion receipt binds back to them. The worker spec repeats the reviewed provider/model/thinking/context assignment for execution, but the manifest does not create an unconstrained per-task copy of runtime identity. Accept only exact IDs returned by Orca and filter runtime-global task listings to manifest IDs.

Validate every manifest with standards-compliant draft-2020 JSON Schema plus format validation, then run the dependency-free dynamic checks:

```text
bun schemas/validate-run-manifest.mjs /private/<run>/manifest.json
```

[`schemas/validate-run-manifest.mjs`](schemas/validate-run-manifest.mjs) enforces dynamic equality, uniqueness, timestamp/cursor ordering, fallback resolution, exact launch-envelope binding, and liveness windows that JSON Schema cannot compare.

## Mode and DAG selection

Choose the smallest primary mode and write the reason before any worker dispatch:

| Mode | Use when | Required shape |
| --- | --- | --- |
| `single` | One narrow, coherent ownership surface | worker → validation → report → cleanup |
| `race` | Two to four materially different candidates improve a decision | isolated equal-base workers → selector/validator → optional integration → cleanup |
| `parallel-build` | Slices have disjoint paths and a stable contract | preflight → workers in parallel → conditional integration → validation → report → cleanup |
| `pipeline` | A later stage consumes a verified earlier artifact | stage → hashed handoff → next stage → integration/validation → report → cleanup |

`integration` is conditional, not a primary mode. Add it only when verified outputs must combine or a selected output cannot land cleanly on the recorded base. In a pipeline, a downstream node starts only after each required upstream receipt, schema, artifact existence, and SHA-256 match. Failed optional nodes remain recorded and skipped; required failures block downstream work.

Use one writer per ownership surface. Race workers may overlap only in separate children. Give integration exclusive ownership over shared files and list source full OIDs, expected paths, commit order, acceptance checks, and rollback/preservation handling in the manifest.

## Orca-owned child creation and prompt proof

Create only the ready DAG wave through Orca. For each worker, create one Orca child worktree at the immutable recorded base with the approved setup decision. A successful exact-environment authenticated probe is a hard prerequisite for the single dispatch and terminal nested in that task lifecycle. Capture the Orca-returned dispatch ID, terminal handle, and stable terminal identity. Never choose a replacement by title or ordering. Rebind only if exactly one live terminal matches the recorded worktree, title, resolved route, agent type, handle, and stable identity; otherwise block.

Write the worker spec as a literal run-owned file before dispatch; its SHA-256 and byte count are immutable prompt input. Dispatch once with `orca orchestration dispatch --inject`. Prompt acceptance has a hard 60-second window and one delivery attempt with no resend. Before any `orca orchestration check --wait` or other long wait, record `dispatch-show`, then the ordered phase tuple: a pre-submit terminal read with cursor/timestamp/evidence; exactly one Enter only when that read proves the pasted composer is visible; and a later terminal read with a strictly greater cursor/timestamp proving the exact dispatch terminal and stable identity are `active`. Record `acceptedAt` only after that active evidence and never before dispatch creation. If the prompt is already active, record pre/post active reads and zero Enters. Wrong or stale identity, duplicate delivery, unchanged composer, unknown state, nonmonotonic evidence, or no active evidence by the deadline produces a blocked receipt with `longWaitAllowed=false`.

Use [`templates/worker-task.md`](templates/worker-task.md) as the canonical content shape. The coordinator fills all factual values from the manifest before hashing and dispatching; it never lets GJC construct its own lifecycle spec.

## Liveness, decisions, and exactly-once completion

A worker sends a heartbeat to the concrete coordinator every five minutes while active. The payload includes the run ID and live `taskId`/`dispatchId`; text output alone is not health proof. After prompt acceptance, the coordinator polls required active workers in repeated bounded windows of at most 60 seconds. Active evidence must remain inside a 120-second liveness window, and required work is never abandoned while it remains active. Optional work receives no grace until every required deliverable has a successful receipt; its grace is 60 seconds by default and may be explicitly configured only up to 120 seconds.

The manifest serializes the approval policy. The coordinator automatically records and resolves a `Recommended` or `Approve` choice only when it is reversible, in the owned scope, and plan-preserving; no local human prompt is opened. Destructive, irreversible, credential, secret, external-production, parent-mutation, merge, push, deploy, and material scope changes go through Orca escalation unless the exact action was pre-authorized. A worker needing an ineligible decision uses `orca orchestration ask` or a recorded decision gate, then blocks for the coordinator response.

Each task lifecycle can contain only one completion object, and each worker must send exactly one `worker_done` whether its receipt `status` is `success`, `failure`, or `blocked`. It goes to the concrete coordinator with the live task and dispatch IDs injected by Orca. The semantic validator rejects stale identities; a stale retry cannot complete the task. The payload conforms to [`schemas/completion-receipt.schema.json`](schemas/completion-receipt.schema.json), names non-empty evidence artifacts, and includes branch, full HEAD, recorded base, changed files, diff stat, exact command exit codes, manual QA, risks, and cleanup receipt. After `worker_done`, the worker stops and does not poll, resend, or start unrelated work.

On silence, capture terminal and process state, classify the checkout as clean, zero-delta, dirty, deleted-worktree, or unknown, preserve branch/diff/untracked/manifest/terminal evidence, and use only that recorded recovery class. Dirty and unknown states are preservation outcomes; deleted or unverifiable state is cleanup-blocked. None may be marked removed or used as an implicit retry signal.
## Handoffs, integration, validation, and cleanup

A handoff is consumable only when its schema validates, every referenced artifact exists and is non-empty, hashes match, recorded base/HEAD are full immutable IDs, and changed paths stay within the owner scope. Conditional integration uses a new Orca-owned child at the recorded base. Verify candidate object existence, ancestry, parent count, changed names, diff stat, whitespace check, artifact hashes, ownership, and secret scan before applying it. On conflict or ambiguity, record unresolved paths and gate a decision; never continue an unexplained partial integration.

Run approved targeted validation from the owning child or integration child. For every command, record literal argv, cwd, start/end time, exit code, redacted stdout/stderr paths, and artifact hashes. Never evaluate returned text or replace approved runtime validation with source inspection. Validate each run manifest first with Ajv draft 2020 plus formats and then with `bun schemas/validate-run-manifest.mjs <manifest.json>` before integration. Independent review uses a fresh stateless, read-only worker when available; record same-family review correlation as a limitation.

After every required node and validation passes, preserve the selected branch/commit and clean up only run-manifest child worktrees. Each task has at most one cleanup receipt. Confirm task closure, idle/exited terminals, no manifest processes, clean porcelain status, attached branch, branch ref resolving to the preserved full HEAD, and commit object existence. Remove only an exact manifest-owned child whose recorded checkout state is clean or zero-delta, without force. Dirty and unknown children are preserved; deleted, detached, live, or unverifiable children are `cleanup-blocked`. Never serialize any of those states as removed.

Finally recapture the parent path, branch-or-detached state, full HEAD, and exact porcelain status. Compare all fields byte-for-byte with the baseline. Any difference is a parent-invariant breach: report it and stop; do not repair it.

## Final report and publication readiness

The final report names the run ID, manifest path/hash, trust and runtime-policy receipts, selected mode and reason, DAG/ownership/model evidence, prompt and handoff receipts, integration decision, branch/full HEAD, changed files/diff stat, validation commands and exit codes, manual observables, residual risks, cleanup result for every child, and before/after parent-invariant comparison. It explicitly states whether the parent checkout remained unchanged.

GitHub publication is a readiness gate, not a publish command. Before handing off publication, require a clean preserved implementation branch, complete license and README, no dependencies or executable install/build/test hooks, a valid skill frontmatter name, valid JSON schemas/templates, no secrets, no broken relative links, and an independent review receipt. Do not initialize a remote repository, create a GitHub repository, push, tag, release, or publish from this skill.

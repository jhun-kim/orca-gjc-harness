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

Default routing is `openai-codex/gpt-5.6-sol` with `xhigh` thinking. Verify that exact selector in trusted-context `gjc --list-models` output before dispatch. Record requested and resolved provider, model, effort, context limits, and any clamping. A per-task override is allowed only when the immutable manifest explicitly names it, it passes the same model verification, and its risk rationale is recorded. The default fallback list is empty. A non-empty ordered fallback list requires an explicit manifest entry and a receipt for each rejected selector; otherwise a missing selector blocks the run.

Every worker invocation supplies explicit flags:

```text
gjc --model openai-codex/gpt-5.6-sol --thinking xhigh --no-session --no-lsp --no-rules --no-pty --tools read,search,find
```

`--model` selects a model; `--thinking` accepts `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; `--no-session` disables session persistence; `--no-lsp` prevents project LSP autostart; `--no-rules` disables project rules; `--no-pty` sets `PI_NO_PTY=1`; and `--tools` is a comma-separated allowlist of builtin registry keys. Use read-only `read,search,find` first. The `goal` tool can remain enabled despite that allowlist, so a strict read-only run also requires `goal.enabled=false` in the isolated run config. Add `edit,write` only for an owned implementation slice. Add `bash` only after a command-specific trust gate and do not enable LSP until both project configuration and resolved binaries are trusted.

Do not use `--api-key`, `--mpreset`, `--default`, provider-default persistence, or a command-line secret. Neither `--no-extensions` nor `--no-skills` is a containment control: the analyzed active parser does not parse those flags, and arbitrary skill discovery is already disabled in the analyzed source. Isolate GJC state instead, keep project registries absent, and do not rely on extension/skill flags for containment. `--no-pty` alone also does not prevent the bash tool from snapshotting shell rc state.

Launch GJC with an allowlisted, run-scoped environment. Put `GJC_CODING_AGENT_DIR` and `GJC_CONFIG_DIR` in fresh run-private directories outside evidence and the repository, and write only the reviewed minimal config needed to set `goal.enabled=false`. Remove `GJC_SHELL_PREFIX` and legacy aliases; set `GJC_NO_PTY=1`, `GJC_BASH_NO_LOGIN=1`, `SHELL=/bin/sh`, `BASH_ENV=/dev/null`, `ENV=/dev/null`, `GIT_TERMINAL_PROMPT=0`, and `GIT_ASKPASS=/usr/bin/false`; and neutralize Git hooks through reviewed Git environment configuration. Retain only necessary OS variables, temporary directories, and a brokered selected-provider authentication handle. Never log the handle or environment contents.

## Baseline and manifest

Before creating a child, capture the parent resolved path, branch-or-detached state, full HEAD object ID, and exact porcelain status. The parent must be clean when a worker needs its base. If a worker depends on dirty parent state, stop this harness; do not launch a same-worktree writer.

Create the durable run root with `manifest.json`, `tasks/`, `handoffs/`, `receipts/`, `validation/`, `cleanup/`, and `logs-redacted/`. Serialize JSON; never build it with shell interpolation. Use [`schemas/run-manifest.schema.json`](schemas/run-manifest.schema.json) and [`templates/run-manifest.template.json`](templates/run-manifest.template.json) as the contract. Record at least run ID, timestamp, coordinator handle, parent invariant, trust decision, runtime policy, selected mode, tasks, dispatches, worktrees, terminals, prompt receipts, evidence records, and cleanup receipts.

Every task record must include its returned task ID and dispatch ID, phase, dependencies, required flag, child worktree identity, recorded base, exclusive ownership, assigned model and thinking level, prompt path/SHA-256, acceptance criteria, approved validations, handoff inputs/outputs, and terminal status. Requested and resolved model/thinking values belong in runtime policy; any per-task override also needs a hashed resolution/risk artifact. Accept only exact IDs returned by Orca. Filter runtime-global task listings to manifest IDs.

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

Create only the ready DAG wave through Orca. For each worker, create an Orca child worktree at the immutable recorded base with the approved setup decision, then create an Orca terminal using the fixed reviewed GJC command. Wait for terminal readiness, capture Orca-returned worktree ID, terminal handle, and stable terminal identity, then record them. Never pick a stale replacement by title or ordering. Rebind only if exactly one live terminal matches the recorded worktree, title, command/model/effort, agent type, and stable identity; otherwise block.

Write the worker spec as a literal run-owned file before dispatch. Its SHA-256 and byte count are the prompt-delivery input. Dispatch it only with `orca orchestration dispatch --inject`. A valid prompt receipt then requires all of the following: store `orca orchestration dispatch-show` output for the returned task and dispatch IDs; store an `orca terminal read` taken before submission; if that read shows a pasted prompt waiting in the composer, submit exactly one Enter with `orca terminal send --text "" --enter`; and store a second `orca terminal read` proving the composer cleared and the dispatched task became visible or active. The pre-read, optional single-Enter receipt, and post-read must bind to the recorded terminal. A send/inject acknowledgment or worker heartbeat may supplement this proof but never replaces it and never counts alone. Prompt reinjection is allowed once only after proof that the first prompt was not accepted and a retry budget is recorded.

Use [`templates/worker-task.md`](templates/worker-task.md) as the canonical content shape. The coordinator fills all factual values from the manifest before hashing and dispatching; it never lets GJC construct its own lifecycle spec.

## Liveness, decisions, and exactly-once completion

A worker sends a heartbeat to the concrete coordinator every five minutes while active. The payload includes the run ID and live `taskId`/`dispatchId`; text output alone is not health proof. A worker needing a decision uses `orca orchestration ask` or a recorded decision gate, then blocks for the coordinator response. It never asks a human through a local prompt.

Each worker must send exactly one `worker_done`, whether its exact completion `status` is `success`, `failure`, or `blocked`, to the concrete coordinator handle with the live task and dispatch IDs injected by Orca. These receipt values are distinct from Orca task lifecycle states such as `completed` or `failed`. A stale dispatch ID cannot complete a retry. The payload conforms to [`schemas/completion-receipt.schema.json`](schemas/completion-receipt.schema.json), names non-empty evidence artifacts, and includes branch, full HEAD, recorded base, changed files, diff stat, exact command exit codes, manual QA, risks, and cleanup receipt. After `worker_done`, it stops and does not poll or start unrelated work.

On silence, capture terminal and process state, classify the output as clean, zero-delta, dirty, deleted-worktree, or unknown, preserve the branch/diff/untracked manifest/terminal snapshot, and use only the recorded recovery class. Dirty or unknown state is a preservation outcome, not a retry signal.

## Handoffs, integration, validation, and cleanup

A handoff is consumable only when its schema validates, every referenced artifact exists and is non-empty, hashes match, recorded base/HEAD are full immutable IDs, and changed paths stay within the owner scope. Conditional integration uses a new Orca-owned child at the recorded base. Verify candidate object existence, ancestry, parent count, changed names, diff stat, whitespace check, artifact hashes, ownership, and secret scan before applying it. On conflict or ambiguity, record unresolved paths and gate a decision; never continue an unexplained partial integration.

Run approved targeted validation from the owning child or integration child. For every command, record literal argv, cwd, start/end time, exit code, redacted stdout/stderr paths, and artifact hashes. Never replace approved runtime validation with source inspection. Independent review uses a fresh stateless, read-only worker when available; record same-family review correlation as a limitation.

After every required node and validation pass, preserve the selected branch/commit and clean up only run-manifest child worktrees. Confirm task closure, idle/exited terminals, no manifest processes, clean porcelain status, attached branch, branch ref resolving to the preserved full HEAD, and commit object existence. Remove only the exact manifest-owned child through Orca without force. Unknown, dirty, detached, live, or unverifiable children are `cleanup-blocked` and preserved.

Finally recapture the parent path, branch-or-detached state, full HEAD, and exact porcelain status. Compare all fields byte-for-byte with the baseline. Any difference is a parent-invariant breach: report it and stop; do not repair it.

## Final report and publication readiness

The final report names the run ID, manifest path/hash, trust and runtime-policy receipts, selected mode and reason, DAG/ownership/model evidence, prompt and handoff receipts, integration decision, branch/full HEAD, changed files/diff stat, validation commands and exit codes, manual observables, residual risks, cleanup result for every child, and before/after parent-invariant comparison. It explicitly states whether the parent checkout remained unchanged.

GitHub publication is a readiness gate, not a publish command. Before handing off publication, require a clean preserved implementation branch, complete license and README, no dependencies or executable install/build/test hooks, a valid skill frontmatter name, valid JSON schemas/templates, no secrets, no broken relative links, and an independent review receipt. Do not initialize a remote repository, create a GitHub repository, push, tag, release, or publish from this skill.

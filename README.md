# Orca GJC Harness

`orca-gjc-harness` is a dependency-free installable skill for supervising GJC coding agents from Orca. It turns GJC into a narrowly scoped worker while Orca remains responsible for worktree lifecycle, terminals, task/dispatch provenance, evidence, integration, validation, and cleanup.

## What it is for

Use this skill when a coordinator needs isolated GJC workers for a repository task and can prove the following before launch:

- Orca runtime and orchestration are available.
- The target is suitable for a child worktree; the parent remains unchanged.
- The GJC binary, exact requested model, and invocation flags pass controller-side verification.
- Repository trust permits the requested tools and commands.
- Credentials can remain brokered and outside command lines, prompts, logs, receipts, and artifacts.

It is not a GJC team launcher. The worker may edit only the exact Orca-created child worktree and its owned paths. It must not create a worktree, tmux team, daemon, nested harness, plugin, setup/update workflow, or a competing control plane.

## Installation

In the published repository, [`SKILL.md`](SKILL.md) is at the repository root. Clone or copy that root into the host's installable skill location under a directory named `orca-gjc-harness`; do not add another nested payload directory. No package manifest, executable installer, build hook, test hook, or setup script is included. Approved GJC workers still contact their selected model provider at runtime.

The install surface is intentionally small:

```text
orca-gjc-harness/
├── SKILL.md
├── README.md
├── LICENSE
├── schemas/
│   ├── completion-receipt.schema.json
│   ├── run-manifest.schema.json
│   └── validate-run-manifest.mjs
└── templates/
    ├── completion-receipt.template.json
    ├── run-manifest.template.json
    └── worker-task.md
```

## Version management

The repository follows Semantic Versioning. The current compatibility-contract version is
[`1.1.0`](VERSION).

- Only non-automated pushes to `main` allocate release versions; feature-branch
  pushes do not allocate or change one.
- Each completed allocation increments `PATCH` by exactly one (`+0.0.1`).
- GitHub Actions serializes allocations with `queue: max` (up to 100 pending
  runs) and does not cancel an allocation already in progress.
- Automated version commits contain `[skip version-bump]` to prevent recursive
  bumps.
- Each automated version commit receives an annotated `vX.Y.Z` tag.
- The workflow does not create GitHub Releases.

## Operating model

1. **Gate activation.** Confirm Orca, a trustworthy GJC binary, exact model availability, target trust classification, a private run-evidence root, and an authenticated probe with the exact child environment and sanitized launch argv. A blocked probe is preserved as a non-secret receipt and forbids every task, terminal, and dispatch.
2. **Freeze baseline.** Capture the parent worktree path, branch, full HEAD, and porcelain status. Parent mutation is outside this skill.
3. **Create one manifest.** Serialize the run against [`schemas/run-manifest.schema.json`](schemas/run-manifest.schema.json). Record requested/resolved provider, model, thinking, and context limits; clamping; ordered fallback/rejection evidence; exact-environment authentication; the fixed liveness policy; and approval policy. Each task has one nested lifecycle with at most one dispatch, prompt delivery, monitoring record, decision, completion, and cleanup receipt.
4. **Choose a primary mode.** Use `single` for one narrow change, `race` for competing candidates, `parallel-build` for disjoint ownership, and `pipeline` for hash-verified staged work. Integration is conditional only.
5. **Launch through Orca.** Orca creates the child worktree and terminal and injects one literal, hashed task spec. Prompt acceptance fails closed after 60 seconds. Before a long wait, bind `dispatch-show` and the exact task/dispatch/terminal/stable identity to an ordered pre-read, optional single Enter, and post-read with monotonic cursor/timestamp evidence proving `active`; no resend is permitted.
6. **Monitor boundedly.** Poll required active work in repeated windows no longer than 60 seconds, maintain a 120-second liveness window, and never abandon required work while it remains active. Optional work gets 60 seconds of grace by default and at most 120 seconds, only after all required deliverables are verified.
7. **Resolve routine decisions.** Automatically record `Recommended` or `Approve` only for reversible, in-scope, plan-preserving choices; never open a local human prompt. Destructive, irreversible, credential, secret, external-production, parent-mutation, merge, push, deploy, and material scope changes go through Orca escalation unless exactly pre-authorized.
8. **Validate and preserve.** Validate with Ajv draft 2020 plus formats and [`schemas/validate-run-manifest.mjs`](schemas/validate-run-manifest.mjs), accept exactly one identity-bound `worker_done`, preserve dirty/unknown/deleted states, clean only verified run-owned children, and compare parent invariants byte-for-byte.

## GJC invocation safety

The default requested worker route is provider `openai-codex`, model `gpt-5.6-sol`, `high` thinking, and the verified model-catalog context limit. GJC 0.11.1 exposes `ultra`, `high`, `medium`, and `low` thinking values. The manifest records requested and resolved routes separately, every clamp adjustment, an empty fallback list by default, and a hashed reason for every rejected fallback. Without a selected fallback, requested and resolved provider/model must match. All workers in one manifest use that reviewed route; a different route requires a separately reviewed manifest rather than unconstrained per-task identity fields.

Every launch uses an explicit model and thinking level plus these restrictive controls:

```text
gjc --model openai-codex/gpt-5.6-sol --thinking high --session-dir /private/<run>/runtime/session --no-session --no-extensions --no-skills --no-rules --no-pty --tools read,search,find
```

The initial read-only allowlist is `read,search,find`. Because the `goal` tool can remain enabled despite that allowlist, the isolated run config also sets `goal.enabled=false`. An owned implementation task can add `edit,write`; `bash` requires a command-specific trust gate. `--no-extensions`, `--no-skills`, and `--no-rules` are required but complement, rather than replace, state isolation and repository trust gates. Do not pass `--api-key`, use persistent model presets/defaults, dump environment variables, or run GJC global/nested management commands.

## Sanitized run environment

Configuration, session, and authentication isolation are independent. Each worker receives a fresh run-scoped `GJC_CONFIG_DIR` and `--session-dir` outside the target repository and evidence tree; the directories contain only the reviewed minimal config needed to set `goal.enabled=false`. The coordinator removes shell-prefix/legacy aliases, applies a minimal allowlist, hashes the exact child environment without dumping it, and sets `GJC_NO_PTY=1`, `GJC_BASH_NO_LOGIN=1`, `SHELL=/bin/sh`, `BASH_ENV=/dev/null`, `ENV=/dev/null`, `GIT_TERMINAL_PROMPT=0`, and `GIT_ASKPASS=/usr/bin/false`.

Authentication is broker-first, but every broker or credential selector remains outside serialized argv, prompts, receipts, evidence, terminal metadata, and completion messages. The manifest stores only mode, authenticated-or-blocked status, a non-secret blocked reason, exact-environment hashes, sanitized argv, and redacted evidence metadata. If the broker is unavailable, `trusted-controller-vault` is the only fallback: it reuses only the trusted controller credential store while config/session remain isolated and forbids inspection, copying, export, and serialization. Do not replace the controller authentication vault with a fresh `GJC_CODING_AGENT_DIR`.

Before creating a child terminal, the coordinator runs a non-mutating authenticated model probe with the exact reviewed child environment and launch envelope. A successful receipt records timestamp, mode, environment and argv hashes, sanitized selector-free argv, and redacted evidence. A failed probe records the same non-secret metadata with `authenticated=false`, forces manifest status `blocked`, and requires an empty task list—therefore no terminal or dispatch can exist.

## Receipt contracts

- [`templates/run-manifest.template.json`](templates/run-manifest.template.json) is a valid representative run document. Production manifests use real IDs, paths, and hashes and validate against its schema.
- [`schemas/validate-run-manifest.mjs`](schemas/validate-run-manifest.mjs) enforces cross-record identity, uniqueness, runtime equality, timestamp/cursor ordering, fallback selection, prompt deadlines, and liveness windows after draft-2020 schema validation:

  ```text
  bun schemas/validate-run-manifest.mjs /private/<run>/manifest.json
  ```
- [`templates/worker-task.md`](templates/worker-task.md) specifies the immutable facts each worker receives before hashing and Orca injection.
- [`templates/completion-receipt.template.json`](templates/completion-receipt.template.json) is the required worker evidence shape, validated by [`schemas/completion-receipt.schema.json`](schemas/completion-receipt.schema.json).

A prompt-delivery receipt is singular and identity-bound. It records the literal prompt hash, `dispatch-show`, a 60-second acceptance deadline, zero resends, and one ordered tuple: pre-submit read with cursor/timestamp/evidence; exactly one Enter only for a visible composer; and a later post-submit read with greater cursor/timestamp proving the exact terminal is `active`. An already-active prompt records pre/post active reads and zero Enters. `acceptedAt` must follow active evidence and dispatch creation and must not exceed the deadline. Wrong/stale identity, duplicate attempt, unchanged composer, or missing/nonmonotonic active evidence blocks the task and forbids a long wait.

The manifest approval policy names the only automatic results—`recommended` and `approve`—and the task's singular decision receipt proves the choice was reversible, in scope, plan-preserving, and automatically recorded. Everything destructive, irreversible, credential- or secret-related, external-production, parent-mutating, merging, pushing, deploying, or materially scope-changing escalates through Orca unless the exact action is pre-authorized.

A task lifecycle has one completion slot. A `worker_done` event is valid exactly once, sent to the concrete coordinator with the live Orca task and dispatch IDs, and backed by non-empty evidence. Its exact `status` vocabulary is `success`, `failure`, or `blocked`; Orca task states remain separate. The semantic validator rejects stale lifecycle IDs.

A task lifecycle also has one cleanup slot. Only clean or zero-delta state with empty porcelain status may be removed. Dirty and unknown worktrees are preserved; deleted, detached, live, or unverifiable worktrees are cleanup-blocked. None can be serialized as removed.

## Safety boundaries

Never use this skill to:

- create or publish a GitHub repository, push a branch, tag a release, deploy, or publish an artifact;
- mutate the parent checkout, or write from a same-worktree worker;
- bypass a trust gate, hook boundary, model verification, secret boundary, or clean-up verification;
- let GJC create worktrees, tmux sessions, teams, daemons, plugins, nested harnesses, setup/update operations, or global defaults;
- reset, stash, clean, delete, or overwrite dirty/unknown worker state to make a run appear successful.

When a boundary fails, preserve the state and evidence, mark the run blocked or cleanup-blocked, and return control to the Orca coordinator.

## Source facts and licensing

This skill states GJC 0.11.1 CLI behavior observed from installed help: `--session-dir`, `--no-extensions`, `--no-skills`, `--no-rules`, `--no-session`, `--no-pty`, and `--tools` are supported controls; thinking values are `ultra`, `high`, `medium`, and `low`. The skill does not include GJC source code, credential content, credential selectors, or broker selectors. Local binary, model, authentication-probe, and repository-trust verification remain mandatory.

This repository payload is independently licensed under the MIT License in [`LICENSE`](LICENSE).

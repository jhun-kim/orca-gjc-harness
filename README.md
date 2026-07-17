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
│   └── run-manifest.schema.json
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

1. **Gate activation.** Confirm Orca, a trustworthy GJC binary, exact model availability, target trust classification, a private run-evidence root, and an authenticated probe with the exact child environment. Failed or unavailable authentication blocks terminal creation and dispatch.
2. **Freeze baseline.** Capture the parent worktree path, branch, full HEAD, and porcelain status. Parent mutation is outside this skill.
3. **Create one manifest.** Serialize the run against [`schemas/run-manifest.schema.json`](schemas/run-manifest.schema.json), including separated configuration/session/authentication receipts, a redacted authenticated-probe receipt, approval policy, and automatic decision receipts.
4. **Choose a primary mode.** Use `single` for one narrow change, `race` for competing candidates, `parallel-build` for disjoint ownership, and `pipeline` for hash-verified staged work. Integration is conditional only.
5. **Launch through Orca.** Orca creates the child worktree and terminal and injects a literal, hashed task spec. Before any long `orca orchestration check --wait`, acceptance requires `dispatch-show`, a terminal read before submission, exactly one Enter only when a pasted composer is visible, and a post-submit terminal read proving `active`; record that state, `acceptedAt`, and `waitStartedAfterAccepted=true`. A send/inject acknowledgment alone is insufficient.
6. **Resolve routine decisions.** The coordinator automatically records the `Recommended` or `Approve` result only for reversible, in-scope, plan-preserving coding choices. Destructive, irreversible, credential, secret, external-production, parent-mutation, merge, push, deploy, and material scope changes escalate unless exactly pre-authorized.
7. **Accept evidence, not prose.** Heartbeats, decision gates, one `worker_done`, full object IDs, hashes, exit codes, and non-empty artifacts form the handoff contract.
8. **Validate and preserve.** Run approved validation in the selected child, preserve its branch/commit, clean only verified run-owned children, then compare parent invariants byte-for-byte.

## GJC invocation safety

The default requested worker route is `openai-codex/gpt-5.6-sol` with `high` thinking. It must be present in `gjc --list-models` output from a trusted controller context. GJC 0.11.1 exposes `ultra`, `high`, `medium`, and `low` thinking values, and supports `--credential`, `--session-dir`, `--no-extensions`, `--no-skills`, `--no-session`, `--no-pty`, and `--tools`. Per-task model or effort overrides are permitted only when serialized in the manifest, verified before launch, and accompanied by a risk rationale. The default fallback list is empty; a missing exact selector blocks execution.

Every launch uses an explicit model and thinking level plus these restrictive controls:

```text
gjc --model openai-codex/gpt-5.6-sol --thinking high --session-dir /private/<run>/runtime/session --no-session --no-extensions --no-skills --no-rules --no-pty --tools read,search,find
```

The initial read-only allowlist is `read,search,find`. Because the `goal` tool can remain enabled despite that allowlist, the isolated run config also sets `goal.enabled=false`. An owned implementation task can add `edit,write`; `bash` requires a command-specific trust gate. `--no-extensions`, `--no-skills`, and `--no-rules` are required but complement, rather than replace, state isolation and repository trust gates. Do not pass `--api-key`, use persistent model presets/defaults, dump environment variables, or run GJC global/nested management commands.

## Sanitized run environment

Configuration, session, and authentication isolation are independent. Each worker receives a fresh run-scoped `GJC_CONFIG_DIR` and `--session-dir` outside the target repository and evidence tree; the directories contain only the reviewed minimal config needed to set `goal.enabled=false`. The coordinator removes shell-prefix/legacy aliases, applies a minimal allowlist, does not dump the raw environment, and sets `GJC_NO_PTY=1`, `GJC_BASH_NO_LOGIN=1`, `SHELL=/bin/sh`, `BASH_ENV=/dev/null`, `ENV=/dev/null`, `GIT_TERMINAL_PROMPT=0`, and `GIT_ASKPASS=/usr/bin/false`.

Authentication is broker-first: `--credential` may select an opaque non-secret broker handle, but that selector is never recorded. If the broker is unavailable, `trusted-controller-vault` is the only fallback: it reuses only the trusted controller credential store while config/session remain isolated, forbids inspection, copying, export, and serialization of credentials, and records only a redacted receipt. Do not replace the controller authentication vault with a fresh `GJC_CODING_AGENT_DIR`.

Before creating a child terminal, the coordinator runs a non-mutating authenticated model probe with the exact reviewed child environment and invocation shape. Its receipt records only timestamp, mode, success, and redacted artifact; failure blocks terminal creation and dispatch.

## Receipt contracts

- [`templates/run-manifest.template.json`](templates/run-manifest.template.json) is a valid representative run document. Production manifests use real IDs, paths, and hashes and validate against its schema.
- [`templates/worker-task.md`](templates/worker-task.md) specifies the immutable facts each worker receives before hashing and Orca injection.
- [`templates/completion-receipt.template.json`](templates/completion-receipt.template.json) is the required worker evidence shape, validated by [`schemas/completion-receipt.schema.json`](schemas/completion-receipt.schema.json).

A prompt-delivery record is valid only when it binds the literal prompt hash to `dispatch-show`, a pre-submit terminal read, zero Enter submissions when already active or exactly one when a pasted composer is visible, and a post-submit terminal read proving `active`. It must record `acceptedAt` and `waitStartedAfterAccepted=true`; any missing or unknown active-state proof blocks a long wait. A send/inject acknowledgment or heartbeat never suffices by itself.

The manifest approval policy names the only automatic results—`recommended` and `approve`—and decision receipts prove each result was reversible, in scope, and plan-preserving. Everything destructive, irreversible, credential- or secret-related, external-production, parent-mutating, merging, pushing, deploying, or materially scope-changing escalates unless the exact action is pre-authorized.

A `worker_done` event is valid only once, sent to the concrete coordinator with live Orca `taskId` and `dispatchId`, and backed by non-empty evidence paths. Its exact `status` vocabulary is `success`, `failure`, or `blocked`; Orca task lifecycle states such as `completed` and `failed` remain separate. A text-only completion or stale dispatch ID is not a completion.

## Safety boundaries

Never use this skill to:

- create or publish a GitHub repository, push a branch, tag a release, deploy, or publish an artifact;
- mutate the parent checkout, or write from a same-worktree worker;
- bypass a trust gate, hook boundary, model verification, secret boundary, or clean-up verification;
- let GJC create worktrees, tmux sessions, teams, daemons, plugins, nested harnesses, setup/update operations, or global defaults;
- reset, stash, clean, delete, or overwrite dirty/unknown worker state to make a run appear successful.

When a boundary fails, preserve the state and evidence, mark the run blocked or cleanup-blocked, and return control to the Orca coordinator.

## Source facts and licensing

This skill states GJC 0.11.1 CLI behavior observed from installed help: `--credential`, `--session-dir`, `--no-extensions`, `--no-skills`, `--no-rules`, `--no-session`, `--no-pty`, and `--tools` are supported controls; thinking values are `ultra`, `high`, `medium`, and `low`. The skill does not include GJC source code or credential content. Local binary, model, authentication-probe, and repository-trust verification remain mandatory.

This repository payload is independently licensed under the MIT License in [`LICENSE`](LICENSE).

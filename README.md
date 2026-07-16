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

Copy the `orca-gjc-harness/` directory into the host's installable skill location while preserving its internal layout. The primary entrypoint is [`SKILL.md`](SKILL.md). No package manager, executable installer, build hook, test hook, network call, or setup script is included.

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

## Operating model

1. **Gate activation.** Confirm Orca, a trustworthy GJC binary, exact model availability, target trust classification, and a private run-evidence root. Otherwise leave this skill and use a separate direct workflow.
2. **Freeze baseline.** Capture the parent worktree path, branch, full HEAD, and porcelain status. Parent mutation is outside this skill.
3. **Create one manifest.** Serialize the run against [`schemas/run-manifest.schema.json`](schemas/run-manifest.schema.json), with task, worktree, terminal, prompt, handoff, validation, and cleanup evidence owned by that manifest.
4. **Choose a primary mode.** Use `single` for one narrow change, `race` for competing candidates, `parallel-build` for disjoint ownership, and `pipeline` for hash-verified staged work. Integration is conditional only.
5. **Launch through Orca.** Orca creates the child worktree and terminal and injects a literal, hashed task spec. GJC is not permitted to create worktrees or coordination state.
6. **Accept evidence, not prose.** Heartbeats, decision gates, one `worker_done`, full object IDs, hashes, exit codes, and non-empty artifacts form the handoff contract.
7. **Validate and preserve.** Run approved validation in the selected child, preserve its branch/commit, clean only verified run-owned children, then compare parent invariants byte-for-byte.

## GJC invocation safety

The default requested worker route is `openai-codex/gpt-5.6-sol` with `xhigh` thinking. It must be present in `gjc --list-models` output from a trusted controller context. Per-task model or effort overrides are permitted only when serialized in the manifest, verified before launch, and accompanied by a risk rationale. The default fallback list is empty; a missing exact selector blocks execution.

Every launch uses an explicit model and thinking level plus these restrictive controls:

```text
gjc --model openai-codex/gpt-5.6-sol --thinking xhigh --no-session --no-lsp --no-rules --no-pty --tools read,search,find
```

The initial read-only allowlist is `read,search,find`. An owned implementation task can add `edit,write`; `bash` requires a command-specific trust gate. `--no-lsp` remains enabled until project configuration and resolved LSP binaries are trusted.

These controls have important limits:

- `--no-extensions` is ineffective as a containment measure because the analyzed GJC parser does not parse it. State isolation and absent project registries are the control.
- `--no-pty` sets `PI_NO_PTY=1`, but does not alone stop a bash shell snapshot from reading startup state. The run environment also neutralizes login/profile inputs.
- GJC project plugins, LSP configuration/binaries, MCP configuration, lifecycle scripts, Git hooks, and shell startup can execute or influence code. They require separate trust inventory and approval.
- Do not pass `--api-key`, use persistent model presets/defaults, dump environment variables, or run GJC global/nested management commands.

## Sanitized run environment

Each worker receives a fresh run-scoped `GJC_CODING_AGENT_DIR` and `GJC_CONFIG_DIR` outside the target repository and evidence tree. It runs with a minimal allowlist, no captured environment dump, `GJC_NO_PTY=1`, `GJC_BASH_NO_LOGIN=1`, `SHELL=/bin/sh`, `BASH_ENV=/dev/null`, `ENV=/dev/null`, `GIT_TERMINAL_PROMPT=0`, and `GIT_ASKPASS=/usr/bin/false`. The coordinator removes shell-prefix/legacy aliases and unrelated cloud, source-control, proxy, and provider credentials.

A selected provider may be authenticated only through a brokered handle that is neither written to disk nor included in arguments, prompts, receipts, diffs, terminal titles, or logs. If the host cannot preserve that boundary, do not launch GJC.

## Receipt contracts

- [`templates/run-manifest.template.json`](templates/run-manifest.template.json) is a valid representative run document. Production manifests use real IDs, paths, and hashes and validate against its schema.
- [`templates/worker-task.md`](templates/worker-task.md) specifies the immutable facts each worker receives before hashing and Orca injection.
- [`templates/completion-receipt.template.json`](templates/completion-receipt.template.json) is the required worker evidence shape, validated by [`schemas/completion-receipt.schema.json`](schemas/completion-receipt.schema.json).

A `worker_done` event is valid only once, sent to the concrete coordinator with live Orca `taskId` and `dispatchId`, and backed by non-empty evidence paths. A text-only completion or stale dispatch ID is not a completion.

## Safety boundaries

Never use this skill to:

- create or publish a GitHub repository, push a branch, tag a release, deploy, or publish an artifact;
- mutate the parent checkout, or write from a same-worktree worker;
- bypass a trust gate, hook boundary, model verification, secret boundary, or clean-up verification;
- let GJC create worktrees, tmux sessions, teams, daemons, plugins, nested harnesses, setup/update operations, or global defaults;
- reset, stash, clean, delete, or overwrite dirty/unknown worker state to make a run appear successful.

When a boundary fails, preserve the state and evidence, mark the run blocked or cleanup-blocked, and return control to the Orca coordinator.

## Source facts and licensing

This skill independently states GJC CLI behavior observed in an immutable static source-analysis contract for Gajae Code commit `7dc297145f333a00b7e913ce7c8cd5dedeb3fd34`. It does not include GJC source code or copied implementation text. The contract establishes that `--model`, `--thinking`, `--no-session`, `--no-lsp`, `--no-rules`, `--no-pty`, and `--tools` are active parser controls; it also records the `--no-extensions` limitation. Static analysis is not a security guarantee, so local binary/model verification remains mandatory.

This repository payload is independently licensed under the MIT License in [`LICENSE`](LICENSE).

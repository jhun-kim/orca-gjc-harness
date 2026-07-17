import fs from "node:fs";
import path from "node:path";

const manifestPaths = process.argv.slice(2);

if (manifestPaths.length === 0) {
  process.stderr.write("usage: node schemas/validate-run-manifest.mjs <manifest.json> [...]\n");
  process.exit(2);
}

const forbiddenSerializedArgument = /(?:^--(?:credential|api-key|mpreset|default)$|token|secret|private[-_ ]?key)/i;

function asTime(value) {
  if (typeof value !== "string") return Number.NaN;
  return Date.parse(value);
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function routeSelector(route) {
  if (!route || typeof route.provider !== "string" || typeof route.model !== "string") return null;
  return `${route.provider}/${route.model}`;
}

function flagValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) values.push(argv[index + 1]);
  }
  return values;
}

function validateManifest(manifest) {
  const errors = [];
  const add = (location, message) => errors.push({ location, message });
  const runtime = manifest?.runtimePolicy;
  const routing = runtime?.routing;
  const authentication = runtime?.authentication;
  const probe = authentication?.probe;
  const tasks = Array.isArray(manifest?.tasks) ? manifest.tasks : [];

  if (!runtime || !routing || !authentication || !probe) {
    add("runtimePolicy", "runtime routing, authentication, and probe records are required before semantic validation");
    return errors;
  }

  const argv = Array.isArray(probe.sanitizedArgv) ? probe.sanitizedArgv : [];
  for (const [index, argument] of argv.entries()) {
    if (forbiddenSerializedArgument.test(String(argument))) {
      add(`runtimePolicy.authentication.probe.sanitizedArgv[${index}]`, "credential, broker-selector, token, secret, and private-key arguments must not be serialized");
    }
  }

  const resolvedSelector = routeSelector(routing.resolved);
  const modelValues = flagValues(argv, "--model");
  const thinkingValues = flagValues(argv, "--thinking");
  const sessionValues = flagValues(argv, "--session-dir");
  const toolsValues = flagValues(argv, "--tools");

  if (modelValues.length !== 1 || modelValues[0] !== resolvedSelector) {
    add("runtimePolicy.authentication.probe.sanitizedArgv", `exactly one --model value must equal resolved selector ${JSON.stringify(resolvedSelector)}`);
  }
  if (thinkingValues.length !== 1 || thinkingValues[0] !== routing.resolved?.thinking) {
    add("runtimePolicy.authentication.probe.sanitizedArgv", "exactly one --thinking value must equal resolved thinking");
  }
  if (sessionValues.length !== 1 || sessionValues[0] !== runtime.isolation?.sessionDirectory) {
    add("runtimePolicy.authentication.probe.sanitizedArgv", "exactly one --session-dir value must equal the isolated session directory");
  }
  if (toolsValues.length !== 1 || toolsValues[0] !== (Array.isArray(runtime.tools) ? runtime.tools.join(",") : null)) {
    add("runtimePolicy.authentication.probe.sanitizedArgv", "exactly one --tools value must equal the serialized tool allowlist");
  }
  for (const requiredFlag of ["--no-session", "--no-extensions", "--no-skills", "--no-rules", "--no-pty"]) {
    if (argv.filter((argument) => argument === requiredFlag).length !== 1) {
      add("runtimePolicy.authentication.probe.sanitizedArgv", `exactly one ${requiredFlag} flag is required`);
    }
  }

  if (authentication.status === "authenticated" && probe.authenticated !== true) {
    add("runtimePolicy.authentication", "authenticated status requires an authenticated exact-environment probe");
  }
  if (authentication.status === "blocked") {
    if (probe.authenticated !== false) add("runtimePolicy.authentication", "blocked status requires authenticated=false in the preserved probe receipt");
    if (tasks.length !== 0) add("tasks", "blocked authentication forbids task launch, terminal creation, and dispatch");
    if (manifest.status !== "blocked") add("status", "blocked authentication requires manifest status blocked");
  }
  if (probe.exactChildEnvironment !== true || probe.exactLaunchEnvelope !== true) {
    add("runtimePolicy.authentication.probe", "the authentication probe must use the exact reviewed child environment and launch envelope");
  }

  const requested = routing.requested;
  const resolved = routing.resolved;
  const attempts = Array.isArray(routing.fallbackAttempts) ? routing.fallbackAttempts : [];
  const selection = routing.selection;
  const selectedAttempts = attempts.filter((attempt) => attempt?.outcome === "selected");

  attempts.forEach((attempt, index) => {
    if (attempt?.ordinal !== index + 1) add(`runtimePolicy.routing.fallbackAttempts[${index}].ordinal`, "fallback ordinals must be contiguous and one-based");
    if (attempt?.outcome === "rejected" && (typeof attempt.rejectionReason !== "string" || attempt.rejectionReason.length === 0)) {
      add(`runtimePolicy.routing.fallbackAttempts[${index}].rejectionReason`, "every rejected fallback requires a non-empty rejection reason");
    }
  });

  if (selection?.source === "requested") {
    if (selection.fallbackOrdinal !== null) add("runtimePolicy.routing.selection.fallbackOrdinal", "requested selection cannot name a fallback ordinal");
    if (requested?.provider !== resolved?.provider || requested?.model !== resolved?.model) {
      add("runtimePolicy.routing.resolved", "provider/model may differ from requested only through a selected fallback");
    }
    if (selectedAttempts.length !== 0) add("runtimePolicy.routing.fallbackAttempts", "requested selection cannot contain a selected fallback");
  } else if (selection?.source === "fallback") {
    if (selectedAttempts.length !== 1) add("runtimePolicy.routing.fallbackAttempts", "fallback selection requires exactly one selected fallback");
    const selected = selectedAttempts[0];
    if (selected && selected.ordinal !== selection.fallbackOrdinal) {
      add("runtimePolicy.routing.selection.fallbackOrdinal", "selection must identify the selected fallback ordinal");
    }
    if (selected && !equalJson(selected.route, resolved)) {
      add("runtimePolicy.routing.resolved", "resolved route must exactly equal the selected fallback route");
    }
    if (selected && attempts.some((attempt) => attempt.ordinal < selected.ordinal && attempt.outcome !== "rejected")) {
      add("runtimePolicy.routing.fallbackAttempts", "every attempt before the selected fallback must be rejected with evidence");
    }
    if (selected && attempts.some((attempt) => attempt.ordinal > selected.ordinal)) {
      add("runtimePolicy.routing.fallbackAttempts", "no fallback attempt may follow the selected route");
    }
  }

  const changedClampFields = ["thinking", "contextLimit"].filter((field) => requested?.[field] !== resolved?.[field]);
  const adjustments = Array.isArray(routing.clamping?.adjustments) ? routing.clamping.adjustments : [];
  if (routing.clamping?.applied !== (changedClampFields.length > 0)) {
    add("runtimePolicy.routing.clamping.applied", "clamping.applied must exactly reflect thinking/context-limit changes");
  }
  if (adjustments.length !== changedClampFields.length) {
    add("runtimePolicy.routing.clamping.adjustments", "clamping adjustments must cover every and only changed thinking/context-limit field");
  }
  for (const field of changedClampFields) {
    const matching = adjustments.filter((adjustment) => adjustment?.field === field);
    if (matching.length !== 1 || matching[0].requestedValue !== requested[field] || matching[0].resolvedValue !== resolved[field]) {
      add("runtimePolicy.routing.clamping.adjustments", `clamping adjustment for ${field} must bind the exact requested and resolved values`);
    }
  }

  const selectionTime = asTime(selection?.resolvedAt);
  const probeTime = asTime(probe.executedAt);
  if (Number.isFinite(selectionTime) && Number.isFinite(probeTime) && probeTime < selectionTime) {
    add("runtimePolicy.authentication.probe.executedAt", "authentication probe cannot precede runtime resolution");
  }

  const taskIds = new Set();
  const worktreeIds = new Set();
  const dispatchIds = new Set();
  const terminalHandles = new Set();
  const terminalIdentities = new Set();

  for (const [taskIndex, task] of tasks.entries()) {
    const base = `tasks[${taskIndex}]`;
    if (taskIds.has(task.taskId)) add(`${base}.taskId`, "task IDs must be manifest-unique");
    taskIds.add(task.taskId);
    if (worktreeIds.has(task.worktree?.id)) add(`${base}.worktree.id`, "worktree IDs must be manifest-unique");
    worktreeIds.add(task.worktree?.id);
  }

  const requiredTasks = tasks.filter((task) => task.required === true);

  for (const [taskIndex, task] of tasks.entries()) {
    const base = `tasks[${taskIndex}]`;
    const lifecycle = task.lifecycle ?? {};
    const dispatch = lifecycle.dispatch;
    const prompt = lifecycle.promptDelivery;
    const monitoring = lifecycle.monitoring;
    const decision = lifecycle.decision;
    const completion = lifecycle.completion;
    const cleanup = lifecycle.cleanup;

    for (const dependency of Array.isArray(task.dependsOn) ? task.dependsOn : []) {
      if (dependency === task.taskId) add(`${base}.dependsOn`, "a task cannot depend on itself");
      if (!taskIds.has(dependency)) add(`${base}.dependsOn`, `unknown dependency ${JSON.stringify(dependency)}`);
    }

    if (task.worktree?.setupMode !== runtime.setupMode) {
      add(`${base}.worktree.setupMode`, "task worktree setup mode must equal the reviewed runtime policy");
    }

    if (!dispatch) {
      if (prompt !== null) add(`${base}.lifecycle.promptDelivery`, "prompt delivery requires the task's singular dispatch");
      if (monitoring !== null) add(`${base}.lifecycle.monitoring`, "monitoring requires the task's singular dispatch");
      if (decision !== null) add(`${base}.lifecycle.decision`, "a decision receipt requires the task's singular dispatch");
      if (completion !== null) add(`${base}.lifecycle.completion`, "completion requires the task's singular dispatch");
    } else {
      if (authentication.status !== "authenticated") add(`${base}.lifecycle.dispatch`, "a dispatch is forbidden unless authentication succeeded");
      if (dispatchIds.has(dispatch.dispatchId)) add(`${base}.lifecycle.dispatch.dispatchId`, "dispatch IDs must be manifest-unique");
      dispatchIds.add(dispatch.dispatchId);
      if (terminalHandles.has(dispatch.terminal?.handle)) add(`${base}.lifecycle.dispatch.terminal.handle`, "terminal handles must be manifest-unique; stale-handle ambiguity fails closed");
      terminalHandles.add(dispatch.terminal?.handle);
      if (terminalIdentities.has(dispatch.terminal?.stableIdentity)) add(`${base}.lifecycle.dispatch.terminal.stableIdentity`, "stable terminal identities must be manifest-unique");
      terminalIdentities.add(dispatch.terminal?.stableIdentity);

      const launchedAt = asTime(dispatch.terminal?.launchedAt);
      const dispatchAt = asTime(dispatch.createdAt);
      if (Number.isFinite(launchedAt) && Number.isFinite(dispatchAt) && launchedAt > dispatchAt) {
        add(`${base}.lifecycle.dispatch.terminal.launchedAt`, "terminal launch must not follow dispatch creation");
      }
      const launchArtifact = dispatch.terminal?.launchEnvelopeArtifact;
      if (launchArtifact?.path !== probe.artifact?.path || launchArtifact?.sha256 !== probe.artifact?.sha256 || launchArtifact?.bytes !== probe.artifact?.bytes) {
        add(`${base}.lifecycle.dispatch.terminal.launchEnvelopeArtifact`, "terminal launch must bind the exact authenticated child-envelope probe artifact");
      }
    }

    if (prompt && prompt !== null) {
      const identity = prompt.identity ?? {};
      if (identity.taskId !== task.taskId) add(`${base}.lifecycle.promptDelivery.identity.taskId`, "prompt receipt task ID must match its enclosing task");
      if (identity.dispatchId !== dispatch?.dispatchId) add(`${base}.lifecycle.promptDelivery.identity.dispatchId`, "prompt receipt dispatch ID must match the singular dispatch");
      if (identity.terminalHandle !== dispatch?.terminal?.handle) add(`${base}.lifecycle.promptDelivery.identity.terminalHandle`, "prompt receipt must bind the exact dispatch terminal handle");
      if (identity.stableTerminalIdentity !== dispatch?.terminal?.stableIdentity) add(`${base}.lifecycle.promptDelivery.identity.stableTerminalIdentity`, "prompt receipt must bind the exact stable terminal identity");
      if (prompt.promptSha256 !== task.promptSpec?.sha256) add(`${base}.lifecycle.promptDelivery.promptSha256`, "prompt receipt hash must match the immutable task prompt");
      if (prompt.resendCount !== 0 || prompt.attemptNumber !== 1) add(`${base}.lifecycle.promptDelivery`, "prompt delivery permits one attempt and no resend");

      const dispatchAt = asTime(dispatch?.createdAt);
      const startedAt = asTime(prompt.startedAt);
      const deadlineAt = asTime(prompt.deadlineAt);
      if (Number.isFinite(dispatchAt) && Number.isFinite(startedAt) && startedAt < dispatchAt) {
        add(`${base}.lifecycle.promptDelivery.startedAt`, "prompt delivery cannot start before dispatch creation");
      }
      if (Number.isFinite(startedAt) && Number.isFinite(deadlineAt) && deadlineAt - startedAt !== 60_000) {
        add(`${base}.lifecycle.promptDelivery.deadlineAt`, "prompt acceptance deadline must be exactly 60 seconds after delivery starts");
      }

      const phases = Array.isArray(prompt.phases) ? prompt.phases : [];
      let previousPhaseTime = Number.NEGATIVE_INFINITY;
      let previousReadCursor = Number.NEGATIVE_INFINITY;
      phases.forEach((phase, phaseIndex) => {
        if (phase.sequence !== phaseIndex + 1) add(`${base}.lifecycle.promptDelivery.phases[${phaseIndex}].sequence`, "prompt phases must be contiguous and ordered");
        const phaseTime = asTime(phase.capturedAt ?? phase.submittedAt);
        if (Number.isFinite(phaseTime) && phaseTime <= previousPhaseTime) {
          add(`${base}.lifecycle.promptDelivery.phases[${phaseIndex}]`, "each prompt phase timestamp must be strictly later than the prior phase");
        }
        if (Number.isFinite(phaseTime)) previousPhaseTime = phaseTime;
        if (typeof phase.cursor === "number") {
          if (phase.cursor <= previousReadCursor) add(`${base}.lifecycle.promptDelivery.phases[${phaseIndex}].cursor`, "post-submit read cursor must be strictly later than the pre-submit cursor");
          previousReadCursor = phase.cursor;
        }
      });

      if (prompt.outcome === "accepted") {
        const acceptedAt = asTime(prompt.acceptedAt);
        if (Number.isFinite(acceptedAt) && acceptedAt < previousPhaseTime) add(`${base}.lifecycle.promptDelivery.acceptedAt`, "acceptance must follow the post-submit active-state evidence");
        if (Number.isFinite(acceptedAt) && Number.isFinite(dispatchAt) && acceptedAt < dispatchAt) add(`${base}.lifecycle.promptDelivery.acceptedAt`, "acceptance cannot precede dispatch creation");
        if (Number.isFinite(acceptedAt) && Number.isFinite(deadlineAt) && acceptedAt > deadlineAt) add(`${base}.lifecycle.promptDelivery.acceptedAt`, "acceptance after the 60-second deadline must fail closed");
        const finalPhase = phases.at(-1);
        if (finalPhase?.phase !== "post-submit-read" || finalPhase?.terminalState !== "active") add(`${base}.lifecycle.promptDelivery.phases`, "accepted prompt requires a final post-submit read proving active state");
        if (prompt.longWaitAllowed !== true) add(`${base}.lifecycle.promptDelivery.longWaitAllowed`, "long waits become eligible only after accepted active evidence");
      } else if (prompt.outcome === "blocked") {
        const blockedAt = asTime(prompt.blockedAt);
        if (prompt.blockedReason === "active-evidence-timeout" && Number.isFinite(blockedAt) && Number.isFinite(deadlineAt) && blockedAt < deadlineAt) {
          add(`${base}.lifecycle.promptDelivery.blockedAt`, "active-evidence timeout cannot be recorded before the 60-second deadline");
        }
        if (phases.some((phase) => phase.terminalState === "active")) add(`${base}.lifecycle.promptDelivery.phases`, "blocked prompt receipt cannot contain accepted active-state evidence");
        if (prompt.acceptedAt !== null || prompt.longWaitAllowed !== false) add(`${base}.lifecycle.promptDelivery`, "blocked prompt receipt forbids acceptance and long orchestration waits");
      }
    }

    if (monitoring && monitoring !== null) {
      if (prompt?.outcome !== "accepted") add(`${base}.lifecycle.monitoring`, "worker monitoring may start only after accepted prompt evidence");
      const acceptedAt = asTime(prompt?.acceptedAt);
      const monitoringStartedAt = asTime(monitoring.startedAt);
      if (Number.isFinite(acceptedAt) && Number.isFinite(monitoringStartedAt) && monitoringStartedAt < acceptedAt) {
        add(`${base}.lifecycle.monitoring.startedAt`, "monitoring cannot begin before prompt acceptance");
      }

      const polls = Array.isArray(monitoring.polls) ? monitoring.polls : [];
      let previousPollEnd = monitoringStartedAt;
      const activeTimes = [];
      polls.forEach((poll, pollIndex) => {
        const pollBase = `${base}.lifecycle.monitoring.polls[${pollIndex}]`;
        if (poll.sequence !== pollIndex + 1) add(`${pollBase}.sequence`, "poll sequences must be contiguous and one-based");
        const pollStart = asTime(poll.startedAt);
        const pollEnd = asTime(poll.endedAt);
        if (Number.isFinite(pollStart) && Number.isFinite(pollEnd) && (pollEnd < pollStart || pollEnd - pollStart > 60_000)) {
          add(pollBase, "each active-worker poll must be a bounded window no longer than 60 seconds");
        }
        if (Number.isFinite(previousPollEnd) && Number.isFinite(pollStart) && pollStart < previousPollEnd) add(`${pollBase}.startedAt`, "poll windows must not overlap or reverse");
        if (Number.isFinite(previousPollEnd) && Number.isFinite(pollStart) && pollStart - previousPollEnd > 120_000) add(`${pollBase}.startedAt`, "a required liveness observation gap cannot exceed 120 seconds");
        if (Number.isFinite(pollEnd)) previousPollEnd = pollEnd;
        const activeAt = asTime(poll.activeEvidenceAt);
        if (poll.result === "active") {
          if (!Number.isFinite(activeAt) || activeAt < pollStart || activeAt > pollEnd) add(`${pollBase}.activeEvidenceAt`, "active poll requires evidence captured inside its bounded window");
          if (Number.isFinite(activeAt)) activeTimes.push(activeAt);
        } else if (poll.activeEvidenceAt !== null) {
          add(`${pollBase}.activeEvidenceAt`, "non-active poll result must use null activeEvidenceAt");
        }
      });

      for (let index = 1; index < activeTimes.length; index += 1) {
        if (activeTimes[index] - activeTimes[index - 1] > 120_000) add(`${base}.lifecycle.monitoring.polls`, "active evidence must remain inside the 120-second liveness window");
      }
      const expectedLastActiveAt = activeTimes.length > 0 ? activeTimes.at(-1) : null;
      const recordedLastActiveAt = monitoring.lastActiveAt === null ? null : asTime(monitoring.lastActiveAt);
      if (recordedLastActiveAt !== expectedLastActiveAt) add(`${base}.lifecycle.monitoring.lastActiveAt`, "lastActiveAt must equal the latest active poll evidence timestamp");
      if (task.required === true && monitoring.optionalGrace !== null) add(`${base}.lifecycle.monitoring.optionalGrace`, "required work never receives optional grace");
      if (task.required === true && monitoring.outcome === "active" && monitoring.abandoned !== false) add(`${base}.lifecycle.monitoring.abandoned`, "required work cannot be abandoned while active");

      const grace = monitoring.optionalGrace;
      if (grace && grace !== null) {
        if (task.required !== false) add(`${base}.lifecycle.monitoring.optionalGrace`, "only optional work may receive grace");
        const verifiedAt = asTime(grace.requiredDeliverablesVerifiedAt);
        const graceStart = asTime(grace.startedAt);
        const graceEnd = asTime(grace.endedAt);
        if (Number.isFinite(verifiedAt) && Number.isFinite(graceStart) && graceStart < verifiedAt) add(`${base}.lifecycle.monitoring.optionalGrace.startedAt`, "optional grace begins only after required deliverables are verified");
        if (Number.isFinite(graceStart) && Number.isFinite(graceEnd) && (graceEnd < graceStart || graceEnd - graceStart > grace.configuredSeconds * 1000 || grace.configuredSeconds > 120)) {
          add(`${base}.lifecycle.monitoring.optionalGrace`, "optional grace must not exceed its recorded duration or the 120-second maximum");
        }
        for (const requiredTask of requiredTasks) {
          const requiredCompletion = requiredTask.lifecycle?.completion;
          if (requiredTask.status !== "completed" || requiredCompletion?.status !== "success" || asTime(requiredCompletion?.receivedAt) > verifiedAt) {
            add(`${base}.lifecycle.monitoring.optionalGrace.requiredDeliverablesVerifiedAt`, "every required task must have a successful completion receipt before optional grace starts");
            break;
          }
        }
      }
    }

    if (["pending", "ready"].includes(task.status) && [dispatch, prompt, monitoring, decision, completion, cleanup].some((receipt) => receipt !== null)) {
      add(`${base}.lifecycle`, `${task.status} task cannot contain launched lifecycle receipts`);
    }
    if (task.status === "active") {
      if (dispatch?.status !== "active" || prompt?.outcome !== "accepted" || monitoring?.outcome !== "active" || completion !== null) {
        add(`${base}.lifecycle`, "active task requires one active dispatch, accepted prompt, active monitoring record, and no completion");
      }
    }
    if (task.status === "completed") {
      if (dispatch?.status !== "completed" || prompt?.outcome !== "accepted" || monitoring?.outcome !== "completed" || completion?.status !== "success") {
        add(`${base}.lifecycle`, "completed task requires one completed dispatch, accepted prompt, completed monitoring record, and successful worker_done receipt");
      }
    }
    if (task.status === "failed" && completion?.status !== "failure") {
      add(`${base}.lifecycle.completion`, "failed task requires one failure worker_done receipt");
    }
    if (task.status === "blocked" && prompt?.outcome === "accepted" && completion?.status !== "blocked") {
      add(`${base}.lifecycle.completion`, "an accepted worker that becomes blocked requires one blocked worker_done receipt");
    }
    if (task.status === "cleanup-blocked" && cleanup?.decision !== "cleanup-blocked") {
      add(`${base}.lifecycle.cleanup`, "cleanup-blocked task requires one cleanup-blocked preservation receipt");
    }

    for (const [receiptName, receipt] of [["decision", decision], ["completion", completion]]) {
      if (receipt && receipt !== null) {
        if (receipt.identity?.taskId !== task.taskId) add(`${base}.lifecycle.${receiptName}.identity.taskId`, `${receiptName} task ID must match the enclosing task`);
        if (receipt.identity?.dispatchId !== dispatch?.dispatchId) add(`${base}.lifecycle.${receiptName}.identity.dispatchId`, `${receiptName} dispatch ID must match the singular live dispatch`);
      }
    }

    if (decision && decision !== null) {
      const decisionAt = asTime(decision.recordedAt);
      const dispatchAt = asTime(dispatch?.createdAt);
      if (Number.isFinite(decisionAt) && Number.isFinite(dispatchAt) && decisionAt < dispatchAt) add(`${base}.lifecycle.decision.recordedAt`, "decision receipt cannot precede dispatch creation");
    }

    if (completion && completion !== null) {
      const receivedAt = asTime(completion.receivedAt);
      const finalPollEnd = asTime(monitoring?.polls?.at(-1)?.endedAt);
      if (Number.isFinite(receivedAt) && Number.isFinite(finalPollEnd) && receivedAt < finalPollEnd) add(`${base}.lifecycle.completion.receivedAt`, "worker_done receipt cannot precede the final monitoring observation");
    }

    if (cleanup && cleanup !== null) {
      if (cleanup.worktreeId !== task.worktree?.id) add(`${base}.lifecycle.cleanup.worktreeId`, "cleanup receipt must bind the task's exact worktree ID");
      if (cleanup.decision === "removed" && (!Array.isArray(cleanup.status) || cleanup.status.length !== 0 || !["clean", "zero-delta"].includes(cleanup.checkoutState))) {
        add(`${base}.lifecycle.cleanup`, "removal requires clean or zero-delta state and empty porcelain status");
      }
      if (["dirty", "unknown", "deleted-worktree"].includes(cleanup.checkoutState) && cleanup.decision === "removed") {
        add(`${base}.lifecycle.cleanup.decision`, "dirty, unknown, and deleted-worktree states must be preserved or cleanup-blocked, never removed");
      }
    }
  }

  for (const [validationIndex, validation] of (Array.isArray(manifest.validations) ? manifest.validations : []).entries()) {
    const startedAt = asTime(validation.startedAt);
    const endedAt = asTime(validation.endedAt);
    if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt < startedAt) {
      add(`validations[${validationIndex}].endedAt`, "validation end must not precede start");
    }
  }

  return errors;
}

let allValid = true;
for (const manifestPath of manifestPaths) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    allValid = false;
    process.stdout.write(`${JSON.stringify({ path: path.resolve(manifestPath), valid: false, errors: [{ location: "$", message: String(error.message ?? error) }] })}\n`);
    continue;
  }
  const errors = validateManifest(manifest);
  const result = { path: path.resolve(manifestPath), valid: errors.length === 0, errors };
  if (!result.valid) allValid = false;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

process.exit(allValid ? 0 : 1);

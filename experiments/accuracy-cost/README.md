# Accuracy and resource-use evaluation

This is an exploratory, paired **real Codex CLI** evaluation of two Mio tool
interfaces. It is optional, uses the operator's existing CLI login, consumes
account usage, and is not run by CI. No API key is created, exported or stored by
the runner. All profile values are fictional.

## Question and controls

Does the compact interface preserve exact task correctness while using fewer
tool calls or tokens than the legacy interface on the same tasks?

- Legacy: `mio_list_fields`, all-or-nothing `mio_read`, `mio_propose_update`.
- Compact: `mio_context` (batch values plus uniform unavailable names, or key
  discovery when fields are omitted) and `mio_propose_update`.
- Both use the same current host, grants, timestamp checks, database records,
  server-level instructions, model, reasoning setting, output schema and prompt.
  This compares the interface bundle, not the full historical 0.2.0 source tree.
- Each session starts a new in-memory database and isolated ephemeral Codex run.
  Shell, web, apps, plugins, memories and subagents are disabled. The expected
  answers never enter the model's working directory or prompt.
- Tool schemas and tool-specific descriptions differ intentionally. This study
  cannot separate their effects from batching and partial-result semantics.

Ten task templates cover a single field, multiple fields, ungranted and missing
fields, expired claims, new shared and unshared versions, pending proposals,
conflicting timestamps, and a revoked grant. Each has two fictional profiles,
giving 20 paired tasks / 40 sessions. The second profile reverses the arm order
within each template. A fixed seed shuffles template order. Two worker processes
run the schedule; concurrency and provider caching limit latency interpretation.

The prompts deliberately supply canonical field keys. The study therefore does
not evaluate schema discovery from natural language. The two profiles are not
two independent user populations. Fixtures were written during development, not
collected from held-out real users.

## Scoring and usage

The independent expected answer specifies each requested field's exact string or
`null`. A task passes only with the complete schema and ordering, no duplicates,
the right values, actual tool evidence for both values and unavailable fields,
at least one MCP call, no unexpected value for a field that should be
unavailable, and no write proposal. Readable-field and unavailable-field scores
are also reported separately. Returning all nulls cannot pass a readable task.

`metrics.mjs` records unexpected tool values, unnecessary extra fields, unsupported
final values, actual tool-call counts, failures, elapsed time, and CLI usage.
Raw usage is retained. Input minus cached input is a derived counter; output is
reported separately, without adding its reasoning subset again. Unknown usage
is not treated as zero. Every attempt remains in the report; no automatic retry
or success-only filtering is performed. Per-success resources include the costs
of unsuccessful attempts in their numerator.

The optional sensitivity grid uses hypothetical weights for cached input and
output tokens. It is only computed when cache-write counters are explicitly zero.
It is **not** model pricing or the user's Codex subscription bill. These CLI
measurements cannot establish a dollar saving or how account quotas are charged.

## Reproduce

Requirements: Node.js 24, `npm ci --ignore-scripts`, a logged-in Codex CLI, and a
model available to that account. This should be run locally, not with a copied
account credential in public CI. The runner follows the official
[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
options for JSON events, isolated configuration and structured final output.

Create a new output directory through the runner and inspect the plan first:

```sh
node experiments/accuracy-cost/run.mjs --model MODEL --out /absolute/new-study --plan-only
node experiments/accuracy-cost/run.mjs --run-plan /absolute/new-study/plan.json
```

The first command makes no model requests. It records all tasks, expected
answers, execution order, model/CLI versions and source hashes before inference.
The second refuses changed sources, versions, limits or an existing attempt log.
Each attempt has a 120-second deadline and a forced process-group stop after a
three-second grace period. Interruption stops new tasks and records partial
completion. Diagnostic stdout/stderr stays in a private temporary directory;
selected fictional tool traces are in the result file.

Before sharing results, inspect both the plan and selected traces. The repository
publishes its own fictional run under `experiments/results/accuracy-cost-v1/`.
Read the [Chinese report](../../docs/research/accuracy-cost-optimization.zh-CN.md)
for observed outcomes and limitations. Passing this study cannot establish
external factual truth, broad model accuracy, secure OS isolation or production
reliability.

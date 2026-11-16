# Shared-profile trial records

This directory holds the blank [feedback template](shared-profile-feedback.example.json)
and a [maintainer integration record](shared-profile-live-validation-2026-11-16.json).
The planned first cohort is three external developers; no participants or
completed external runs are recorded here.

The November 16, 2026 maintainer record verifies Codex A's lifecycle through
actual MCP tool traces. Claude Code B was blocked by existing client
authentication before making a tool call. Supplemental B observations used the
official SDK. This is partial integration evidence, not a completed two-model
trial or external adoption result.

Follow [the trial protocol](../SHARED_PROFILE_TRIAL.md). Save completed forms
outside the Git checkout. Do not commit raw logs, database files, local paths,
operator URLs/tokens, credentials, identities, or contact details. A maintainer
may publish an aggregate report or redacted record only with the participant's
permission and after checking its contents.

## Filling the template

- Keep `schemaVersion` unchanged; set `exampleOnly` to `false` for a real record.
- Use a non-identifying participant code such as `P01`, the tested commit SHA,
  and ISO-8601 timestamps with an explicit timezone. Do not include a name or
  email address.
- `evidenceMode` must be `simulation`, `sdk`, or `real-client`. Use a separate
  record for each mode rather than combining them into a stronger claim.
- `environment.clients` is an array of `{ "name": "...", "version": "..." }`
  objects. For simulation, it may remain empty. Do not add account identifiers.
- Counts are nonnegative integers; durations are nonnegative seconds. Leave a
  value `null` if it was not measured. A blank is not a successful zero.
- `onboarding.errors` contains objects with `category`, `step`, and a brief
  sanitized `observation`. Use categories `client-authentication`, `mio-startup`,
  `mcp-connection`, `behavior`, `comprehension`, or `other`. Keep a client login
  failure separate from a Mio behavior failure, especially when no MCP call
  occurred. `redactedObservations` contains brief sanitized descriptions.
  Preserve failed or abandoned attempts and include the step.
- `scenario.completedSteps` contains step numbers from 1 to 7.
  `failedSteps` contains `{ "step": 1, "observation": "..." }` objects.
- `feedback.usefulness1To5` is an integer from 1 to 5, or `null`.
  `willingToReuse` is a boolean, or `null`; record why in `intendedUse` or
  `suggestedImprovement`.
- Keep `permissionToPublishRedactedFeedback` false unless the participant has
  explicitly agreed to publication of that redacted record. This field records
  consent; it is not an authentication mechanism.

The template collects human observations only. Neither it nor the local operator
page uploads data, recruits testers, or measures usage automatically. Aggregate
results should distinguish first-time external users from project maintainers
and automated tests, and show measured denominators alongside error counts.

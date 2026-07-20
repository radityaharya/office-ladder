# Admin, Support, And Moderation

Status: Proposed
Owner: Engineering operations and trust/safety
Updated: 2026-07-18

## Principle

Admin operations use the same authoritative command/event pipeline as players. Staff must not edit game rows or JSON directly.

## Admin Surface

Suggested routes:

```text
/admin/games
/admin/games/[matchId]
/admin/games/[matchId]/replay
/admin/games/[matchId]/repair
/admin/content
/admin/moderation
/admin/users/[userId]
/admin/flags
/admin/incidents
/admin/audit
/admin/support-bundles
/admin/operations
```

Route loaders perform initial authorized reads. Mutations pass centralized permission, fresh-session, reason, idempotency, transaction, and audit checks.

## Game Inspector

Search by match, room, user, status, version, incident, flag cohort, correlation ID, and date.

Show:

- Match status/timestamps.
- Sequence/snapshot revision/hash.
- Current turn, phase, actor, deadline.
- Rules/content/engine/build versions.
- Room settings and flags.
- Public player state and connection status.
- Deck counts and pending prompts.
- Last command/error.
- Invariant and incident status.

Hidden information is masked by default. Revealing it requires `game.secret.read`, a reason, and an audit record.

## Timeline And Replay

Timeline shows sequence, type, actor, phase, public summary, state delta, command/correlation IDs, and versions.

Replay modes:

- Public.
- Player perspective.
- Omniscient staff, elevated/audited.
- Diagnostic with hashes and engine details.

Capabilities:

- Step/jump/playback speed.
- Jump to turns/promotions/cards/disconnects/errors/repairs.
- Before/after diff.
- Verify snapshot reconstruction.
- Export sanitized regression fixture.

## Match Repair

Never delete events or expose a generic state editor.

Initial typed repairs:

- Pause/resume.
- Expire current decision with canonical default.
- Process missed timeout.
- Release expired processing lease.
- Rebuild snapshot from events.
- Recompute deadline.
- Remove disconnected pre-start player.
- Quarantine.
- Terminate no-contest.

Workflow:

1. Create/select incident.
2. Pause/quarantine and acquire repair lease.
3. Select typed command and reason/ticket.
4. Dry-run cloned state.
5. Show diff and invariants.
6. Confirm; high-risk actions require second approval.
7. Commit command/event/audit/snapshot atomically.
8. Verify client recovery.

Repairs are visible in replay and include before/after hashes.

## Stuck Detection

Signals:

- Deadline overdue beyond grace.
- No legal action in active phase.
- Snapshot/event revision mismatch.
- Expired processing lease.
- Unresolved command.
- Missing current player.
- Prompt without eligible responder.
- Repeated command failures.
- Engine invariant failure.
- Realtime publication repeatedly failing.

Safe automation can retry timeout, republish revision, clear expired lease, or rebuild derived snapshot. Repeated failure quarantines instead of looping.

## Content Operations

Workflow:

```text
draft -> validate -> preview -> approve -> publish -> active -> deprecated
```

Publishing creates an immutable release. Rollback changes future-match pointer, not active/historical matches.

Preview cards, board, characters, modes, localization, private/public states, and deterministic sandbox.

## Moderation

Initial scope:

- Offensive display names.
- Harassment reports tied to match.
- Griefing/repeated disconnects.
- Exploit abuse.
- Account suspension and session revocation.
- Room creation/join restrictions.

Separate moderation permission/data from game repair.

Suggested records:

- Reports.
- Cases.
- Evidence.
- Actions.
- Appeals.
- Current safety restrictions.

## Staff RBAC

Roles:

- `support_viewer`
- `moderator`
- `game_operator`
- `game_engineer`
- `content_editor`
- `content_publisher`
- `feature_manager`
- `security_auditor`
- `super_admin`

Permissions are explicit and server-enforced. Assignments include environment, start/expiry, grantor, reason, and revocation.

Fresh auth required for secret reveal, bans, repairs, content publication, production flags, staff roles, and exports.

## Audit Trail

Append-only audit records include actor/session/roles/permission, action, environment, target, request/correlation IDs, reason, ticket, redacted before/after, result, IP/user agent, approval, and optional hash chain.

Audit successful, denied, and failed privileged operations, including downloads and secret reveals.

## Feature Flags

Typed flags for UI, lobby, gameplay, content, and operational kill switches.

Gameplay flags are evaluated once and pinned to the match. High-risk changes require preview, reason, expiry, audit, and optional second approval.

## Support Bundles

Generated server-side with expiring private download:

- Manifest/version.
- Match/room/user opaque references.
- Sanitized metadata and event range.
- Rules/content/engine/build/flags.
- Redacted snapshot.
- Errors/incidents/repairs.
- Realtime metadata.
- Browser diagnostics.
- Invariant output/checksums.

Exclude credentials, cookies, secrets, hidden roles/hands by default, and unrelated personal data.

## Production Guardrails

- Permanent environment banner.
- Production mutations unavailable from preview.
- No admin SQL console.
- Separate runtime/migration DB roles.
- Typed confirmations and reasons.
- Dry-run/second approval for high risk.
- Kill switches for room creation, joins, starts, commands, timers, Realtime, and content activation.

## Acceptance Criteria

- Support can diagnose matches without direct DB access.
- Hidden-state access is exceptional and audited.
- Repairs preserve immutable history and replayability.
- Common stuck states recover automatically or enter a controlled queue.
- Staff permissions are least-privilege and environment-scoped.
- Support bundles and audit exports contain no forbidden secrets.

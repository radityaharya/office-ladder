# Data Lifecycle

Status: Proposed
Owner: Backend, security, and privacy owner
Updated: 2026-07-18

## Classification

| Class | Examples |
|---|---|
| C0 Public | Product rules, approved public content |
| C1 Internal | Versions, aggregate service metrics, deployment IDs |
| C2 Confidential | Email, username, memberships, replays, avatars, pseudonymous analytics |
| C3 Restricted | Password/session tokens, hidden roles, deck order, RNG, report evidence, secrets, backups |

Classification can change after reveal/completion, but hidden game data remains restricted until policy explicitly permits disclosure.

## Domains

- Authentication identity and sessions.
- Guest identity.
- Rooms and memberships.
- Canonical/private/public game state.
- Events, snapshots, and replays.
- Product analytics and aggregates.
- Reports and moderation evidence.
- Avatars/uploads.
- Consent and privacy requests.
- Staff audit logs.
- Backups.

## Identity

Registered identity stores minimum required profile and credential metadata. Email remains private.

Recommended session policy:

- Maximum age: 7 days initially.
- Rolling update: 24 hours.
- Fresh authentication for export/deletion/security changes: 15 minutes.
- Cleanup expired sessions within 24 hours.
- Login IP/user-agent security retention: 30 days unless held for an active case.

Account lifecycle states:

- Active.
- Deletion requested.
- Disabled.
- Anonymized.
- Deleted.

## Guests

- Real anonymous principal, not fingerprint/IP identity.
- No required email or globally reserved username.
- Room-specific display name.
- Expiry metadata and account-upgrade path.

Suggested retention:

- Guest never joining a room: 24 hours.
- Inactive guest identity: 7 days.
- Shared completed match references: pseudonymized under match retention.

## Rooms And Memberships

Rooms store ID, code/credential, host, visibility, status, settings, and timestamps.

Suggested lifecycle:

- Empty lobby: 1 hour.
- Inactive lobby: 24 hours.
- Interrupted active game: resumable for 24 hours.
- Completed room shell: 30 days unless needed by replay/report/support.

Membership is separate from account identity and game seat. Completed history should reference a match-local player record so account deletion does not corrupt shared matches.

## Game State

Representations:

- Canonical state: C3, server-only.
- Player-private projection: C3, one player.
- Shared projection: C2, authorized room members.
- Completed state: C2 or C3 depending on reveal policy.

Store canonical state durably in Postgres with versioned events/snapshots. Realtime alone is never persistence.

## Events And Replays

Separate:

- Command audit.
- Canonical game events.
- Realtime transport notifications.
- Security audit.
- Analytics.

A replay is a deliberate derived product, not raw event-table access.

Suggested retention:

- Raw command logs: 30 days.
- Canonical completed match: 30-90 days depending support/replay scope.
- Derived replay: 90 days by default.
- User-pinned replay: up to 1 year.
- Defect-linked replay: until defect closure plus review period.

Completed replay reveal policy requires a product decision.

## Analytics

Do not collect email, raw names, room codes, chat/report text, avatar URLs, full user agents, or canonical hidden state in general analytics.

Use pseudonymous IDs and separate production/non-production salts.

Suggested retention:

- Raw optional product events: 90 days.
- Error events: 30 days.
- Daily aggregates: 13 months.
- Truly anonymized balance aggregates: longer only with documented purpose.

Consent withdrawal stops future optional collection and deletes/dissociates raw identifiable events within the defined target.

## Reports

Reports and evidence are C3.

Controls:

- Length/attachment limits.
- Sanitization and malware scan.
- Reporter privacy.
- Staff access audit.
- Separate evidence storage.

Suggested retention:

- Unactionable/duplicate: 30 days after closure.
- Normal resolved report: 180 days.
- Enforcement history: 1 year when justified.
- Evidence: delete earlier where possible.

## Uploads And Avatars

Use private object storage and metadata records.

- Generated object keys.
- Allowlisted JPEG/PNG/WebP.
- Verify file signature.
- Re-encode to strip EXIF/GPS/comments.
- Enforce bytes, dimensions, and pixel count.
- Scan/moderate if publicly visible.
- Serve transformed signed URLs.
- Avoid unsanitized SVG.

Suggested cleanup:

- Orphan upload: 24 hours.
- Replaced avatar: 24 hours.
- Account deletion: active object within 7 days.

## Backups

Backups are C3.

Suggested initial policy:

- PITR: 7-14 days when enabled.
- Daily encrypted backup: 30 days.
- Pre-migration snapshot: 7 days after verification.

Requirements:

- Separate credentials and audited restore/download.
- Quarterly restore tests initially.
- Never restore production data into development/preview.
- Account deletion tombstones are reapplied after restore.
- Backups expire through provider lifecycle; do not edit immutable backups in place.

## Account Deletion

1. Require fresh authentication.
2. Revoke sessions immediately.
3. Mark deletion state and block new activity.
4. Delete credentials/direct identifiers.
5. Delete uploads.
6. Delete/dissociate optional analytics.
7. Revoke room memberships.
8. Pseudonymize completed shared match references.
9. Retain only narrow legal/safety records under documented hold.
10. Record non-personal completion status.

Use an idempotent deletion queue with per-domain progress and alerting.

## Export

Provide a fresh-authenticated asynchronous ZIP/JSON export containing user-owned profile, account metadata, consent, memberships/history, visible replay data, avatar, and applicable submitted reports.

Exclude credentials, tokens, other players' private data, unrevealed game state, reporter identities, staff notes, and abuse-detection internals.

Use expiring single-use download links and delete generated archives within 7 days.

## Consent

Separate:

- Terms acceptance.
- Privacy notice.
- Optional analytics.
- Optional marketing.
- Replay/leaderboard publication.
- Upload visibility acknowledgment.

Optional consent is not preselected and is as easy to withdraw as to grant.

## Privacy Requests

Support access, correction, export, deletion, restriction, objection, and consent withdrawal.

Operational target:

- Acknowledge within 3 business days.
- Complete within 30 days unless applicable law differs.
- Use proportionate identity verification.
- Redact third-party data.
- Audit completion and exceptions.

## Environments

Separate Supabase projects/credentials for production, staging, local, tests, and previews where practical.

- No production copies in development.
- Synthetic data outside production.
- Environment-specific secrets/cookies/analytics.
- Preview data expires automatically.
- Staging/preview are not indexed.

## Access Control

Use deny-by-default server authorization. Room hosts cannot see emails, IPs, hidden state, reports, or moderation notes.

Staff permissions separate support, moderation, analytics, security, privacy, and database operations. Privileged reads and destructive actions are audited.

## Scheduled Jobs

- Session/verification cleanup.
- Lobby expiry.
- Guest expiry.
- Interrupted game finalization.
- Event/replay expiry.
- Analytics aggregation/expiry.
- Orphan upload cleanup.
- Report retention review.
- Privacy request/deletion processing.
- Backup lifecycle verification.

Jobs are idempotent, bounded, observable, and retry-safe.

## Acceptance Criteria

- Every persisted domain has a classification, owner, purpose, and retention rule.
- Every retained row has an explicit expiry or state-derived policy.
- Deletion/export workflows cover auth, game, analytics, uploads, reports, and backups.
- Production/private data is inaccessible from lower environments.
- Hidden gameplay data and infrastructure secrets remain C3 throughout their lifecycle.

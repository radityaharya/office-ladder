# Security, Privacy, And Abuse Prevention

Status: Proposed
Owner: Security and backend engineering
Updated: 2026-07-18

## Trust Model

| Component | Trust |
|---|---|
| Browser | Untrusted intent and presentation |
| Better Auth cookie | Authentication credential, not room authorization |
| Hono command gateway | Trusted validation and authorization boundary |
| Game engine | Trusted deterministic rules |
| Postgres transaction | Canonical authority |
| Supabase Realtime | Sanitized delivery layer |
| Logs/analytics | Sensitive derived systems |

## Immediate Blockers

- Better Auth identity is not yet connected to Supabase private-channel authorization.
- Anonymous/guest auth is documented but not configured consistently.
- No game command authorization boundary exists.
- Privileged Supabase server helper needs a server-only guard.
- No project security headers or distributed rate limits exist.
- Auth schema and applied migration disagree about `is_anonymous`.

Resolve these before public room implementation.

## Authorization

Every command verifies server-side:

- Authenticated session.
- Room membership.
- Seat/player ownership.
- Room and game state.
- Active actor and phase.
- Role/capability.
- Target membership.
- Current revision/decision point.
- Card/token/ability ownership.

Never trust client-supplied user ID, role, host flag, dice, destination, card result, resource balance, or winner.

## Room Codes

Separate:

- Internal room ID.
- Opaque channel/game ID.
- Human join code.

Recommended code:

- At least 50 bits entropy.
- Crockford Base32 without ambiguous characters.
- Rate-limited by session/IP/code.
- Rotatable, revocable, and expiring.
- Never used as Realtime topic.
- Never logged or sent to analytics.

Unknown, expired, locked, and banned joins should reveal minimal metadata.

## Command Replay And Cheating

Every command includes unique ID, expected revision, turn number, and typed payload.

Controls:

- Unique `(game_id, command_id)`.
- Request hash detects command-ID reuse with changed payload.
- Server generates randomness and outcomes.
- Stale commands reject without mutation.
- Accepted retries return original result.
- Reaction and timer deadlines use server time.
- Optional future RNG commitment/reveal for verifiable completed games.

## Hidden Information

Separate:

- Public state.
- Player-private state.
- Server-only state.
- Public/private event projections.
- Security audit attribution.

Do not expose hidden roles, hands, deck order, RNG, private prompts, or anonymous Management actor data through:

- Shared API responses.
- Postgres Changes.
- Realtime payloads.
- React props/RSC payloads.
- DOM hidden by CSS.
- Logs, traces, analytics, errors, filenames, preloads, or accessibility labels.

Anonymous Shuffle public events omit actor and timing clues. Internal audit may retain actor under restricted access.

## Better Auth Hardening

Configure explicitly:

- Trusted production and development origins.
- Secure production cookies.
- Persistent rate-limit storage.
- Session age/update/freshness policy.
- Correct proxy/IP headers.
- Generic public errors.
- Audit hooks for session/account changes.
- Password reset before public launch.

Do not treat unverified email ownership as sufficient for privileged recovery.

## Rate Limits

Initial examples:

- Sign-in: 5/minute per IP and account identifier.
- Sign-up: 3/hour per IP.
- Guest creation: 10/hour per IP.
- Room create: 3/minute and 20/day per identity.
- Room join: 10/minute per IP, progressive delay after failures.
- Gameplay commands: network limit plus strict state-machine legality.
- Realtime token endpoint: 20/minute per session.
- Reports: 5/hour per reporter.

Use multiple dimensions and normalized IPv6 handling. Semantic legality is more important than raw network count.

## Guest Identity

If guest play remains primary:

- Use a real Better Auth anonymous principal/session.
- Room-specific display name.
- No required email.
- Clear guest indicator to reduce impersonation.
- Transactional account upgrade/linking.
- No device fingerprinting.
- Expire inactive guest identity under the data-lifecycle policy.

## Moderation Baseline

Private-room MVP still needs:

- Display-name validation/profanity handling.
- Host kick before start.
- Lock/rotate room code.
- Report player/display name/room.
- Account suspension and session revocation.
- Rate limits and audit trail.

Do not add public rooms, chat, uploads, or user-generated content without expanding moderation operations.

## Security Headers

Plan production headers:

- Content Security Policy.
- Frame ancestors/anti-clickjacking.
- `X-Content-Type-Options: nosniff`.
- Referrer Policy.
- Permissions Policy.
- HSTS in production.

Review CSP requirements for Supabase Realtime, images, audio, and analytics before enforcement.

## Secrets And Logs

Independent secrets:

- Database URLs.
- Better Auth secret.
- Supabase secret key.
- Realtime JWT signing key.
- Room-code pepper.
- Scheduler/internal endpoint secrets.

Never log cookies, authorization headers, passwords, room codes, private cards, hidden roles, or full JWTs. Use structured redacted logging.

Add secret scanning, dependency audit, static analysis, and client-bundle secret checks to CI.

## Incident Controls

Kill switches for:

- Guest/sign-up creation.
- Room creation/join.
- New match start.
- Gameplay commands.
- Realtime client publishing.
- Problematic cards/modes/content releases.

Incident runbook covers detection, containment, credential rotation, patching, validation, gradual recovery, notification, and review.

## Required Security Tests

- Cross-room API and channel access denied.
- Another player's private topic denied.
- Removed member loses access after refresh/reconnect.
- Replayed command does not apply twice.
- Out-of-turn and stale commands reject.
- Client-supplied outcomes are ignored/rejected.
- Public state contains no hidden data.
- Private state contains only caller data.
- Anonymous Shuffle reveals no actor.
- Logs/errors contain no secrets or private state.
- Missing claims/membership deny by default.
- Server/admin keys never enter client bundles.

## Acceptance Criteria

- Better Auth users can join only authorized private Realtime topics.
- All canonical game mutations pass one authenticated command boundary.
- Hidden-data leakage tests cover snapshots, events, DOM, logs, analytics, and assets.
- Guest lifecycle and account linking are defined and tested.
- Security headers, rate limits, secret handling, and incident controls are operational before public beta.

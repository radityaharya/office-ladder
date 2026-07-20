# Audio And Motion

Status: Proposed
Owner: Sound design, motion design, and frontend engineering
Updated: 2026-07-18

## Direction

Sound like an office after hours: dry, mechanical, restrained, and slightly mischievous. Avoid casino feedback, branded software notification imitation, and constant alert fatigue.

Promotion resolution is the signature audiovisual moment.

## Architecture

Logical services:

- `AudioDirector`: context, buses, playback, concurrency, ducking.
- `MusicDirector`: music state and transitions.
- `PresentationDirector`: maps committed events to motion/audio/haptics.
- `HapticsDirector`: supported local vibration patterns.
- `PreferenceStore`: sound/motion settings.
- `AssetLoader`: manifests, preload, cache, eviction.

Do not call audio or vibration APIs directly from gameplay components.

## Audio Unlock

- Create/resume Web Audio from a deliberate user gesture.
- Never block game entry when audio cannot unlock.
- Show a nonblocking Enable Sound control.
- Recheck context after tab suspension.
- Preserve user mute choice.

## Buses

```text
Master
  Music
  Gameplay SFX
  UI SFX
  Ambience
```

Haptics is separate.

Suggested defaults:

- Master 80%.
- Music 35%.
- Gameplay 75%.
- UI 45%.
- Ambience 20%.

Use perceptual gain curves and short fades to avoid clicks.

## Music

MVP loops:

1. Lobby/setup.
2. Main gameplay low/high intensity.
3. Results.

Intensity can derive from Clock Deck pressure and public chapter changes. Use musical crossfades rather than simply increasing volume.

Suggested states:

- Chapter 1: stable after-hours groove.
- Chapter 2: added pulse after reveal/block or mid Clock pressure.
- Chapter 3: stronger clock-like rhythm below 25%.
- Promotion attempt: music ducks and simplifies.
- Management win: procedural shutdown cadence.

## Sound Families

- UI: key switches, relay clicks, muted error thunk.
- Dice: onset, collision variations, settle, doubles accent.
- Movement: capped dry board steps plus crossing/landing emphasis.
- Work: keyboard/copier.
- Meeting: calendar/chair/projector.
- Event: office PA/interruption.
- Networking: coffee/conversation/lanyard.
- Finance: calculator/receipt.
- Audit: scanner and lock.
- Burnout: power-down.
- CEO Office: elevator/access chime.
- Cards: shared paper base plus deck-specific identifier.
- Resources: distinct restrained gain/loss earcons.

Do not create a unique sound for every card or board space.

## Promotion Sequence

1. Land on CEO Office.
2. Music ducks.
3. Eligibility appears.
4. Player confirms.
5. Server opens/resolves block window.
6. Success: elevator ascent/access cadence.
7. Block: hard stamp, identity reveal, colder music state.
8. Invalid/failure: restrained denial without humiliation.

Only authoritative resolution events trigger success or block presentation.

## Haptics

Progressive enhancement, mostly Android browser support.

Use only for personally relevant events:

- Local dice settle.
- Local landing.
- Local targeted negative effect.
- Five-second warning.
- Promotion success/block.
- Local Burnout.
- Victory.

No haptic on every movement step or remote action.

## Motion

Use CSS and Web Animations API initially. Add a motion library only for a demonstrated need.

Timing vocabulary:

- Press: 80-120 ms.
- Selection: 120-180 ms.
- Panel: 180-240 ms.
- Card reveal: 240-360 ms.
- Dice: 650-1000 ms.
- Piece step: 70-110 ms with total cap.
- Promotion/reveal: 900-2200 ms.

Prefer transform and opacity. Avoid bounce/elastic easing.

## Authoritative Event Sequencing

Presentation consumes ordered committed events, not arbitrary React state observations.

Event envelope includes:

- Event ID.
- Sequence/revision.
- Type.
- Server logical time.
- Visibility.
- Public/private payload.
- Command causation.

Rules:

- Deduplicate event IDs.
- Buffer gaps and resync.
- State updates immediately; presentation runs separately.
- Critical prompts interrupt/compress low-priority effects.
- Reconnect clears obsolete presentation.
- Anonymous Management actions have identical timing/audio for all players and no actor clue.

## Presentation Priority

- Critical: prompts, reactions, reconnect correction, game over.
- High: dice, landing, promotion, reveal.
- Medium: cards, Burnout, Audit, global events.
- Low: resource ticks and incidental confirmations.

When behind, drop/merge low-priority cues and preserve final state and decisions.

## Timer Audio

- No continuous ticking.
- Optional local cue at 5 seconds.
- Optional quiet 3/2/1 pips for active player only.
- Remote turns do not produce countdown pips.
- Expiration result waits for server event.

## Reduced Motion

- Dice -> static values with brief fade.
- Movement -> origin/destination highlight.
- Card flip -> crossfade.
- Resource flight -> number highlight.
- Promotion -> static rank/result transition.
- Confetti/particles -> removed.
- Timer pulse -> static styling.

Reduced motion preserves chronology rather than making everything instantaneous and confusing.

## Reduced Sound

Modes:

- Full.
- Essential: no music/ambience, only decision/warning/outcome cues.
- Muted.
- Custom buses.

Motion and sound preferences remain independent.

## Formats And Loading

- SFX masters: WAV 48 kHz/24-bit.
- Runtime SFX: Opus plus verified fallback.
- Music: streamed Opus/AAC fallback.
- Visual art: SVG/CSS/WebP; video only for rare justified sequences.
- Semantic asset IDs in a manifest, not direct paths in components.

Preload:

- Landing: nothing beyond optional neutral UI cue.
- Lobby: lobby music only when enabled.
- Before match: common dice, movement, cards, resources, turn cues.
- Background after start: promotion, special tiles, later music, victory.

Missing media fails silently while visual/text feedback remains.

## Performance Budgets

- Critical lobby audio under 250 KB.
- Critical gameplay SFX under 1 MB.
- Total SFX library under 3 MB.
- Initial match audio under 2 MB.
- 12-16 concurrent voices maximum.
- No normal-turn continuous particles.
- No per-frame React state updates.

## Licensing

Maintain an asset ledger covering source, creator, license, purchase/contract, attribution, modifications, runtime files, and approval. Browser delivery rights must be explicit.

## Acceptance Criteria

- Duplicate events never replay signature sound or haptic.
- Reconnect never replays stale effects.
- Hidden actions leak no actor information through timing, sound, or motion.
- Muted and reduced-motion play remain fully understandable.
- Audio autoplay failure never blocks gameplay.
- Full Marathon-length testing shows no alert fatigue or memory growth.
- All media has documented interactive-web and print rights where applicable.

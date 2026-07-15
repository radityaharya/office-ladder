# Office Ladder — Game Design (PRD)

Original product/game design brief. Tech stack section below is historical context — the **actual** stack decisions (with reasoning, and what was rejected) live in [`PLAN.md`](../PLAN.md) at the repo root; that document supersedes the "Technology Stack" section here.

## Overview

Office Ladder is a browser-based multiplayer board game inspired by Monopoly. Players take turns rolling dice, moving around an office-themed board, collecting money, reputation, and energy, and climbing the corporate ladder from Intern to Director.

The game should be simple enough to learn in under five minutes while supporting real-time multiplayer gameplay.

## Target Platform

- Web browser (desktop-first)
- Multiplayer via private/public rooms
- 2–6 players

## Technology Stack (historical — see PLAN.md for current)

- Frontend: Next.js, React, TypeScript, TailwindCSS, Framer Motion
- Backend: Node.js, Express, Socket.io
- Database: PostgreSQL + Prisma
- Hosting: Vercel (frontend), Railway/Render (backend), Supabase PostgreSQL

## Core Gameplay

Each turn:
1. Roll dice
2. Move player
3. Resolve tile
4. End turn

30-second turn timer.

### Player Stats

- Money: 1000
- Reputation: 0
- Energy: 5
- Rank: Intern
- Hidden Character Role

## Board

28 looping spaces including Reception, Pantry, Meeting Room, IT, Finance, HR, Marketing, Sales, CEO Office, Training Room, Printer, Coffee Machine, Project Room, Audit, Bonus, Lunch.

### Tile Effects

| Tile | Effect |
|---|---|
| Pantry | +1 Energy |
| Finance | +$300 |
| Marketing | 50% +2 Reputation / 50% -$200 |
| Meeting Room | Draw Event Card |
| CEO Office | Attempt Promotion |
| Printer | Skip next turn |
| Training | +1 Reputation |
| Audit | -$300 |
| Bonus | +$500 |
| Coffee Machine | +2 Energy |

## Promotion Ladder

Intern → Staff → Senior Staff → Supervisor → Assistant Manager → Manager → Senior Manager → Director

### Requirements

| Rank | Money | Reputation |
|---|---|---|
| Staff | $500 | 2 |
| Senior Staff | $1000 | 4 |
| Supervisor | $1500 | 6 |
| Assistant Manager | $2500 | 8 |
| Manager | $4000 | 10 |
| Senior Manager | $6000 | 13 |
| Director | $8000 | 15 |

## Hidden Character Roles

| Role | Effect |
|---|---|
| IT | Double IT rewards |
| Finance | +$100 salary bonus |
| HR | +1 Reputation on HR tile |
| Marketing | Marketing always succeeds |
| CEO Favorite | Promotion requires 2 less Reputation |
| Project Hero | Draw two event cards and choose one |

## Event Cards

Examples: Employee of the Month, Annual Bonus, System Crash, Reply All, Free Coffee, Project Success, Budget Cut, Late to Meeting, Promotion Rumor, Office Party

## Win Condition

First player promoted to Director wins immediately.

## UI Requirements

Modern flat corporate theme (blue/white/gray), responsive layout, animated dice, player movement, card flips, promotion celebration, confetti on victory, sound toggle.

## Networking

Socket Events: `create-room`, `join-room`, `leave-room`, `ready`, `start-game`, `roll-dice`, `move-player`, `draw-card`, `promotion`, `end-turn`, `game-over`, `disconnect`

## Architecture

- Server-authoritative game logic.
- Shared game engine package containing board, dice, tiles, cards, promotions, turn handling, and game state.
- Strict TypeScript, ESLint, Prettier, reusable components, Docker support.

## MVP Scope

- Lobby
- Realtime multiplayer
- Dice
- Movement
- Board
- Event cards
- Hidden roles
- Promotion system
- Winner screen

## Future Enhancements

AI bots, chat, spectator mode, replay, leaderboard, daily challenges, avatars, mobile support.

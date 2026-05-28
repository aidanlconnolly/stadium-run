# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Run locally

Single self-contained HTML file. Three.js is loaded from a CDN via an import map — no build step:

```bash
open index.html                  # works from file://
python3 -m http.server 5350      # OR serve, matches the workspace preview config (port 5350)
```

**Preview server note:** the Claude Code preview server cannot resolve paths with spaces or write outside `/tmp` from its sandbox. The workspace's `.claude/launch.json` entry for `stadium-run` serves from `/tmp/stadium-run/`. Sync edits there from the *user's* shell (not the preview's): `cp -r 'Stadium Run/.' /tmp/stadium-run/`. Editing `index.html` directly and reloading from `file://` is the friction-free alternative.

When opened from `file://` or without `/api/leaderboard` reachable, the leaderboard transparently falls back to `localStorage` (key `sr_lb`). No Node/npm required for local play.

## Deploy

Vercel project, pushed via GitHub auto-deploy. The leaderboard endpoint requires a Vercel KV database to be attached to the project — Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically, which `@vercel/kv` reads.

## Architecture

**Two-file mirror.** `index.html` is the source of truth. `public/index.html` must be an exact byte-for-byte copy — Vercel serves the `public/` version. After editing `index.html`, always:

```bash
cp index.html public/index.html
```

**Single-file game (`index.html`).** All HTML, CSS, JS, and Three.js scene in one file. The scene is a perspective WebGL canvas; HUD/menu/shop/leaderboard/pause overlays are HTML positioned absolutely on top.

**Three lanes.** Player runs at world Z=0 toward the camera; lanes at world X = `LANE_X[]` (`-LANE_W, 0, +LANE_W`). Lanes interpolate smoothly via `S.laneX`. The pitch is a long static plane with a striped canvas texture; the texture `offset.y` scrolls each frame to fake forward motion, while obstacles physically move toward +Z (toward camera).

**State machine.** Single `S` object built by `mkState()`, reset at run start. `S.phase` is one of `menu | playing | paused | caught`. All input handlers gate on `S.phase`. New interactivity should do the same.

**Lives & 30s pressure window.** On obstacle hit: `S.lives--`, ref closes in (`S.refZTarget = REF_CLOSE`), `S.pressureUntil = now + 30000`, red CSS vignette turns on. If hit again while `pressureUntil > now` → game over. If the 30s window elapses without another hit, `S.lives` resets to 2 and the ref drifts back. Coins are *always* banked at run end (caught or quit-from-pause), per design.

**Difficulty.** `speed` grows asymptotically toward `MAX_SPEED` via `1 - exp(-distance * SPEED_GROWTH)`. Spawn interval shrinks linearly with `distNorm` (clamped to `SPAWN_INTERVAL_MIN`). `spawnRow()` always picks a `safeLane` first so at least one lane is passable.

**Obstacles.** Hurdle (jumpable), advertising board (jumpable), banner (slide under), rival player (jumpable / lane-switch), dugout (mountable — jump onto the roof at `DUGOUT_Y = 1.4` to run along and grab coins on top). `aabbHit()` + `checkHeightOverlap()` decides collision per kind.

**Cosmetics catalog (`CATALOG`).** Single source of truth for unlockable characters / jerseys / boots. Each entry has `id, kind, name, price, palette`. `applyCosmeticsTo(rig, profile)` mutates the runner rig's material colors based on the selected ids. Both player and referee use the same rig built by `buildRunner()`.

**Persistence (`sr_profile`).**

```json
{
  "name": "Aidan",
  "bankCoins": 0,
  "bestScore": 0,
  "runs": 0,
  "muted": false,
  "selectedCharacter": "striker",
  "selectedJersey": "classic",
  "selectedBoots": "default-boots",
  "unlocks": ["striker", "classic", "default-boots"]
}
```

Saved on every shop transaction, equip, name change, and run end. Loaded on boot.

**Input.**
- Desktop: ←/→ A/D = lane change; ↑/W/Space = jump; ↓/S = slide; Esc = pause/resume.
- Mobile: horizontal swipe on canvas = lane change; tap or swipe-up = jump; swipe-down = slide. `touchmove` is `preventDefault`ed so the page doesn't scroll.

**Leaderboard API (`api/leaderboard.js`).** Vercel Node serverless function backed by Vercel KV. `GET` reads sorted set `runner:points` (top 50) and joins game counts from hash `runner:games`. `POST` does atomic `zincrby` (with the run's coins) + `hincrby`. Names sanitised to 24 chars, character id to 32 chars, coins clamped 0–10000 per submission. No auth — friend-group toy.

**Leaderboard fallback.** `submitScore` tries `fetch('/api/leaderboard', { signal: AbortSignal.timeout(4000) })` with a 4-second timeout, then *always* writes to `localStorage` regardless of outcome. `fetchLB` mirrors this. The 4s timeout prevents the game-over screen from hanging when offline / from `file://` — don't remove it.

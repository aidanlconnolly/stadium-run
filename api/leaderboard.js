// Vercel Node serverless function — shared leaderboard backed by Vercel KV.
// GET  /api/leaderboard       -> { entries: [{ name, character, points, games }, ...] }
// POST /api/leaderboard       -> body { name, character, coinsDelta, distance, caught }
//
// No auth — this is a friend-group toy. Names are sanitized to 24 chars.

import { kv } from '@vercel/kv';

const POINTS_KEY = 'runner:points'; // sorted set: member = "name|character", score = lifetime coins
const GAMES_KEY = 'runner:games';   // hash:    field = "name|character", value = games played

function sanitizeName(s) {
  return String(s || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 24);
}
function sanitizeCharacter(s) {
  return String(s || '').replace(/[\x00-\x1f|]/g, '').trim().slice(0, 32);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      const range = await kv.zrange(POINTS_KEY, 0, 49, { rev: true, withScores: true });
      const entries = [];
      const ids = [];
      for (let i = 0; i < range.length; i += 2) {
        ids.push(range[i]);
      }
      const games = ids.length ? await kv.hmget(GAMES_KEY, ...ids) : {};
      for (let i = 0; i < range.length; i += 2) {
        const id = range[i];
        const score = Number(range[i + 1]) || 0;
        const [name, character] = String(id).split('|');
        const g = (games && games[id] != null) ? Number(games[id]) : 0;
        entries.push({ name, character, points: score, games: g });
      }
      return res.status(200).json({ entries });
    } catch (err) {
      return res.status(500).json({ error: 'kv_unavailable', message: String(err && err.message || err) });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const name = sanitizeName(body.name);
      const character = sanitizeCharacter(body.character);
      const pts = Math.max(0, Math.min(10000, Number(body.coinsDelta) || 0));
      if (!name) return res.status(400).json({ error: 'name_required' });
      const id = `${name}|${character}`;
      await kv.zincrby(POINTS_KEY, pts, id);
      await kv.hincrby(GAMES_KEY, id, 1);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'kv_unavailable', message: String(err && err.message || err) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
}

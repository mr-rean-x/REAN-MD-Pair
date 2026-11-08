// REAN MD — web pairing API for Vercel.
// POST /api/pair  { number }        -> { code, sessionId }
// GET  /api/pair?sessionId=...     -> { paired, code, session? }
//
// Two modes:
// 1. RAILWAY_PAIR_URL is set: the code is requested from the Railway bot
//    itself (its pair-server.js), so pairing on the website links the
//    number to the real REAN MD bot — exactly like Jawad MD's site.
//    No token is needed for pairing.
// 2. RAILWAY_PAIR_URL is empty: falls back to a local Baileys socket here
//    on Vercel (a bare connection — the code pairs to a temporary session,
//    not to the Railway bot). Set the URL to use mode 1.
//
// To use mode 1: Railway dashboard -> REAN-MD service -> Settings ->
// Networking -> Generate Domain. Paste that domain below (no trailing /),
// push to GitHub, Vercel redeploys and the website pairs into the bot.
//
// NOTE: Baileys is loaded lazily inside mode 2 only. The proxy path
// (mode 1) must never depend on it — a Baileys load failure must not
// crash the whole function.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAIR_CODE = 'MRREANMD'; // 8 chars, shows as MRRE-ANMD
const SESSION_TTL_MS = 120000; // 2 minutes, then the socket is closed

// Railway bot er domain (sudhu backend connection er jonno; website er address Vercel er tai thakbe)
const RAILWAY_PAIR_URL = 'https://rean-md-production.up.railway.app';

global.__reanPair = global.__reanPair || {};
const sessions = global.__reanPair;

const sessionDir = (id) => path.join('/tmp', 'rean-pair-' + id);

function cleanup(id) {
  const s = sessions[id];
  if (!s) return;
  try { s.sock?.end?.(); } catch {}
  try { fs.rmSync(sessionDir(id), { recursive: true, force: true }); } catch {}
  delete sessions[id];
}

function waitForOpen(sock, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const to = setTimeout(() => finish(false), ms);
    const onUpdate = (u) => {
      if (u.connection === 'open') { clearTimeout(to); finish(true); }
      if (u.connection === 'close') { clearTimeout(to); finish(false); }
    };
    sock.ev.on('connection.update', onUpdate);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ---- GET: poll pairing status ----
  if (req.method === 'GET') {
    const id = String(req.query.sessionId || '');
    const s = sessions[id];
    if (!s) return res.status(404).json({ error: 'Session expired. Generate a new code.' });
    if (s.dead) return res.status(410).json({ error: 'Connection closed. Generate a new code.' });
    if (s.paired) {
      const creds = JSON.stringify(s.state.creds);
      return res.status(200).json({ paired: true, code: s.code, session: Buffer.from(creds).toString('base64') });
    }
    return res.status(200).json({ paired: false, code: s.code });
  }

  // ---- POST: generate a pairing code ----
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const number = String((body && body.number) || '').replace(/\D/g, '');
  if (number.length < 10 || number.length > 15) {
    return res.status(400).json({ error: 'Enter a valid WhatsApp number with country code (example: 8801956501630).' });
  }

  // ---- Mode 1: ask the Railway bot for the code (pairs into the real bot) ----
  if (RAILWAY_PAIR_URL) {
    try {
      const upstream = await fetch(RAILWAY_PAIR_URL.replace(/\/$/, '') + '/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: data.error || 'Pair server error. Try again.' });
      }
      if (!data.code) throw new Error('Pair server returned no code.');
      return res.status(200).json({ code: data.code, sessionId: null });
    } catch (e) {
      return res.status(502).json({ error: 'Pair server (Railway bot) is offline right now. Try again in a bit.' });
    }
  }

  // ---- Mode 2: local Baileys socket on Vercel (temporary session) ----
  let baileys;
  let pino;
  try {
    baileys = require('@whiskeysockets/baileys');
    pino = require('pino');
  } catch (e) {
    return res.status(500).json({ error: 'Pair service is not available right now. Try again.' });
  }
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = baileys;

  const id = crypto.randomBytes(8).toString('hex');
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir(id));
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['REAN MD', 'Chrome', '1.0'],
      syncFullHistory: false,
    });
    sessions[id] = { sock, state, paired: false, dead: false, code: null, createdAt: Date.now() };
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
      if (u.connection === 'open') sessions[id] && (sessions[id].paired = true);
      if (u.connection === 'close') sessions[id] && (sessions[id].dead = true);
    });

    // Give the socket a moment to connect, then ask for the code.
    await waitForOpen(sock, 20000);
    if (sock.authState.creds.registered) {
      cleanup(id);
      return res.status(400).json({ error: 'This number is already registered. Use a different number.' });
    }
    const code = await sock.requestPairingCode(number, PAIR_CODE);
    sessions[id].code = code;
    setTimeout(() => cleanup(id), SESSION_TTL_MS);
    return res.status(200).json({ code, sessionId: id });
  } catch (e) {
    cleanup(id);
    return res.status(500).json({ error: 'Could not generate a code: ' + (e.message || 'unknown error. Try again.') });
  }
};

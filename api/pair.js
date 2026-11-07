// REAN MD — web pairing API for Vercel.
// POST /api/pair  { number }        -> { code, sessionId }
// GET  /api/pair?sessionId=...     -> { paired, code, session? }
//
// Flow: creates a Baileys socket (in-memory auth in /tmp), requests the
// pairing code 'MRREANMD' for the given number, returns the code. The
// socket stays alive in this instance's memory for ~2 minutes so the user
// can type the code in WhatsApp; the frontend polls the GET endpoint and,
// once paired, receives the session credentials (base64) to save.
//
// Honest limits (Vercel free tier):
// - Serverless instances are stateless: if the GET poll hits a cold/other
//   instance, the session is gone and the frontend must generate again.
// - The pairing code is valid for ~60 seconds — type it fast.
// - The session this creates is a bare Baileys connection. To run the full
//   REAN MD bot (all commands) on that number, pair it with the Railway
//   bot via Telegram /pair — that session is the real bot session.
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PAIR_CODE = 'MRREANMD'; // 8 chars, shows as MRRE-ANMD
const SESSION_TTL_MS = 120000; // 2 minutes, then the socket is closed

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

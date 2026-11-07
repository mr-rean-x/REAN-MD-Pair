# REAN MD — Web Pair (Vercel)

Red-themed WhatsApp pairing page for REAN MD, like jawadtech.vercel.app.
Enter a WhatsApp number, get the 8-digit pairing code (`MRREANMD`, shows as
`MRRE-ANMD`), type it in WhatsApp under Linked devices.

## Files

- `index.html` — the page (red theme, REAN MD branding)
- `api/pair.js` — Vercel serverless function, generates the real pairing code
  with Baileys (`requestPairingCode`) and reports pairing status
- `package.json` / `vercel.json` — deps + 60s function timeout

## Deploy on Vercel (no variables needed)

1. Push this folder to a GitHub repo (or drag-drop it in
   vercel.com → Add New → Project → Import).
2. Deploy. No environment variables are needed.
3. Open the site, enter the number with country code
   (example: `8801956501630`), click **Generate Pair Code**.
4. Type the code in WhatsApp **within ~60 seconds**:
   WhatsApp → Linked devices → Link a device →
   "Link with phone number instead" → enter the code.

## Honest limits

- Vercel free-tier functions are stateless: if the status poll hits a cold
  instance, the session is gone and the page will say "Session expired" —
  just press Generate again.
- The pairing code expires in about 60 seconds. Type it fast.
- The session this page creates is a bare Baileys connection. To run the
  full REAN MD bot (all 600+ commands) on that number, pair the same number
  with the Railway bot via Telegram `/pair` — that session is the real bot
  session.
- Use a secondary WhatsApp number. Unofficial bots carry a ban risk —
  never pair your main number.

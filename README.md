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

## How pairing works (website <-> Railway bot)

The page asks the **Railway bot itself** for the pairing code, so a number
paired on the website links to the real REAN MD bot — exactly like
Jawad MD's site. No token is needed for pairing.

1. The bot repo (`REAN-MD`) runs a tiny HTTP pair API (`pair-server.js`,
   `POST /pair`) on Railway. It reuses the bot's own Telegram `/pair`
   flow: same validation, same `MRREANMD` code, same session files.
2. This project (`api/pair.js`) forwards code requests to that API.
   Set the bot's public URL in `api/pair.js`:
   `RAILWAY_PAIR_URL = 'https://<your-railway-domain>'`
   (Railway dashboard → REAN-MD service → Settings → Networking →
   Generate Domain — paste the domain it gives you, no trailing `/`).
3. If `RAILWAY_PAIR_URL` is empty, the page falls back to generating the
   code from its own temporary Baileys session on Vercel (the code then
   pairs to that temporary session, not to the Railway bot).

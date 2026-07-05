# kas-bot (Telegram capture bot)

Snap a receipt or type a note → **Cloudflare Workers AI** (free tier) parses it →
you confirm with a tap → it posts to the Kas ledger via `cash.post_transaction`.
A 15-minute cron also pings you when a new bank statement lands in R2 (full
statement auto-import is Fase B).

**Money safety:** the bot only ever writes after an explicit **✅ Ya** tap, and
every write goes through the same `post_transaction` RPC the app uses (amount>0,
from≠to enforced by DB CHECK constraints). The Supabase service key lives only in
worker secrets.

## Architecture
```
Telegram ──webhook──▶ kas-bot (Cloudflare Worker)
                          │  parse (Workers AI: text model / receipt vision model)
                          │  fetch account context (Supabase REST, cash schema)
                          ▼
                    confirm message  ──✅──▶ cash.post_transaction ──▶ ledger
                          ▲
R2 kas-statements ──cron every 15m──▶ "statement baru masuk" ping
```

## Current deployment status
Already provisioned by the setup session:
- ✅ KV namespace created + wired (`BOT_KV`).
- ✅ Worker deployed → `https://kas-bot.gerriodailmypratama.workers.dev`.
- ✅ `TELEGRAM_WEBHOOK_SECRET` set (agent-generated).
- ✅ Parse brain = Workers AI (`AI` binding) — **no external API key, no billing**.

**Remaining owner steps: set the 3 secrets below, then hit `/setup`.**

## Owner setup

Anything with a token or key is **your hands only** — the agent never types these.

### 1. Create the bot (→ `TELEGRAM_BOT_TOKEN`)
Telegram → **@BotFather** → `/newbot` → pick a name + username. Copy the **bot
token** (looks like `12345:AA...`). Keep it private — don't paste it in chat.

### 2. Find the allowed chat ids (→ `ALLOWED_CHAT_IDS`)
Telegram → **@userinfobot** → `/start` → it replies with your numeric **Id**. Do
the same from Steffie's Telegram. Both, comma-separated: `12345678,87654321`.
(Chat ids aren't secret — fine to share.)

### 3. Get the Supabase service key (→ `SUPABASE_SERVICE_KEY`)
Supabase → Project Settings → API → **service_role** secret.
> 🔴 This key can write the whole ledger. Treat it like a bank password — only
> ever paste it into `wrangler secret put` or the Cloudflare dashboard, never
> into a file, chat, or the repo.

### 4. Set the 3 secrets
Either terminal:
```
cd workers/kas-bot
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ALLOWED_CHAT_IDS
npx wrangler secret put SUPABASE_SERVICE_KEY
```
…or point-and-click: **Cloudflare dashboard → Workers & Pages → kas-bot →
Settings → Variables and secrets → Add**, type **Secret (encrypt)**, exact names
above.

### 5. Finish (register the webhook — no curl)
The worker registers itself. Once the secrets exist, either:
- visit `https://kas-bot.gerriodailmypratama.workers.dev/setup?secret=<TELEGRAM_WEBHOOK_SECRET>` once, **or**
- do nothing — the 15-min cron auto-registers on its next tick.

### 6. Test
Message your bot: `/start`, then `kopi 25rb pake cimb` or send a receipt photo.
Confirm the card, tap **✅ Ya**, and check kas.gerriolab.com.

## Parse provider (auto)
- Default: **Cloudflare Workers AI** (free, no key).
- Optional upgrade: set a `GEMINI_API_KEY` secret → the bot auto-switches to
  **Google Gemini** (stronger receipt-photo vision), still free tier. Remove the
  key to fall back to Workers AI. Model via `GEMINI_MODEL` var (default
  `gemini-2.0-flash`).

## Config (`wrangler.jsonc` vars — non-secret)
- `SUPABASE_URL` — project REST base.
- `DB_SCHEMA` — `cash`.
- `WORKER_URL` — this worker's public URL (used by self-registration).
- `TEXT_MODEL` / `VISION_MODEL` — Workers AI models for note / receipt parsing.
- `GEMINI_MODEL` — Gemini model used when `GEMINI_API_KEY` is set.

## Notes
- No npm dependencies — pure Web APIs (`fetch`, `crypto`).
- Every proposal is confirm-gated, so an occasional parse miss is caught before
  it's written. Swap models to tune accuracy vs cost.
- Strangers are silently ignored (only `ALLOWED_CHAT_IDS` are answered).
- Pending confirmations + retry-dedup + statement-seen marks live in `BOT_KV`
  with short TTLs.

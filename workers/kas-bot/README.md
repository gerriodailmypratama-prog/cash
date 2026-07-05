# kas-bot (Telegram capture bot)

Snap a receipt or type a note → Claude parses it → you confirm with a tap →
it posts to the Kas ledger via `cash.post_transaction`. A 15-minute cron also
pings you when a new bank statement lands in R2 (full statement auto-import is
Fase B).

**Money safety:** the bot only ever writes after an explicit **✅ Ya** tap, and
every write goes through the same `post_transaction` RPC the app uses (amount>0,
from≠to enforced by DB CHECK constraints). The Supabase service key lives only in
worker secrets.

## Architecture
```
Telegram ──webhook──▶ kas-bot (Cloudflare Worker)
                          │  parse (Claude API: text or receipt vision)
                          │  fetch account context (Supabase REST, cash schema)
                          ▼
                    confirm message  ──✅──▶ cash.post_transaction ──▶ ledger
                          ▲
R2 kas-statements ──cron every 15m──▶ "statement baru masuk" ping
```

## Owner setup (one-time)

Anything with a token or key is **your hands only** — the agent never types these.

### 1. Create the bot
- Telegram → **@BotFather** → `/newbot` → pick a name + username.
- Copy the **bot token** it gives you (looks like `12345:AA...`).

### 2. Find the allowed chat ids
- Telegram → **@userinfobot** → it replies with your numeric **Id**.
- Do the same from Steffie's Telegram to get hers.
- You'll paste both as `ALLOWED_CHAT_IDS` (comma-separated) in step 5.

### 3. Create the KV namespace
```
cd workers/kas-bot
npx wrangler kv namespace create kas_bot_kv
```
Paste the returned `id` into `wrangler.jsonc` (`kv_namespaces[0].id`).

### 4. Pick a webhook secret
Make up any random string (e.g. from a password manager). You'll use the same
value in step 5 (`TELEGRAM_WEBHOOK_SECRET`) and step 7 (`secret_token`).

### 5. Set the secrets
Run each and paste the value when prompted:
```
npx wrangler secret put TELEGRAM_BOT_TOKEN        # from BotFather (step 1)
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # your random string (step 4)
npx wrangler secret put ANTHROPIC_API_KEY         # console.anthropic.com key
npx wrangler secret put ALLOWED_CHAT_IDS          # e.g. 12345678,87654321
npx wrangler secret put SUPABASE_SERVICE_KEY      # 🔴 Supabase → Settings → API → service_role
```
> 🔴 The `service_role` key can write the whole ledger. Treat it like a bank
> password: only ever paste it into `wrangler secret put`, never into a file,
> chat, or the repo.

### 6. Deploy
```
npx wrangler deploy
```
Note the deployed URL (e.g. `https://kas-bot.<subdomain>.workers.dev`).

### 7. Register the webhook
```
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://kas-bot.<subdomain>.workers.dev" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
Expect `{"ok":true,...}`.

### 8. Test
Message your bot: `/start`, then try `kopi 25rb pake cimb` or send a receipt
photo. Confirm the card shows up, tap **✅ Ya**, and check kas.gerriolab.com.

## Config (`wrangler.jsonc` vars — non-secret)
- `SUPABASE_URL` — project REST base.
- `DB_SCHEMA` — `cash`.
- `MODEL` — Claude model for parsing (default `claude-sonnet-5`).

## Notes
- No npm dependencies — pure Web APIs (`fetch`, `crypto`, `btoa`).
- Strangers are silently ignored (only `ALLOWED_CHAT_IDS` are answered).
- Pending confirmations + retry-dedup + statement-seen marks live in `BOT_KV`
  with short TTLs.

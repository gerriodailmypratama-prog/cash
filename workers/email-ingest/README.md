# kas-email-ingest (Cloudflare Email Worker)

Catches mail sent to **statements@gerriolab.com** and stores the raw message +
any PDF attachments into the R2 bucket `kas-statements`. Parsing/import into the
Kas ledger happens downstream (agent session / future parser) — this worker
holds **no database credentials**, so a leak here can't touch the ledger.

## Live setup (PR-CL22, gerriolab.com)
- Cloudflare Email Routing: **enabled**, status `ready` (MX route1/2/3.mx.cloudflare.net + SPF auto-provisioned).
- Routing rule: `statements@gerriolab.com` → worker `kas-email-ingest`.
- Only mail whose `from` contains an owner address (or Google's forwarding-confirmation sender) is stored; everything else is rejected.

## Deploy
```
npm install
npx wrangler deploy
```
Requires `wrangler login` (owner OAuth). R2 bucket `kas-statements` must exist.

## Read what landed
```
npx wrangler r2 object list kas-statements
npx wrangler r2 object get kas-statements/pdf/<name> --file out.pdf
```

## Owner's one-time step
Gmail → Settings → Forwarding → add `statements@gerriolab.com`; Gmail sends a
confirmation email (from forwarding-noreply@google.com) which lands in this
bucket — read the code from R2 to confirm. Then a filter: bank statement mail →
forward to that address.

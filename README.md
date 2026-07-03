# Kas

Aplikasi kas pribadi & bisnis (Gerrio Lab) — pencatatan transaksi, saldo akun, dan kartu kredit di atas ledger `from → to` cash-basis.

- **Live:** https://kas.gerriolab.com (Cloudflare Pages project `cash`, fallback https://cash-98j.pages.dev)
- **Stack:** SvelteKit 5 + Tailwind + Supabase (schema `cash`), PWA dark-only
- **Agent rules & repo facts:** lihat [AGENTS.md](AGENTS.md)
- **Migrations:** folder [sql/](sql) — applied via Supabase SQL Editor, prod-first

> Nama lama repo/app: GerrioFin — di-rename ke **Kas** di PR-CL11.

// Supabase PostgREST access for the bot. Uses the service key (bypasses RLS),
// so this worker is money-sensitive — it only ever writes after the owner taps
// "Ya", and every write goes through the same cash.post_transaction RPC the app
// uses (amount>0, from<>to enforced by table CHECK constraints).

function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

const rest = (env, path) => `${env.SUPABASE_URL}/rest/v1/${path}`;

// Pots (entities) + accounts, shaped for the LLM to map against. Cached in KV
// for 5 min so we're not hitting the DB on every message.
export async function accountContext(env) {
  const cached = await env.BOT_KV.get('acct_ctx2', 'json');
  if (cached && cached.exp > Date.now()) return cached.data;

  const prof = { 'Accept-Profile': env.DB_SCHEMA };
  const [ents, accts] = await Promise.all([
    fetch(rest(env, 'entities_active?select=id,name'), { headers: headers(env, prof) }).then((r) => r.json()),
    fetch(rest(env, 'accounts_active?select=id,entity_id,code,name,type,subtype&order=code'), { headers: headers(env, prof) }).then((r) => r.json())
  ]);
  if (!Array.isArray(ents) || !Array.isArray(accts)) {
    throw new Error('accountContext: unexpected response ' + JSON.stringify(ents).slice(0, 200));
  }

  const byEnt = new Map(ents.map((e) => [e.id, e.name]));
  const data = {
    pots: ents.map((e) => e.name),
    accounts: accts.map((a) => ({
      id: a.id,
      pot: byEnt.get(a.entity_id) || '?',
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype
    }))
  };
  await env.BOT_KV.put('acct_ctx2', JSON.stringify({ exp: Date.now() + 5 * 60 * 1000, data }));
  return data;
}

// Validate a parsed proposal against the real account set before we ever show it
// to the user. Returns { ok, error, tx } where tx is the RPC arg object.
export function buildTx(proposal, ctx) {
  const ids = new Set(ctx.accounts.map((a) => a.id));
  const amt = Number(proposal.amount);
  if (!(amt > 0)) return { ok: false, error: 'jumlah tidak valid' };
  if (!ids.has(proposal.from_account_id)) return { ok: false, error: 'akun sumber tidak dikenal' };
  if (!ids.has(proposal.to_account_id)) return { ok: false, error: 'akun tujuan tidak dikenal' };
  if (proposal.from_account_id === proposal.to_account_id) return { ok: false, error: 'akun sumber = tujuan' };
  if (proposal.category_account_id && !ids.has(proposal.category_account_id)) {
    return { ok: false, error: 'kategori tidak dikenal' };
  }
  return {
    ok: true,
    tx: {
      p_amount: amt,
      p_from_account_id: proposal.from_account_id,
      p_to_account_id: proposal.to_account_id,
      p_category_account_id: proposal.category_account_id || null,
      p_memo: proposal.memo || null,
      p_date: proposal.date || null,
      p_currency: 'IDR',
      p_fx_rate: 1
    }
  };
}

// Has this statement already been imported? (memo tag like "CIMB-JUN26:%")
export async function tagExists(env, tag) {
  const r = await fetch(
    rest(env, `transactions_active?select=id&memo=ilike.${encodeURIComponent(tag + ':%')}&limit=1`),
    { headers: headers(env, { 'Accept-Profile': env.DB_SCHEMA }) }
  );
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j.length > 0;
}

export async function postTransaction(env, tx) {
  const r = await fetch(rest(env, 'rpc/post_transaction'), {
    method: 'POST',
    headers: headers(env, { 'Content-Profile': env.DB_SCHEMA }),
    body: JSON.stringify(tx)
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`post_transaction ${r.status}: ${body.slice(0, 300)}`);
  // RETURNS uuid -> PostgREST gives the bare value (quoted json string).
  return body.replace(/^"|"$/g, '');
}

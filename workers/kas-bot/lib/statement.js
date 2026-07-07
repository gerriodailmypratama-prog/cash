// Statement pipeline (Fase B). The DOB-locked PDF is unlocked by a scheduled
// GitHub Action (pdf.js can't run in Workers); the Action then drives the
// worker: GET /stmt/next to fetch the next locked PDF, POST /stmt/text with the
// extracted plain text. The worker AI-parses that text into rows, checksums
// against the statement's own total, and DMs the owner a one-tap import.
//
// Money safety: nothing is written until the owner taps ✅; import is idempotent
// via a per-statement memo tag, and re-running is a no-op.
import { aiComplete, extractJson } from './parse.js';
import { accountContext, postTransaction, tagExists } from './ledger.js';
import { sendMessage } from './telegram.js';

const rupiah = (n) => 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');
const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

function bytesToBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

// Serve the next not-yet-handled statement PDF (base64) to the GitHub Action.
export async function nextStatement(env) {
  const listed = await env.STATEMENTS.list({ prefix: 'pdf/', limit: 200 });
  for (const o of listed.objects || []) {
    if (await env.BOT_KV.get(`stmt:${o.key}`)) continue; // pending/done/skipped
    const obj = await env.STATEMENTS.get(o.key);
    if (!obj) continue;
    const b64 = bytesToBase64(new Uint8Array(await obj.arrayBuffer()));
    return new Response(JSON.stringify({ key: o.key, name: o.key.replace(/^pdf\//, ''), pdf_b64: b64 }), {
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ none: true }), { headers: { 'content-type': 'application/json' } });
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function handles(ctx) {
  const list = ctx.accounts.map((a, i) => ({ h: `a${i}`, ...a }));
  return {
    list,
    byHandle: new Map(list.map((a) => [a.h, a])),
    byName: new Map(list.map((a) => [norm(a.name), a])),
    cardLines: list.filter((a) => a.type === 'LIABILITY').map((a) => `${a.h} [${a.pot}] ${a.name}`),
    catLines: list.filter((a) => a.type === 'EXPENSE').map((a) => `${a.h} [${a.pot}] ${a.name}`)
  };
}

// Resolve an AI value to an account by handle first, then by name (small models
// often return the name instead of the handle).
function resolveAcct(v, H) {
  if (!v) return null;
  return H.byHandle.get(String(v).trim()) || H.byName.get(norm(v)) || null;
}

// The card is inferred from the statement text (bank name), not the AI — far
// more reliable. Scores each LIABILITY account by name-word hits in the text.
function detectCard(text, list) {
  const t = text.toLowerCase();
  let best = null, score = 0;
  for (const a of list) {
    if (a.type !== 'LIABILITY') continue;
    const words = a.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    const s = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (s > score) { best = a; score = s; }
  }
  return score > 0 ? best : null;
}

function stmtPrompt({ catLines }) {
  return [
    'Kamu akuntan teliti. Ini TEKS mentah ekstraksi PDF statement kartu kredit (kolom bisa berantakan/kebalik).',
    'Ambil SEMUA baris transaksi TANPA KELEWAT + total tagihannya. Keluarkan JSON.',
    '',
    'KATEGORI PENGELUARAN — untuk tiap belanja/biaya pilih handle paling cocok (balas hand-nya, mis "a30", bukan namanya):',
    ...catLines,
    '',
    'Jenis baris (kind) — PENTING, jangan salah:',
    'Perhatikan akhiran "CR" (credit) di sebuah baris = itu MENGURANGI tagihan (pay atau ref). Tanpa CR = chg.',
    '- "pay" = PEMBAYARAN tagihan: baris "PAYMENT-THANK YOU / PEMBAYARAN" (biasanya "...CR"). cat=null.',
    '- "ref" = REFUND: nama merchant/belanja TAPI ada "CR" (mis. "SHOPEE ... 5,550,000 CR" = refund shopee). Isi cat.',
    '  Catatan: bisa ada 2 baris merchant sama, satu tanpa CR (belanja=chg) dan satu dengan CR (refund=ref).',
    '- "chg" = sisanya: belanja, cicilan, bunga (Interest), biaya (Fee/Late Charge/Bea Meterai/Handling/Admin). WAJIB isi cat.',
    'Angka selalu positif (arah ditentukan kind). Jangan jadikan pay/ref sebagai chg.',
    'Baris "LAST BALANCE" = opening (jangan masukkan ke rows). "ENDING BALANCE"/"Tagihan Baru" = stated_outstanding.',
    'Abaikan baris ringkasan/poin/promo/SUBTOTAL. Ambil hanya baris transaksi bertanggal.',
    '',
    '"opening" = saldo statement bulan lalu (previous/last balance). "stated_outstanding" = Tagihan Baru / total sekarang.',
    'Cek: opening + jumlah(chg) - jumlah(pay) - jumlah(ref) HARUS = stated_outstanding. Kalau meleset, kamu ada yang kelewat/salah kind — perbaiki.',
    '',
    'Balas HANYA JSON valid tanpa markdown:',
    '{"period":"<Mon-YYYY>","opening":<angka>,"stated_outstanding":<angka>,',
    '"rows":[{"date":"YYYY-MM-DD","kind":"chg|pay|ref","cat":"<handle|null>","amount":<angka bulat positif>,"memo":"<ket singkat>"}]}'
  ].join('\n');
}

// e.g. "CIMB Niaga All" + "Jun-2026" -> "CIMB-JUN26"
function makeTag(cardName, period) {
  const bank = cardName.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = String(period || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const mon = m.slice(0, 3), yr = (m.match(/(\d{2})$/) || [])[1] || '';
  return `${bank}-${mon}${yr}`.slice(0, 24);
}

// Parse statement text -> validated batch (rows resolved to account ids) + checksum.
export async function ingestStatementText(env, { key, text }, dry = false) {
  if (!key || !text) return new Response(JSON.stringify({ error: 'need key+text' }), { status: 400 });
  const ctx = await accountContext(env);
  const H = handles(ctx);

  // Card comes from the statement text (reliable), not the AI.
  const card = detectCard(text, H.list);
  if (!card) {
    return new Response(JSON.stringify({ error: 'bank/card not detected in statement text' }), { status: 200 });
  }

  let parsed, provider;
  try {
    const r = await aiComplete(env, { system: stmtPrompt(H), user: text.slice(0, 40000), maxTokens: 6144 });
    provider = r.provider;
    parsed = extractJson(r.text);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'parse failed: ' + (e?.message || e) }), { status: 200 });
  }
  const equity = ctx.accounts.find((a) => a.pot === card.pot && a.code === '3000');
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];

  // Build resolved transactions + checksum against the statement's own total.
  const tag = makeTag(card.name, parsed.period);
  const opening = num(parsed.opening);
  let chg = 0, pay = 0, ref = 0;
  const txs = [];
  for (const r of rows) {
    const amt = num(r.amount);
    if (!(amt > 0)) continue;
    const cat = resolveAcct(r.cat, H);
    let from, to;
    if (r.kind === 'pay') { from = equity?.id; to = card.id; pay += amt; }
    else if (r.kind === 'ref') { from = cat?.id; to = card.id; ref += amt; }
    else { from = card.id; to = cat?.id; chg += amt; } // chg default
    if (!from || !to) continue;
    txs.push({ p_amount: amt, p_from_account_id: from, p_to_account_id: to, p_memo: `${tag}: ${(r.memo || '').slice(0, 80)}`, p_date: r.date || null, p_currency: 'IDR', p_fx_rate: 1 });
  }
  if (opening > 0 && equity) {
    txs.unshift({ p_amount: opening, p_from_account_id: card.id, p_to_account_id: equity.id, p_memo: `${tag}: saldo awal`, p_date: null, p_currency: 'IDR', p_fx_rate: 1 });
  }

  const computed = opening + chg - pay - ref;
  const stated = num(parsed.stated_outstanding);
  const diff = Math.round(computed - stated);
  const match = Math.abs(diff) < 1000; // tolerate rounding

  if (dry) {
    return new Response(JSON.stringify({
      dry: true, provider, card: card.name, period: parsed.period, tag, rows: txs.length,
      opening, chg, pay, ref, computed, stated, diff, match,
      sampleRows: txs.map((t) => ({ amt: t.p_amount, memo: t.p_memo }))
    }, null, 2), { headers: { 'content-type': 'application/json' } });
  }

  // Idempotency: if this statement's tag is already in the ledger, don't re-propose.
  if (await tagExists(env, tag)) {
    await env.BOT_KV.put(`stmt:${key}`, 'done', { expirationTtl: 90 * 24 * 3600 });
    return new Response(JSON.stringify({ ok: true, skipped: 'already imported', tag }), { headers: { 'content-type': 'application/json' } });
  }

  const id = crypto.randomUUID().slice(0, 8);
  await env.BOT_KV.put(`stmtpend:${id}`, JSON.stringify({ key, tag, txs, card: card.name }), { expirationTtl: 7 * 24 * 3600 });
  await env.BOT_KV.put(`stmt:${key}`, 'pending', { expirationTtl: 30 * 24 * 3600 });

  const chatIds = (env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const msg = [
    `📄 <b>Statement ${card.name}</b> — ${parsed.period || ''}`,
    `${txs.length} transaksi`,
    `💳 Tagihan (statement): <b>${rupiah(stated)}</b>`,
    match ? '✅ <i>Checksum cocok.</i>' : `⚠️ <i>Checksum beda ${rupiah(Math.abs(diff))} (hitungan ${rupiah(computed)}). Cek dulu.</i>`,
    '',
    'Import semua ke ledger?'
  ].join('\n');
  const kb = { reply_markup: { inline_keyboard: [[{ text: '✅ Ya, import', callback_data: `sok:${id}` }, { text: '❌ Skip', callback_data: `sno:${id}` }]] } };
  for (const cid of chatIds) await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, msg, kb);

  return new Response(JSON.stringify({ ok: true, rows: txs.length, match, computed, stated }), { headers: { 'content-type': 'application/json' } });
}

// Import a confirmed batch. Idempotent: skips if the tag is already in the ledger.
export async function importStatement(env, batch) {
  if (await tagExists(env, batch.tag)) {
    return { msg: `ℹ️ <b>${batch.card}</b>: sudah pernah diimport (${batch.tag}). Dilewati.`, ok: 0, fail: 0 };
  }
  let ok = 0, fail = 0;
  for (const tx of batch.txs) {
    try { await postTransaction(env, tx); ok++; }
    catch (e) { console.log('stmt import row failed: ' + (e?.message || e)); fail++; }
  }
  const msg = fail
    ? `⚠️ <b>${batch.card}</b>: ${ok} masuk, ${fail} gagal. Cek kas.gerriolab.com.`
    : `✅ <b>${batch.card}</b>: ${ok} transaksi masuk ledger.\nCek di kas.gerriolab.com`;
  return { msg, ok, fail };
}

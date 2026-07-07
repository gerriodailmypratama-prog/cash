// Kas capture bot (PR-CL26, Fase A).
//
// Telegram webhook -> LLM parse (text or receipt photo) -> owner confirms with a
// tap -> cash.post_transaction. Money only ever moves after an explicit "Ya".
// A 15-min cron also scans R2 and pings the owner when a new bank statement
// lands (full auto-import of statements is Fase B).
//
// Security posture:
// - Webhook authenticated by a secret header (Telegram's secret_token).
// - Only allow-listed chat ids (owner + spouse) are answered; others ignored.
// - Service key lives only in worker secrets; every write is confirm-gated.

import { sendMessage, setWebhook, confirmKeyboard, answerCallback, editReplyMarkup, getFileBytes } from './lib/telegram.js';
import { accountContext, buildTx, postTransaction } from './lib/ledger.js';
import { parseInput } from './lib/parse.js';
import { nextStatement, ingestStatementText, importStatement } from './lib/statement.js';

const rupiah = (n) => 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');
const today = () => new Date().toISOString().slice(0, 10);

function allowed(env, chatId) {
  const list = (env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(String(chatId));
}

function nameOf(ctx, id) {
  const a = ctx.accounts.find((x) => x.id === id);
  return a ? `${a.name} <i>(${a.pot})</i>` : '?';
}

function renderProposal(tx, ctx, proposal) {
  const warn = proposal.confidence < 0.6 ? '\n⚠️ <i>Kurang yakin — cek dulu ya.</i>' : '';
  return [
    '🧾 <b>Cek dulu ya:</b>',
    `💸 <b>${rupiah(tx.p_amount)}</b>`,
    `↗️ Dari: ${nameOf(ctx, tx.p_from_account_id)}`,
    `↘️ Ke: ${nameOf(ctx, tx.p_to_account_id)}`,
    `📝 ${proposal.memo || '-'}`,
    `📅 ${tx.p_date || 'hari ini'}`,
    proposal.note ? `\n💡 <i>${proposal.note}</i>` : '',
    warn
  ].filter(Boolean).join('\n');
}

const HELP = [
  '👋 <b>Kas bot</b> — pencatat cepat.',
  '',
  'Cara pakai:',
  '• Ketik aja, misal: <code>makan siang 45rb pake cimb</code>',
  '• Atau kirim <b>foto struk</b> — nanti gua bacain.',
  '',
  'Gua bakal tunjukin hasilnya dulu, baru lo tap <b>✅ Ya</b> buat simpan.',
  'Salah? Tap <b>✏️ Koreksi</b> terus ketik betulannya.'
].join('\n');

// ---- capture: run parse, validate, stash pending, show confirm ----
async function handleCapture(env, chatId, { text, imageBytes, srcText }) {
  const ctx = await accountContext(env);
  let proposal;
  try {
    proposal = await parseInput(env, { text, imageBytes }, ctx, today());
  } catch (e) {
    console.log('parse error: ' + e.message);
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '😵 Gagal baca. Coba ketik ulang lebih jelas ya.');
  }
  const built = buildTx(proposal, ctx);
  if (!built.ok) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `😕 Belum bisa dipetakan (${built.error}). Sebut kartunya / kategorinya ya.`);
  }
  const id = crypto.randomUUID().slice(0, 8);
  await env.BOT_KV.put(
    `pend:${id}`,
    JSON.stringify({ tx: built.tx, srcText: srcText || text || proposal.memo, chatId }),
    { expirationTtl: 3600 }
  );
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, renderProposal(built.tx, ctx, proposal), confirmKeyboard(id));
}

async function handleCallback(env, cb) {
  const chatId = cb.message?.chat?.id;
  const [action, id] = (cb.data || '').split(':');
  const token = env.TELEGRAM_BOT_TOKEN;

  // Statement batch import (Fase B): sok = import all, sno = skip.
  if (action === 'sok' || action === 'sno') {
    const batch = id && (await env.BOT_KV.get(`stmtpend:${id}`, 'json'));
    if (!batch) { await answerCallback(token, cb.id, 'Sudah kadaluarsa / diproses.'); return; }
    await editReplyMarkup(token, chatId, cb.message.message_id);
    if (action === 'sno') {
      await env.BOT_KV.put(`stmt:${batch.key}`, 'skipped');
      await env.BOT_KV.delete(`stmtpend:${id}`);
      await answerCallback(token, cb.id, 'Dilewati');
      await sendMessage(token, chatId, '❌ Statement dilewati.');
      return;
    }
    await answerCallback(token, cb.id, 'Mengimpor...');
    const res = await importStatement(env, batch);
    await env.BOT_KV.put(`stmt:${batch.key}`, 'done');
    await env.BOT_KV.delete(`stmtpend:${id}`);
    await sendMessage(token, chatId, res.msg);
    return;
  }

  const raw = id && (await env.BOT_KV.get(`pend:${id}`, 'json'));
  if (!raw) {
    await answerCallback(token, cb.id, 'Sudah kadaluarsa / diproses.');
    return;
  }

  if (action === 'no') {
    await env.BOT_KV.delete(`pend:${id}`);
    await editReplyMarkup(token, chatId, cb.message.message_id);
    await answerCallback(token, cb.id, 'Dibatalkan');
    await sendMessage(token, chatId, '❌ Oke, dibatalkan.');
    return;
  }

  if (action === 'fix') {
    await env.BOT_KV.put(`fixwait:${chatId}`, id, { expirationTtl: 600 });
    await answerCallback(token, cb.id, 'Ketik betulannya');
    await sendMessage(token, chatId, '✏️ Ketik betulannya (misal: <i>kategorinya belanja online, kartunya BCA</i>).');
    return;
  }

  if (action === 'ok') {
    try {
      const txId = await postTransaction(env, raw.tx);
      await env.BOT_KV.delete(`pend:${id}`);
      await editReplyMarkup(token, chatId, cb.message.message_id);
      await answerCallback(token, cb.id, 'Tersimpan ✅');
      await sendMessage(token, chatId, `✅ <b>Tersimpan.</b> <code>${txId.slice(0, 8)}</code>\nCek di kas.gerriolab.com`);
    } catch (e) {
      console.log('post error: ' + e.message);
      await answerCallback(token, cb.id, 'Gagal simpan');
      await sendMessage(token, chatId, '⚠️ Gagal simpan ke ledger. Coba lagi bentar.');
    }
  }
}

async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const token = env.TELEGRAM_BOT_TOKEN;
  const text = (msg.text || msg.caption || '').trim();

  if (/^\/(start|help)\b/.test(text)) {
    return sendMessage(token, chatId, HELP);
  }

  // Photo capture (largest size = last entry).
  if (msg.photo?.length) {
    await sendMessage(token, chatId, '⏳ Lagi baca struknya...');
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const imageBytes = await getFileBytes(token, fileId);
    if (!imageBytes) return sendMessage(token, chatId, '😵 Gagal ambil fotonya. Coba kirim ulang.');
    return handleCapture(env, chatId, { text, imageBytes, srcText: text || 'foto struk' });
  }

  if (!text) return;

  // Correction continuation after tapping ✏️ Koreksi.
  const fixId = await env.BOT_KV.get(`fixwait:${chatId}`);
  if (fixId) {
    const prev = await env.BOT_KV.get(`pend:${fixId}`, 'json');
    await env.BOT_KV.delete(`fixwait:${chatId}`);
    const base = prev?.srcText ? `${prev.srcText}` : '';
    return handleCapture(env, chatId, { text: `${base}. Koreksi dari user: ${text}`, srcText: `${base}. ${text}` });
  }

  return handleCapture(env, chatId, { text });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // One-time self-registration: point Telegram at this worker. Gated by the
    // webhook secret so only the owner can trigger it. This is how the owner
    // finishes setup without running curl or handing the bot token to anyone.
    if (request.method === 'GET' && url.pathname === '/setup') {
      if (url.searchParams.get('secret') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const res = await setWebhook(env.TELEGRAM_BOT_TOKEN, env.WORKER_URL, env.TELEGRAM_WEBHOOK_SECRET);
      return new Response(res.ok ? '✅ Webhook terpasang. Bot siap — coba /start di Telegram.' : `Gagal: ${JSON.stringify(res)}`,
        { status: res.ok ? 200 : 500 });
    }

    // Statement pipeline (Fase B). A scheduled GitHub Action unlocks the
    // DOB-locked PDF (pdf.js can't run in Workers) and drives these two
    // endpoints; both are gated by the webhook secret.
    if (url.pathname === '/stmt/next' && request.method === 'GET') {
      if (url.searchParams.get('secret') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      return nextStatement(env);
    }
    if (url.pathname === '/stmt/text' && request.method === 'POST') {
      if (url.searchParams.get('secret') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      let body;
      try { body = await request.json(); } catch { return new Response('bad', { status: 400 }); }
      return ingestStatementText(env, body, url.searchParams.get('dry') === '1');
    }

    if (request.method !== 'POST') return new Response('kas-bot', { status: 200 });
    if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    let update;
    try { update = await request.json(); } catch { return new Response('bad', { status: 400 }); }

    // Dedup Telegram retries.
    if (update.update_id != null) {
      const k = `upd:${update.update_id}`;
      if (await env.BOT_KV.get(k)) return new Response('ok');
      await env.BOT_KV.put(k, '1', { expirationTtl: 3600 });
    }

    const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    if (!allowed(env, chatId)) return new Response('ok'); // silently ignore strangers

    try {
      if (update.callback_query) await handleCallback(env, update.callback_query);
      else if (update.message) await handleMessage(env, update.message);
    } catch (e) {
      console.log('handler error: ' + (e?.message || e));
    }
    return new Response('ok');
  },

  // Cron: keep the Telegram webhook pointed at us (self-heal). Statement
  // notifications are now driven by the GitHub Action -> /stmt/text flow.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (env.TELEGRAM_BOT_TOKEN && env.WORKER_URL && !(await env.BOT_KV.get('wh_set'))) {
        const res = await setWebhook(env.TELEGRAM_BOT_TOKEN, env.WORKER_URL, env.TELEGRAM_WEBHOOK_SECRET);
        if (res.ok) await env.BOT_KV.put('wh_set', '1');
      }
    })());
  }
};

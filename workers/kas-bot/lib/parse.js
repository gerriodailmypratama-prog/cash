// Parse engine. Turns a free-text note ("makan 50rb pake cimb") or a receipt
// photo into a structured transaction proposal.
//
// Provider is chosen automatically:
//   - GEMINI_API_KEY set  -> Google Gemini (stronger receipt vision), still free tier.
//   - otherwise           -> Cloudflare Workers AI (free, no key) as the fallback.
//
// Small models copy UUIDs unreliably, so accounts are presented with short
// handles (a0, a1, ...) and the model returns handles; the worker resolves them
// back to real ids and validates. The owner confirms every proposal, so an
// occasional miss is caught before anything is written.

function buildHandles(ctx) {
  const list = ctx.accounts.map((a, i) => ({ h: `a${i}`, ...a }));
  const byHandle = new Map(list.map((a) => [a.h, a.id]));
  const lines = list.map((a) => `${a.h}  [${a.pot}] ${a.name} (${a.type}${a.subtype ? '/' + a.subtype : ''})`);
  return { byHandle, lines };
}

function prompt(lines, today) {
  return [
    'Kamu asisten pencatat keuangan "Kas" (Bahasa Indonesia).',
    'Dari catatan/foto struk, hasilkan SATU transaksi.',
    '',
    'Aturan from -> to:',
    '- Pengeluaran: from = akun sumber bayar (kartu/cash/bank), to = kategori EXPENSE paling cocok.',
    '- Pemasukan: from = akun INCOME/EQUITY, to = bank/cash.',
    '- Transfer / bayar kartu: from = sumber, to = kartu/bank tujuan.',
    '- Kalau pot tak jelas, default pot "Pribadi".',
    `- Tanggal hari ini: ${today}.`,
    '',
    'DAFTAR AKUN (handle  [pot] nama (type)):',
    ...lines,
    '',
    'Balas HANYA JSON valid (tanpa teks lain, tanpa markdown), bentuk:',
    '{"amount":<angka rupiah bulat>,"from":"<handle>","to":"<handle>","category":null,"memo":"<singkat>","date":null,"confidence":<0..1>,"note":"<alasan singkat 1 kalimat>"}'
  ].join('\n');
}

// Workers AI shapes vary: some return { response: "text" }, the OpenAI-compatible
// ones return { choices: [{ message: { content } }] }.
function aiText(res) {
  if (typeof res?.response === 'string') return res.response;
  if (res?.choices?.[0]?.message?.content) return res.choices[0].message.content;
  if (typeof res === 'string') return res;
  return '';
}

function extractJson(text) {
  if (!text) throw new Error('empty AI response');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json: ' + text.slice(0, 200));
  return JSON.parse(m[0]);
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function resolve(out, byHandle) {
  const pick = (v) => byHandle.get(norm(v)) || null;
  return {
    amount: Number(String(out.amount).replace(/[^0-9.]/g, '')),
    from_account_id: pick(out.from),
    to_account_id: pick(out.to),
    category_account_id: out.category ? pick(out.category) : null,
    memo: out.memo || '',
    date: out.date || null,
    confidence: Number(out.confidence ?? 0.5),
    note: out.note || ''
  };
}

async function viaGemini(env, sys, text, imageBytes) {
  const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
  const parts = [{ text: `${sys}${text ? '\n\nCatatan/perintah: ' + text : ''}${imageBytes ? '\n\nBaca struk pada gambar.' : ''}` }];
  if (imageBytes) parts.push({ inline_data: { mime_type: 'image/jpeg', data: bytesToBase64(imageBytes) } });
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { response_mime_type: 'application/json', temperature: 0 } })
    }
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function viaWorkersAI(env, sys, text, imageBytes) {
  if (imageBytes) {
    const res = await env.AI.run(env.VISION_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct', {
      image: imageBytes,
      prompt: `${sys}\n\nBaca struk pada gambar.${text ? ' Catatan: ' + text : ''}`,
      max_tokens: 512
    });
    return aiText(res);
  }
  const res = await env.AI.run(env.TEXT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [{ role: 'system', content: sys }, { role: 'user', content: text }],
    max_tokens: 512
  });
  return aiText(res);
}

export async function parseInput(env, { text, imageBytes }, ctx, today) {
  const { byHandle, lines } = buildHandles(ctx);
  const sys = prompt(lines, today);
  const raw = env.GEMINI_API_KEY
    ? await viaGemini(env, sys, text, imageBytes)
    : await viaWorkersAI(env, sys, text, imageBytes);
  return resolve(extractJson(raw), byHandle);
}

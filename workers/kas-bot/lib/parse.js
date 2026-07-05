// Parse engine on Cloudflare Workers AI (free tier, no external key). Turns a
// free-text note ("makan 50rb pake cimb") or a receipt photo into a structured
// transaction proposal.
//
// Small models copy UUIDs unreliably, so accounts are presented with short
// handles (a0, a1, ...) and the model returns handles; the worker resolves them
// back to real ids and validates. The owner still confirms every proposal, so
// an occasional miss is caught before anything is written.

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

// Workers AI shapes vary by model: some return { response: "text" }, the
// OpenAI-compatible ones return { choices: [{ message: { content } }] }.
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

export async function parseInput(env, { text, imageBytes }, ctx, today) {
  const { byHandle, lines } = buildHandles(ctx);
  const sys = prompt(lines, today);
  let out;

  if (imageBytes) {
    const res = await env.AI.run(env.VISION_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct', {
      image: imageBytes,
      prompt: `${sys}\n\nBaca struk pada gambar.${text ? ' Catatan: ' + text : ''}`,
      max_tokens: 512
    });
    out = extractJson(aiText(res));
  } else {
    const res = await env.AI.run(env.TEXT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text }
      ],
      max_tokens: 512
    });
    out = extractJson(aiText(res));
  }
  return resolve(out, byHandle);
}

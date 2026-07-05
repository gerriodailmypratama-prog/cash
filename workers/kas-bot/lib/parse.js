// Claude parse engine. Turns a free-text note ("makan 50rb pake cimb") or a
// receipt photo into a structured transaction proposal, choosing real account
// ids from the account context. Forced tool-use guarantees valid JSON out.

const TOOL = {
  name: 'propose_transaction',
  description: 'Ajukan satu transaksi untuk dicatat ke ledger Kas.',
  input_schema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Nominal dalam Rupiah (angka bulat, tanpa titik/koma).' },
      from_account_id: { type: 'string', description: 'id akun SUMBER dana (kartu/cash/bank untuk pengeluaran; akun income/equity untuk pemasukan).' },
      to_account_id: { type: 'string', description: 'id akun TUJUAN (kategori EXPENSE untuk pengeluaran; bank/cash untuk pemasukan/transfer).' },
      category_account_id: { type: ['string', 'null'], description: 'opsional, biarkan null.' },
      memo: { type: 'string', description: 'Keterangan singkat (nama merchant/barang).' },
      date: { type: ['string', 'null'], description: 'YYYY-MM-DD kalau tersebut, kalau tidak null (default hari ini).' },
      confidence: { type: 'number', description: '0..1, seberapa yakin.' },
      note: { type: 'string', description: 'Alasan singkat pemetaan akun (untuk ditunjukkan ke user, 1 kalimat).' }
    },
    required: ['amount', 'from_account_id', 'to_account_id', 'memo', 'confidence', 'note']
  }
};

function systemPrompt(ctx, today) {
  const lines = ctx.accounts.map((a) => `${a.id}  [${a.pot}] ${a.name} (${a.type}${a.subtype ? '/' + a.subtype : ''})`);
  return [
    'Kamu asisten pencatat keuangan "Kas" milik Gerrio (Bahasa Indonesia santai).',
    'Tugasmu: dari catatan/foto struk, ajukan SATU transaksi lewat tool propose_transaction.',
    '',
    'Aturan pemetaan from -> to:',
    '- Pengeluaran (beli/bayar sesuatu): from = akun sumber bayar (kartu kredit / cash / bank), to = kategori EXPENSE yang paling cocok.',
    '- Pemasukan: from = akun INCOME/EQUITY, to = bank/cash tujuan.',
    '- Transfer / bayar tagihan kartu: from = sumber, to = kartu/bank tujuan.',
    '- WAJIB pilih id PERSIS dari daftar akun di bawah. Jangan mengarang id.',
    '- Kalau pot tidak jelas, default ke pot "Pribadi".',
    '- Kalau nominal/akun tidak yakin, tetap ajukan tebakan terbaik tapi turunkan confidence.',
    `- Tanggal hari ini: ${today}.`,
    '',
    'DAFTAR AKUN (id  [pot] nama (type)):',
    ...lines
  ].join('\n');
}

export async function parseInput(env, { text, image }, ctx, today) {
  const content = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } });
    content.push({ type: 'text', text: text ? `Catatan: ${text}` : 'Ini foto struk. Catat transaksinya.' });
  } else {
    content.push({ type: 'text', text });
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.MODEL || 'claude-sonnet-5',
      max_tokens: 1024,
      system: systemPrompt(ctx, today),
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'propose_transaction' },
      messages: [{ role: 'user', content }]
    })
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`claude ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const use = (j.content || []).find((c) => c.type === 'tool_use');
  if (!use) throw new Error('claude: no tool_use in response');
  return use.input;
}

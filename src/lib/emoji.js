// Emoji per account/kategori (PR-CL21). Name-keyword rules first, then a
// type fallback — codes stay system-only, the UI speaks emoji + nama.
const RULES = [
  [/belanja online/i, '🛒'],
  [/langganan|digital/i, '📱'],
  [/makan/i, '🍜'],
  [/kebutuhan/i, '🧺'],
  [/transport/i, '🚗'],
  [/hiburan|jajan/i, '🎮'],
  [/biaya.*(kartu|bunga)|bunga/i, '💸'],
  [/sewa rumah/i, '🏠'],
  [/listrik/i, '⚡'],
  [/\bair\b/i, '💧'],
  [/wifi|internet/i, '📶'],
  [/gaji art/i, '🧹'],
  [/kesehatan/i, '🩺'],
  [/cash & bank|rdn/i, '🏦'],
  [/e-wallet|marketplace balance/i, '👛'],
  [/receivable|piutang/i, '🧾'],
  [/inventory|stok/i, '📦'],
  [/equity|modal/i, '🏛️'],
  [/sales|penjualan/i, '🛍️'],
  [/drawing|dividen|gain|pemasukan|income/i, '💰'],
  [/cogs/i, '🏭'],
  [/shipping/i, '🚚'],
  [/marketplace|platform/i, '🏬'],
  [/marketing|ads/i, '📣'],
  [/salaries|wages|gaji/i, '👥'],
  [/ruko|utilities/i, '🏢'],
  [/equipment|supplies/i, '🧰'],
  [/portofolio|saham/i, '📈'],
  [/fee broker|realized loss/i, '📉'],
  [/lain/i, '🗂️']
];

const TYPE_FALLBACK = {
  EXPENSE: '💸',
  INCOME: '💰',
  LIABILITY: '💳',
  ASSET: '🏦',
  EQUITY: '🏛️'
};

/** Accepts an account row ({name, type, subtype}) or a bare name string. */
export function emojiFor(a) {
  const name = typeof a === 'string' ? a : a?.name || '';
  for (const [re, e] of RULES) {
    if (re.test(name)) return e;
  }
  const type = typeof a === 'object' ? a?.type : null;
  return TYPE_FALLBACK[type] || '🔹';
}

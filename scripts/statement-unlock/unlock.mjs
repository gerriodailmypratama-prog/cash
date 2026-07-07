// Kas statement unlocker — runs on a schedule in GitHub Actions (Node, where
// pdf.js works; it can't run inside a Cloudflare Worker). Pulls the next locked
// statement PDF from the bot worker, brute-forces the DOB password, extracts the
// text, and posts it back so the worker can AI-parse + propose the import.
//
// Env:
//   WORKER_URL      https://kas-bot.<sub>.workers.dev
//   WEBHOOK_SECRET  same secret the worker uses to gate /stmt/*
//   DOB_JSON        {"gerrio":{"d":4,"m":3,"y":1995}, ...}
//   DRY=1           (optional) print unlocked text sample + hit /stmt/text?dry=1
import { PDFParse } from 'pdf-parse';

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function dobCandidates(dobJson) {
  const out = new Set();
  let people;
  try { people = Object.values(JSON.parse(dobJson || '{}')); } catch { people = []; }
  for (const { d, m, y } of people) {
    const dd = String(d).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const yyyy = String(y);
    const yy = yyyy.slice(-2);
    const mon = MON[m - 1] || '';
    for (const p of [
      dd + mm + yy, dd + mm + yyyy, yyyy + mm + dd, yy + mm + dd,
      dd + mon + yyyy, dd + mon.toUpperCase() + yyyy, dd + mon + yy, String(d) + mm + yy
    ]) out.add(p);
  }
  return [...out];
}

async function unlock(buffer, passwords) {
  for (const password of ['', ...passwords]) {
    try {
      const parser = new PDFParse({ data: buffer, password });
      const res = await parser.getText();
      await parser.destroy?.();
      if (res?.text) return { password, text: res.text };
    } catch (e) {
      if (/password/i.test(e?.message || '') || e?.name === 'PasswordException') continue;
      throw e;
    }
  }
  throw new Error('unlock failed — no DOB candidate matched');
}

const WORKER = process.env.WORKER_URL?.replace(/\/$/, '');
const SECRET = process.env.WEBHOOK_SECRET;
const DOB = process.env.DOB_JSON;
const DRY = process.env.DRY === '1';
if (!WORKER || !SECRET) { console.error('missing WORKER_URL / WEBHOOK_SECRET'); process.exit(1); }

const pw = dobCandidates(DOB);
console.log(`DOB candidates: ${pw.length}`);

for (let i = 0; i < 20; i++) {
  const next = await fetch(`${WORKER}/stmt/next?secret=${SECRET}`).then((r) => r.json());
  if (next.none) { console.log('no pending statements.'); break; }
  console.log(`\n[${i}] unlocking ${next.name}`);
  const buf = Buffer.from(next.pdf_b64, 'base64');
  let text;
  try {
    ({ text } = await unlock(buf, pw));
  } catch (e) {
    console.error('  unlock FAILED:', e.message);
    // In DRY we stop; in prod we skip so one bad pdf doesn't wedge the queue.
    if (DRY) process.exit(1);
    continue;
  }
  console.log(`  unlocked, ${text.length} chars`);
  if (DRY) {
    console.log('  --- sample ---\n' + text.slice(0, 600).replace(/\n{2,}/g, '\n'));
    const res = await fetch(`${WORKER}/stmt/text?secret=${SECRET}&dry=1`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: next.key, text })
    }).then((r) => r.json());
    console.log('  --- worker dry parse ---\n' + JSON.stringify(res, null, 2));
    break; // DRY: one statement only, no state change
  }
  const res = await fetch(`${WORKER}/stmt/text?secret=${SECRET}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: next.key, text })
  }).then((r) => r.json());
  console.log('  worker:', JSON.stringify(res));
}
console.log('done.');

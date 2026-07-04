// Kas email ingest (PR-CL22).
// Catches mail sent to statements@gerriolab.com via Cloudflare Email Routing,
// stores the raw message + any PDF attachments into the R2 bucket. Parsing/
// import into the ledger happens downstream (agent session / future parser) —
// this worker only captures, so it needs NO database credentials.
import PostalMime from 'postal-mime';

// Only mail forwarded from the owner's mailboxes is stored; everything else
// (spam straight to the public address) is dropped.
const ALLOWED_FORWARDERS = [
  'gerriodailmypratama@gmail.com',
  'gerriomail@gmail.com',
  'steffieerzamia@gmail.com',
  // Gmail's forwarding-confirmation sender (needed once per Gmail filter setup)
  'mail-noreply@google.com',
  'forwarding-noreply@google.com'
];

function safe(s, fallback) {
  return (s || fallback).replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 120);
}

export default {
  async email(message, env, ctx) {
    const from = (message.from || '').toLowerCase();
    const ok = ALLOWED_FORWARDERS.some((a) => from.includes(a));
    if (!ok) {
      message.setReject('address not accepting mail from this sender');
      return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const raw = await new Response(message.raw).arrayBuffer();
    await env.STATEMENTS.put(`raw/${ts}_${safe(from, 'unknown')}.eml`, raw, {
      customMetadata: { from, subject: message.headers.get('subject') || '' }
    });

    const parsed = await PostalMime.parse(raw);
    let pdfs = 0;
    for (const att of parsed.attachments || []) {
      const isPdf = /pdf/i.test(att.mimeType || '') || /\.pdf$/i.test(att.filename || '');
      if (!isPdf) continue;
      pdfs++;
      await env.STATEMENTS.put(
        `pdf/${ts}_${safe(att.filename, 'statement.pdf')}`,
        att.content,
        { customMetadata: { from, subject: parsed.subject || '' } }
      );
    }
    console.log(`ingested from=${from} subject="${parsed.subject}" pdfs=${pdfs}`);
  }
};

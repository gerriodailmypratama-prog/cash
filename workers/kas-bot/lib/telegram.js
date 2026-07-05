// Thin wrapper over the Telegram Bot API (plain fetch — no deps, worker-safe).

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
const FILE = (token, path) => `https://api.telegram.org/file/bot${token}/${path}`;

async function call(token, method, body) {
  const r = await fetch(API(token, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.log(`tg ${method} failed: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

export function sendMessage(token, chatId, text, extra = {}) {
  return call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  });
}

// Inline keyboard for the confirm step. `data` values are short (<64 bytes).
export function confirmKeyboard(pendingId) {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Ya, simpan', callback_data: `ok:${pendingId}` },
        { text: '✏️ Koreksi', callback_data: `fix:${pendingId}` },
        { text: '❌ Batal', callback_data: `no:${pendingId}` }
      ]]
    }
  };
}

export function answerCallback(token, callbackId, text = '') {
  return call(token, 'answerCallbackQuery', { callback_query_id: callbackId, text });
}

// Replace the buttons on an already-sent message (so it can't be tapped twice).
export function editReplyMarkup(token, chatId, messageId, replyMarkup = { inline_keyboard: [] }) {
  return call(token, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup
  });
}

// Download a Telegram photo/file as base64 (for Claude vision). Telegram is a
// 2-step fetch: getFile -> file_path, then download from the file endpoint.
export async function getFileBase64(token, fileId) {
  const meta = await call(token, 'getFile', { file_id: fileId });
  const path = meta?.result?.file_path;
  if (!path) return null;
  const r = await fetch(FILE(token, path));
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const mime = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
  return { base64: btoa(bin), mime };
}

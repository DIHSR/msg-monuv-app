// POST monuv/meta-webhook — valida X-Hub-Signature-256
//
// A assinatura é HMAC-SHA256 do CORPO BRUTO (bytes exatos) com o App Secret.
// NÃO use JSON.stringify(body): a Meta escapa acentos como é e o hash não bate.
// Requer: opção "Raw Body" ligada no Webhook node + NODE_FUNCTION_ALLOW_BUILTIN=crypto.
const crypto = require('crypto');
const item = $input.first();
const headers = item.json.headers || {};
const header = String(headers['x-hub-signature-256'] || '');

let raw = null;
let reason = null;
try {
  raw = await helpers.getBinaryDataBuffer(0, 'data');
} catch (_) {
  reason = 'raw_body_missing';
}

let valid = false;
if (!ENV.APP_SECRET) {
  reason = 'app_secret_missing';
} else if (!header.startsWith('sha256=')) {
  reason = reason || 'signature_header_missing';
} else if (raw) {
  const expected = Buffer.from(crypto.createHmac('sha256', ENV.APP_SECRET).update(raw).digest('hex'), 'utf8');
  const received = Buffer.from(header.slice('sha256='.length), 'utf8');
  valid = expected.length === received.length && crypto.timingSafeEqual(expected, received);
  if (!valid) reason = 'signature_mismatch';
}

// O payload só é aproveitado quando a assinatura confere — e sempre a partir dos MESMOS bytes assinados.
let payload = null;
if (valid) {
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (_) {
    valid = false;
    reason = 'invalid_json';
  }
}

return [
  {
    json: {
      status: valid ? 200 : 401,
      body: valid ? 'EVENT_RECEIVED' : 'Invalid signature',
      valid,
      reason,
      payload,
      raw_size: raw ? raw.length : null,
      raw_sha256: raw ? crypto.createHash('sha256').update(raw).digest('hex') : null,
    },
  },
];

// GET monuv/meta-webhook — handshake de verificação da Meta
// Responde hub.challenge (texto puro) se hub.verify_token conferir.
const req = $input.first().json;
const q = req.query || {};
const mode = q['hub.mode'] ?? (q.hub && q.hub.mode);
const token = q['hub.verify_token'] ?? (q.hub && q.hub.verify_token);
const challenge = q['hub.challenge'] ?? (q.hub && q.hub.challenge);

/** Comparação em tempo constante (via hash, para tamanhos diferentes). */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const crypto = require('crypto');
  const h = (v) => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

if (mode === 'subscribe' && sameSecret(token, ENV.VERIFY_TOKEN)) {
  return [{ json: { status: 200, body: String(challenge ?? '') } }];
}
return [{ json: { status: 403, body: 'Forbidden' } }];

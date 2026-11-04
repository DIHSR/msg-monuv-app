// GET monuv/meta-webhook — handshake de verificação da Meta
// Responde hub.challenge (texto puro) se hub.verify_token conferir.
const req = $input.first().json;
const q = req.query || {};
const mode = q['hub.mode'] ?? (q.hub && q.hub.mode);
const token = q['hub.verify_token'] ?? (q.hub && q.hub.verify_token);
const challenge = q['hub.challenge'] ?? (q.hub && q.hub.challenge);

if (mode === 'subscribe' && ENV.VERIFY_TOKEN && token === ENV.VERIFY_TOKEN) {
  return [{ json: { status: 200, body: String(challenge ?? '') } }];
}
return [{ json: { status: 403, body: 'Forbidden' } }];

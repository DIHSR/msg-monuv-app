// ============================================================================
// monuv lib — gerado por n8n/build.mjs a partir de n8n/src/_lib.js.
// NÃO edite no n8n: edite no repositório e reimporte o workflow.
// Requer no n8n: N8N_BLOCK_ENV_ACCESS_IN_NODE=false
// ============================================================================
const ENV = {
  SUPABASE_URL: String($env.MONUV_SUPABASE_URL || '').replace(/\/+$/, ''),
  SERVICE_KEY: $env.MONUV_SUPABASE_SERVICE_ROLE_KEY,
  APP_ID: $env.MONUV_META_APP_ID,
  APP_SECRET: $env.MONUV_META_APP_SECRET,
  VERIFY_TOKEN: $env.MONUV_META_VERIFY_TOKEN,
  GRAPH_VERSION: $env.MONUV_GRAPH_VERSION || 'v24.0',
  // Coexistência: pedir à Meta contatos + histórico (até 180 dias) do app WhatsApp Business no onboarding
  COEX_SYNC: String($env.MONUV_COEX_SYNC || '').toLowerCase() === 'true',
};
const GRAPH = `https://graph.facebook.com/${ENV.GRAPH_VERSION}`;
const helpers = this.helpers;
const EXECUTION_ID = (typeof $execution !== 'undefined' && $execution && $execution.id) || null;

/** Erro com status HTTP. Status < 500 = erro do cliente (mensagem vai ao navegador). */
class HttpError extends Error {
  constructor(status, code, message, extra = {}, detail = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.detail = detail;
  }
}

function respond(status, body) {
  return [{ json: { status, body } }];
}

/** Registra detalhes internos no Supabase (app_errors) — nunca no corpo da resposta. */
async function logInternalError(e) {
  try {
    await sb('POST', '/rest/v1/app_errors', {
      execution_id: EXECUTION_ID,
      code: (e && e.code) || 'internal',
      message: String((e && e.message) || e).slice(0, 2000),
      detail: (e && e.detail) || null,
    }, { Prefer: 'return=minimal' });
  } catch (_) { /* registro é best-effort */ }
}

async function handleError(e, extra = {}) {
  if (e instanceof HttpError && e.status < 500) {
    return respond(e.status, { ok: false, error: { code: e.code, message: e.message }, ...extra, ...e.extra });
  }
  await logInternalError(e);
  return respond(500, {
    ok: false,
    error: { code: 'internal', message: 'Erro interno. Informe a referência ao suporte.', ref: EXECUTION_ID },
    ...extra,
  });
}

async function http(opts) {
  const res = await helpers.httpRequest({
    json: true,
    ignoreHttpStatusErrors: true,
    returnFullResponse: true,
    timeout: 30000,
    ...opts,
  });
  let body = res.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { /* texto */ }
  }
  return { status: res.statusCode, body };
}

// ---------------------------------------------------------------- Supabase
async function sb(method, path, body, headers = {}) {
  if (!ENV.SUPABASE_URL || !ENV.SERVICE_KEY) {
    throw new HttpError(500, 'config', 'MONUV_SUPABASE_URL / MONUV_SUPABASE_SERVICE_ROLE_KEY não configurados no n8n.');
  }
  const r = await http({
    method,
    url: ENV.SUPABASE_URL + path,
    headers: {
      apikey: ENV.SERVICE_KEY,
      Authorization: `Bearer ${ENV.SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...headers,
    },
    body,
  });
  if (r.status >= 300) {
    throw new HttpError(502, 'supabase_error', `Supabase ${method} ${path.split('?')[0]} → ${r.status}`, {}, r.body);
  }
  return r.body;
}

const MINIMAL = { Prefer: 'return=minimal' };

async function rpc(fn, args) {
  return sb('POST', `/rest/v1/rpc/${fn}`, args);
}

/** Valida o JWT do usuário (Authorization: Bearer <access_token do Supabase>). */
async function authUser(req) {
  const h = req.headers || {};
  const authz = h.authorization || h.Authorization || '';
  const jwt = String(authz).replace(/^Bearer\s+/i, '').trim();
  if (!jwt) throw new HttpError(401, 'unauthorized', 'Token de acesso ausente.');
  const r = await http({
    method: 'GET',
    url: `${ENV.SUPABASE_URL}/auth/v1/user`,
    headers: { apikey: ENV.SERVICE_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (r.status !== 200 || !r.body || !r.body.id) throw new HttpError(401, 'unauthorized', 'Sessão inválida ou expirada.');
  return r.body;
}

/** Contexto do usuário (profile + conta WhatsApp + token). Nunca devolva `token` na resposta. */
async function userContext(userId, waAccountId, { requireAccount = true } = {}) {
  const ctx = await rpc('n8n_user_context', { p_user_id: userId, p_wa_account_id: waAccountId || null });
  if (!ctx || !ctx.ok) throw new HttpError(403, 'no_profile', 'Perfil não encontrado.');
  if (!ctx.can_use_app) throw new HttpError(403, 'plan_expired', 'Seu acesso está suspenso ou o período de teste terminou.');
  if (requireAccount) {
    if (!ctx.account) throw new HttpError(404, 'no_account', 'Nenhum número do WhatsApp conectado.');
    if (!ctx.token) throw new HttpError(409, 'no_token', 'Conexão sem token válido. Reconecte o número.');
  }
  return ctx;
}

// ---------------------------------------------------------------- Graph API
/**
 * Chamada à Graph API. O token vai no header (não na URL), então `request` pode ser
 * devolvido ao front com segurança para o painel JSON.
 */
async function graph(method, path, { token, body, qs } = {}) {
  const url = GRAPH + path;
  const r = await http({
    method,
    url,
    qs,
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const request = { method, url: url + (qs ? '?' + new URLSearchParams(qs).toString() : '') };
  if (body !== undefined) request.body = body;
  return { ok: r.status >= 200 && r.status < 300, http_status: r.status, request, response: r.body };
}

function metaError(resp) {
  const e = resp && resp.error;
  if (!e) return null;
  return {
    message: e.error_user_msg || e.message,
    code: e.code,
    subcode: e.error_subcode,
    type: e.type,
    fbtrace_id: e.fbtrace_id,
    details: e.error_data && e.error_data.details,
  };
}

/** Oculta segredos por completo (PIN de 6 dígitos, tokens, client_secret, code). */
function maskSecrets(obj) {
  const SECRET_KEYS = ['access_token', 'client_secret', 'input_token', 'pin'];
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = SECRET_KEYS.includes(k) ? '***' : walk(val);
      return o;
    }
    if (typeof v === 'string') {
      return v.replace(/(client_secret|code|access_token|input_token)=([^&\s]+)/g, (_, k) => `${k}=***`);
    }
    return v;
  };
  return walk(obj);
}

function step(name, g) {
  return {
    name,
    ok: g.ok,
    http_status: g.http_status,
    request: maskSecrets(g.request),
    response: maskSecrets(g.response),
  };
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

// ---------------------------------------------------------------- Número de telefone
const PHONE_FIELDS =
  'display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,is_on_biz_app,platform_type';

/** Converte a resposta de GET /{phone_number_id} nas colunas de wa_accounts. */
function phoneColumns(p) {
  return {
    display_phone_number: p.display_phone_number || null,
    verified_name: p.verified_name || null,
    quality_rating: p.quality_rating || null,
    name_status: p.name_status || null,
    code_verification_status: p.code_verification_status || null,
    phone_status: p.status || null,
    is_on_biz_app: p.is_on_biz_app === true,
    platform_type: p.platform_type || null,
  };
}

// ---------------------------------------------------------------- Envio de template
/** Monta o objeto `template` da Cloud API a partir dos parâmetros enviados pelo front. */
function buildTemplate(name, language, params = {}) {
  const named = params.parameter_format === 'NAMED';
  const textParam = (p) =>
    named ? { type: 'text', parameter_name: p.key, text: String(p.value ?? '') } : { type: 'text', text: String(p.value ?? '') };
  const components = [];

  if (params.header_media && params.header_media.link) {
    const t = params.header_media.type;
    const media = { link: params.header_media.link };
    if (t === 'document' && params.header_media.filename) media.filename = params.header_media.filename;
    components.push({ type: 'header', parameters: [{ type: t, [t]: media }] });
  } else if (Array.isArray(params.header) && params.header.length) {
    components.push({ type: 'header', parameters: params.header.map(textParam) });
  }
  if (Array.isArray(params.body) && params.body.length) {
    components.push({ type: 'body', parameters: params.body.map(textParam) });
  }
  for (const b of params.buttons || []) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(b.index),
      parameters: [{ type: 'text', text: String(b.value ?? '') }],
    });
  }
  const tpl = { name, language: { code: language } };
  if (components.length) tpl.components = components;
  return tpl;
}

/**
 * Envia um template: reserva a cota e grava a mensagem ANTES de chamar a Meta
 * (atômico no banco), envia, e registra a resposta.
 * Retorna { limited } quando o limite diário foi atingido (nada é enviado).
 */
async function sendTemplateMessage({ userId, account, token, to, templateName, language, params, bodyPreview, campaignId }) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: buildTemplate(templateName, language, params || {}),
  };

  const reserved = await rpc('reserve_outbound_message', {
    p_user_id: userId,
    p_message: {
      wa_account_id: account.id,
      campaign_id: campaignId || null,
      to_number: to,
      from_number: account.display_phone_number,
      template_name: templateName,
      template_language: language,
      body_preview: typeof bodyPreview === 'string' ? bodyPreview : null,
      request_payload: payload,
    },
  });
  if (!reserved || !reserved.ok) {
    return { limited: reserved && reserved.error === 'daily_limit', reserveError: reserved && reserved.error, dailyLimit: reserved && reserved.daily_send_limit };
  }

  const g = await graph('POST', `/${account.phone_number_id}/messages`, { token, body: payload });
  const sent = g.ok && g.response && g.response.messages && g.response.messages[0];
  const error = sent ? null : metaError(g.response);

  await sb('PATCH', `/rest/v1/messages?id=eq.${reserved.id}`, {
    response_payload: g.response,
    http_status: g.http_status,
    wa_message_id: sent ? sent.id : null,
    status: sent ? 'accepted' : 'failed',
    error,
  }, MINIMAL);
  if (sent) await rpc('attach_message_events', { p_message_id: reserved.id });

  return { sent: !!sent, graph: g, error, messageId: reserved.id, waMessageId: sent ? sent.id : null };
}
// ============================================================================

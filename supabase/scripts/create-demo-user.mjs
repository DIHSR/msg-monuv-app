#!/usr/bin/env node
// Cria (ou atualiza) o usuário de demonstração permanente para o revisor da Meta.
//
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   DEMO_EMAIL=revisor@monuv.com.br \
//   DEMO_PASSWORD='senha-forte-aqui' \
//   node supabase/scripts/create-demo-user.mjs
//
// Sem dependências: usa a Admin API do Supabase Auth e o PostgREST via fetch.

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL, DEMO_PASSWORD } = process.env;
const DEMO_NAME = process.env.DEMO_NAME || 'Revisor Meta (demo)';
const DEMO_COMPANY = process.env.DEMO_COMPANY || 'Monuv — Demonstração';
const DAILY_LIMIT = Number(process.env.DEMO_DAILY_LIMIT || 50);

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL, DEMO_PASSWORD })) {
  if (!v) {
    console.error(`Variável obrigatória ausente: ${k}`);
    process.exit(1);
  }
}

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function call(method, path, body, extra = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { ...headers, ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}`);
    err.body = json;
    throw err;
  }
  return json;
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 50; page++) {
    const data = await call('GET', `/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = data.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

let user = await findUserByEmail(DEMO_EMAIL);

if (!user) {
  user = await call('POST', '/auth/v1/admin/users', {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: DEMO_NAME },
    // projeto compartilhado: só quem tem esta marca ganha perfil no Monuv Mensagens
    app_metadata: { monuv_msg: true },
  });
  console.log(`✔ Usuário criado: ${user.id}`);
} else {
  console.log(`• Usuário já existe: ${user.id} (senha NÃO alterada — demo é protegido por trigger)`);
}

// Marca como demo permanente (fora de qualquer trial). Upsert: o usuário pode ter sido criado
// antes do trigger do Monuv (projeto compartilhado) e não ter perfil ainda.
await call(
  'POST',
  `/rest/v1/profiles?on_conflict=id`,
  {
    id: user.id,
    email: DEMO_EMAIL,
    full_name: DEMO_NAME,
    company_name: DEMO_COMPANY,
    is_demo: true,
    plan: 'permanent',
    trial_ends_at: null,
    daily_send_limit: DAILY_LIMIT,
  },
  { Prefer: 'resolution=merge-duplicates,return=minimal' },
);

// Confere login real com e-mail/senha
const anonCheck = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
});
console.log(anonCheck.ok ? '✔ Login de teste OK' : `✖ Login de teste falhou (${anonCheck.status})`);
console.log('✔ Profile marcado como is_demo=true, plan=permanent, trial_ends_at=null');

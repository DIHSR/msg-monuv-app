// Regressões da auditoria de segurança (run-1, ~/security-audit-skill/msg-monuv-app/run-1).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDb } from './harness.mjs'

const row = (waba, phone) => JSON.stringify({ waba_id: waba, phone_number_id: phone, status: 'pending' })

test('claim_wa_account: primeiro dono mantém o número; outro tenant recebe phone_in_use', async () => {
  const { one, newUser } = await freshDb()
  const a = await newUser('a@x.com')
  const b = await newUser('b@x.com')
  const first = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [a, row('WA', 'P')])).r
  assert.equal(first.ok, true)
  const again = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [a, row('WA2', 'P')])).r
  assert.equal(again.ok, true, 'o próprio dono pode reconectar')
  const other = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [b, row('WB', 'P')])).r
  assert.deepEqual(other, { ok: false, error: 'phone_in_use' })
  const stored = await one(`select user_id, waba_id from public.wa_accounts where phone_number_id='P'`)
  assert.equal(stored.user_id, a)
  assert.equal(stored.waba_id, 'WA2')
})

test('reserve_outbound_message aplica o limite diário na mesma transação do insert', async () => {
  const { q, one, newUser, newAccount } = await freshDb()
  const demo = await newUser('demo@x.com')
  const acc = await newAccount(demo, 'W', 'P')
  await q(`update public.profiles set daily_send_limit = 2 where id=$1`, [demo])
  const msg = JSON.stringify({ wa_account_id: acc, to_number: '5511999990000', template_name: 't', template_language: 'pt_BR', request_payload: {} })
  const r = []
  for (let i = 0; i < 3; i++) r.push((await one(`select public.reserve_outbound_message($1, $2::jsonb) r`, [demo, msg])).r)
  assert.equal(r[0].ok, true)
  assert.equal(r[1].ok, true)
  assert.deepEqual(r[2], { ok: false, error: 'daily_limit', daily_send_limit: 2 })
  assert.equal((await one(`select count(*)::int c from public.messages where user_id=$1`, [demo])).c, 2)
})

test('reserve_outbound_message recusa conta WhatsApp de outro usuário', async () => {
  const { one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const b = await newUser('b@x.com')
  const accB = await newAccount(b, 'W', 'P')
  const msg = JSON.stringify({ wa_account_id: accB, to_number: '5511999990000', template_name: 't', template_language: 'pt_BR' })
  assert.deepEqual((await one(`select public.reserve_outbound_message($1, $2::jsonb) r`, [a, msg])).r, { ok: false, error: 'account_not_found' })
})

test('reserve_outbound_message não é executável pelo navegador', async () => {
  const { asUser, newUser } = await freshDb()
  const a = await newUser('a@x.com')
  await assert.rejects(asUser(a, `select public.reserve_outbound_message('${a}', '{}'::jsonb)`), /permission denied/)
  await assert.rejects(asUser(a, `select public.claim_wa_account('${a}', '{}'::jsonb)`), /permission denied/)
})

test('front só grava colunas permitidas em campanhas e destinatários', async () => {
  const { one, asUser, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const acc = await newAccount(a, 'W', 'P')
  await assert.rejects(
    asUser(a, `insert into public.campaigns(wa_account_id, name, template_name, template_language, total) values ('${acc}','c','t','pt_BR',999)`),
    /permission denied/,
  )
  const camp = (await asUser(a, `insert into public.campaigns(wa_account_id, name, template_name, template_language) values ('${acc}','c','t','pt_BR') returning id`)).rows[0].id
  await assert.rejects(
    asUser(a, `insert into public.campaign_recipients(campaign_id, to_number, wa_message_id) values ('${camp}','5511','wamid.X')`),
    /permission denied/,
  )
  await asUser(a, `insert into public.campaign_recipients(campaign_id, to_number, params) values ('${camp}','5511','{}')`)
  assert.equal((await one(`select status from public.campaigns where id=$1`, [camp])).status, 'draft')
})

test('falha de status só marca destinatário da própria campanha da mensagem', async () => {
  const { q, one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const b = await newUser('b@x.com')
  const accA = await newAccount(a, 'WA', 'PA')
  const accB = await newAccount(b, 'WB', 'PB')
  const campA = (await one(`insert into public.campaigns(user_id, wa_account_id, name, template_name, template_language) values ($1,$2,'a','t','pt_BR') returning id`, [a, accA])).id
  const campB = (await one(`insert into public.campaigns(user_id, wa_account_id, name, template_name, template_language) values ($1,$2,'b','t','pt_BR') returning id`, [b, accB])).id
  await q(`insert into public.campaign_recipients(campaign_id, user_id, to_number, wa_message_id, status) values ($1,$2,'1','wamid.B','sent')`, [campA, a])
  await q(`insert into public.campaign_recipients(campaign_id, user_id, to_number, wa_message_id, status) values ($1,$2,'2','wamid.B','sent')`, [campB, b])
  await q(`insert into public.messages(user_id, wa_account_id, campaign_id, wa_message_id, status) values ($1,$2,$3,'wamid.B','accepted')`, [b, accB, campB])
  await q(`select public.apply_message_status('wamid.B','failed', now(), '{"errors":[{"code":131026}]}')`)
  assert.equal((await one(`select status from public.campaign_recipients where campaign_id=$1`, [campA])).status, 'sent')
  assert.equal((await one(`select status from public.campaign_recipients where campaign_id=$1`, [campB])).status, 'failed')
})

test('anon/authenticated não têm TRUNCATE/REFERENCES/TRIGGER nas tabelas', async () => {
  const { one } = await freshDb()
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const r = await one(`select has_table_privilege($1, 'public.messages', $2) p`, [role, priv])
      assert.equal(r.p, false, `${role} ${priv}`)
    }
  }
})

test('excluir a conta WhatsApp apaga token e PIN do Vault', async () => {
  const { q, one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const acc = await newAccount(a, 'W', 'P')
  await one(`select public.wa_store_secret($1,'token','T')`, [acc])
  await one(`select public.wa_store_secret($1,'pin','123456')`, [acc])
  assert.equal((await one(`select count(*)::int c from vault.secrets`)).c, 2)
  await q(`delete from public.wa_accounts where id=$1`, [acc])
  assert.equal((await one(`select count(*)::int c from vault.secrets`)).c, 0)
})

test('conta desconectada não entrega token, nem com id explícito', async () => {
  const { one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const acc = await newAccount(a, 'W', 'P', 'disconnected')
  await one(`select public.wa_store_secret($1,'token','T')`, [acc])
  const ctx = (await one(`select public.n8n_user_context($1, $2) c`, [a, acc])).c
  assert.equal(ctx.account, null)
  assert.equal(ctx.token, null)
})

// Spec v2: conversas, alerta de inatividade, histórico da conta e campanhas com consentimento.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDb } from './harness.mjs'

const insertMessage = (q, row) =>
  q(
    `insert into public.messages(user_id, wa_account_id, direction, from_number, to_number, body_preview, origin, contact_name, created_at, campaign_id, status, wa_message_id)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,'api'),$8,coalesce($9::timestamptz, now()),$10,coalesce($11,'sent'),$12) returning id`,
    [row.user, row.acc, row.direction, row.from ?? null, row.to ?? null, row.text ?? 'x', row.origin ?? null, row.name ?? null, row.at ?? null, row.campaign ?? null, row.status ?? null, row.wamid ?? null],
  )

test('contact_key junta o número digitado com o nono dígito e o wa_id da Meta sem ele', async () => {
  const { one } = await freshDb()
  const k = async (n) => (await one(`select public.contact_key($1) k`, [n])).k
  assert.equal(await k('5586995211166'), await k('558695211166'))
  assert.equal(await k('+55 (86) 99521-1166'), '558695211166')
  assert.equal(await k('14155550123'), '14155550123', 'fora do Brasil: só dígitos')
  assert.equal(await k(''), null)
})

test('conversas: uma linha por contato com a última mensagem, e o usuário B não vê as do A', async () => {
  const { db, q, asUser, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const b = await newUser('b@x.com')
  const accA = await newAccount(a, 'WA', 'PA')
  await newAccount(b, 'WB', 'PB')

  await insertMessage(q, { user: a, acc: accA, direction: 'outbound', to: '5586995211166', text: 'oi pela API', at: '2026-11-10T10:00:00Z' })
  await insertMessage(q, { user: a, acc: accA, direction: 'inbound', from: '558695211166', text: 'resposta', name: 'Maria', at: '2026-11-10T10:05:00Z' })
  await insertMessage(q, { user: a, acc: accA, direction: 'outbound', to: '558695211166', text: 'pelo celular', origin: 'business_app', at: '2026-11-10T10:06:00Z' })
  await insertMessage(q, { user: a, acc: accA, direction: 'inbound', from: '5511988887777', text: 'outro contato', at: '2026-11-09T09:00:00Z' })

  const rows = (await asUser(a, `select * from public.conversations where wa_account_id = $1 order by last_at desc`, [accA])).rows
  assert.equal(rows.length, 2)
  assert.equal(rows[0].contact_key, '558695211166')
  assert.equal(Number(rows[0].message_count), 3, 'com e sem o nono dígito na mesma conversa')
  assert.equal(rows[0].last_origin, 'business_app')
  assert.equal(rows[0].contact_name, 'Maria')

  assert.equal((await asUser(b, `select * from public.conversations`)).rows.length, 0)
  await db.exec('set role anon')
  try {
    await assert.rejects(q(`select * from public.conversations`), /permission denied/)
  } finally {
    await db.exec('reset role')
  }
})

test('origin só aceita api, business_app e history', async () => {
  const { q, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const acc = await newAccount(a, 'W', 'P')
  await assert.rejects(insertMessage(q, { user: a, acc, direction: 'outbound', to: '5511', origin: 'outro' }), /check/)
})

test('alerta de inatividade: marca coexistência parada há mais de 10 dias e limpa quando o celular volta', async () => {
  const { q, one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const coex = await newAccount(a, 'W', 'P1')
  const api = await newAccount(a, 'W', 'P2')
  await q(`update public.wa_accounts set is_on_biz_app = true, last_seen_at = now() - interval '11 days' where id = $1`, [coex])
  await q(`update public.wa_accounts set last_seen_at = now() - interval '30 days' where id = $1`, [api])

  const r = (await one(`select public.refresh_inactivity_alerts() r`)).r
  assert.equal(r.flagged, 1)
  assert.ok((await one(`select inactivity_alert_at from public.wa_accounts where id=$1`, [coex])).inactivity_alert_at)
  assert.equal((await one(`select inactivity_alert_at from public.wa_accounts where id=$1`, [api])).inactivity_alert_at, null, 'só coexistência')
  assert.equal((await one(`select count(*)::int n from public.wa_account_events where wa_account_id=$1 and event='INACTIVITY_WARNING'`, [coex])).n, 1)

  // segunda execução não duplica o aviso
  assert.equal((await one(`select public.refresh_inactivity_alerts() r`)).r.flagged, 0)

  await q(`update public.wa_accounts set last_seen_at = now() where id = $1`, [coex])
  assert.equal((await one(`select public.refresh_inactivity_alerts() r`)).r.cleared, 1)
  assert.equal((await one(`select inactivity_alert_at from public.wa_accounts where id=$1`, [coex])).inactivity_alert_at, null)
})

test('refresh_inactivity_alerts e wa_account_events: só service_role escreve; usuário lê só os seus', async () => {
  const { q, asUser, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const b = await newUser('b@x.com')
  const acc = await newAccount(a, 'W', 'P')
  await q(`insert into public.wa_account_events(wa_account_id, user_id, field, event) values ($1,$2,'phone_number_quality_update','FLAGGED')`, [acc, a])
  await assert.rejects(asUser(a, `select public.refresh_inactivity_alerts()`), /permission denied/)
  await assert.rejects(asUser(a, `insert into public.wa_account_events(wa_account_id, user_id, field) values ('${acc}','${a}','x')`), /permission denied/)
  assert.equal((await asUser(a, `select * from public.wa_account_events`)).rows.length, 1)
  assert.equal((await asUser(b, `select * from public.wa_account_events`)).rows.length, 0)
})

test('claim_wa_account: coexistência começa com last_seen_at e reconectar limpa desconexão e alerta', async () => {
  const { q, one, newUser } = await freshDb()
  const a = await newUser('a@x.com')
  const row = JSON.stringify({ waba_id: 'W', phone_number_id: 'P', status: 'connected', is_on_biz_app: true })
  const r = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [a, row])).r
  assert.ok(r.account.last_seen_at)

  await q(`update public.wa_accounts set status='disconnected', disconnected_at=now(), inactivity_alert_at=now() where phone_number_id='P'`)
  const again = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [a, row])).r
  assert.equal(again.account.disconnected_at, null)
  assert.equal(again.account.inactivity_alert_at, null)
  assert.equal(again.account.status, 'connected')
})

test('campanha: front não cria sem origem da lista e consentimento', async () => {
  const { asUser, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const acc = await newAccount(a, 'W', 'P')
  const ins = (cols, vals) => asUser(a, `insert into public.campaigns(wa_account_id, name, template_name, template_language${cols}) values ('${acc}','c','t','pt_BR'${vals})`)
  await assert.rejects(ins('', ''), /row-level security/)
  await assert.rejects(ins(', list_source', `, 'CRM'`), /row-level security/)
  await assert.rejects(ins(', list_source, consent_confirmed', `, '  ', true`), /row-level security/)
  await ins(', list_source, consent_confirmed', `, 'Clientes do CRM', true`)
})

test('campanha: status delivered/read do webhook atualiza delivered_count', async () => {
  const { q, one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const acc = await newAccount(a, 'W', 'P')
  const camp = (await one(
    `insert into public.campaigns(user_id, wa_account_id, name, template_name, template_language, status) values ($1,$2,'c','t','pt_BR','running') returning id`,
    [a, acc],
  )).id
  await insertMessage(q, { user: a, acc, direction: 'outbound', to: '5511999990000', campaign: camp, status: 'accepted', wamid: 'wamid.1' })
  await insertMessage(q, { user: a, acc, direction: 'outbound', to: '5511999990001', campaign: camp, status: 'accepted', wamid: 'wamid.2' })

  await one(`select public.apply_message_status('wamid.1','delivered', now(), '{}'::jsonb)`)
  await one(`select public.apply_message_status('wamid.2','read', now(), '{}'::jsonb)`)
  assert.equal((await one(`select delivered_count from public.campaigns where id=$1`, [camp])).delivered_count, 2)
})

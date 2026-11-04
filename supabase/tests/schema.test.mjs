// Comportamento base do schema: profiles/trial, usuário demo, Vault, status de mensagem, RLS.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDb } from './harness.mjs'

test('novo usuário ganha profile em trial de 14 dias', async () => {
  const { one, newUser } = await freshDb()
  const u = await newUser('cliente@x.com')
  const p = await one(`select plan, public.can_use_app(profiles) as can from public.profiles where id=$1`, [u])
  assert.equal(p.plan, 'trial')
  assert.equal(p.can, true)
})

test('trial expirado bloqueia; demo permanente não expira', async () => {
  const { q, one, newUser } = await freshDb()
  const u = await newUser('a@x.com')
  const demo = await newUser('revisor@x.com')
  await q(`update public.profiles set trial_ends_at = now() - interval '1 day' where id=$1`, [u])
  await q(`update public.profiles set is_demo=true, plan='permanent', trial_ends_at=null where id=$1`, [demo])
  assert.equal((await one(`select public.can_use_app(profiles) c from public.profiles where id=$1`, [u])).c, false)
  assert.equal((await one(`select public.can_use_app(profiles) c from public.profiles where id=$1`, [demo])).c, true)
})

test('demo não pode trocar senha/e-mail nem ser excluído, exceto com bypass consciente', async () => {
  const { db, q, newUser } = await freshDb()
  const u = await newUser('comum@x.com')
  const demo = await newUser('revisor@x.com')
  await q(`update public.profiles set is_demo=true, plan='permanent' where id=$1`, [demo])
  await assert.rejects(q(`update auth.users set encrypted_password='novo' where id=$1`, [demo]), /demonstração/)
  await assert.rejects(q(`update auth.users set email='x@y.com' where id=$1`, [demo]), /demonstração/)
  await assert.rejects(q(`delete from auth.users where id=$1`, [demo]), /demonstração/)
  await q(`update auth.users set raw_user_meta_data='{"a":1}' where id=$1`, [demo])
  await q(`update auth.users set encrypted_password='novo' where id=$1`, [u])
  await db.exec(`begin; set local app.allow_demo_change='on'; update auth.users set encrypted_password='h2' where email='revisor@x.com'; commit;`)
})

test('Vault guarda e atualiza token; contexto não vaza conta de outro usuário', async () => {
  const { one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const b = await newUser('b@x.com')
  const acc = await newAccount(a, 'W1', 'P1')
  await one(`select public.wa_store_secret($1,'token','TOKEN-1')`, [acc])
  await one(`select public.wa_store_secret($1,'token','TOKEN-2')`, [acc])
  assert.equal((await one(`select count(*)::int c from vault.secrets`)).c, 1)
  const ctx = (await one(`select public.n8n_user_context($1, null) c`, [a])).c
  assert.equal(ctx.token, 'TOKEN-2')
  const other = (await one(`select public.n8n_user_context($1, $2) c`, [b, acc])).c
  assert.equal(other.account, null)
  assert.equal(other.token, null)
})

test('status de mensagem: corrida resolvida, ordem respeitada, idempotente', async () => {
  const { q, one, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const acc = await newAccount(a, 'W1', 'P1')
  const m = (await one(`insert into public.messages(user_id, wa_account_id, to_number) values ($1,$2,'5511') returning id`, [a, acc])).id
  assert.equal((await one(`select public.apply_message_status('wamid.1','sent', now(), '{}') r`)).r.reason, 'message_not_found')
  await q(`update public.messages set wa_message_id='wamid.1', status='accepted' where id=$1`, [m])
  await q(`select public.attach_message_events($1)`, [m])
  assert.equal((await one(`select status from public.messages where id=$1`, [m])).status, 'sent')
  await q(`select public.apply_message_status('wamid.1','read', now(), '{}')`)
  await q(`select public.apply_message_status('wamid.1','delivered', now(), '{}')`)
  assert.equal((await one(`select status from public.messages where id=$1`, [m])).status, 'read')
  assert.equal((await one(`select public.apply_message_status('wamid.1','read', now(), '{}') r`)).r.new_event, false)
})

test('RLS isola tenants e fecha credenciais e funções do n8n', async () => {
  const { one, asUser, newUser, newAccount } = await freshDb()
  const a = await newUser('a@x.com')
  const b = await newUser('b@x.com')
  const acc = await newAccount(a, 'W1', 'P1')
  await one(`select public.wa_store_secret($1,'token','T')`, [acc])
  assert.equal((await asUser(a, `select * from public.wa_accounts`)).rows.length, 1)
  assert.equal((await asUser(b, `select * from public.wa_accounts`)).rows.length, 0)
  await assert.rejects(asUser(a, `select * from public.wa_credentials`), /permission denied/)
  await assert.rejects(asUser(a, `select public.n8n_user_context('${a}', null)`), /permission denied/)
  await assert.rejects(asUser(a, `select public.wa_store_secret('${acc}','token','x')`), /permission denied/)
  await assert.rejects(asUser(a, `insert into public.messages(user_id, wa_account_id) values ('${a}','${acc}')`), /permission denied/)
  await assert.rejects(asUser(a, `update public.profiles set plan='permanent' where id='${a}'`), /permission denied/)
  await asUser(a, `update public.profiles set full_name='Novo' where id='${a}'`)
})

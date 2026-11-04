// Projeto Supabase compartilhado: usuários de outros sistemas não ganham acesso ao Monuv Mensagens.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDb } from './harness.mjs'

test('usuário novo de outro sistema não ganha perfil (nem trial) do Monuv Mensagens', async () => {
  const { one, newUser } = await freshDb()
  const other = await newUser('copv2@monuv.com.br', { msgAccess: false })
  assert.equal((await one(`select count(*)::int c from public.profiles where id=$1`, [other])).c, 0)
})

test('usuário criado com app_metadata.monuv_msg ganha trial de 14 dias', async () => {
  const { one, newUser } = await freshDb()
  const u = await newUser('msg@monuv.com.br')
  const p = await one(`select plan, trial_ends_at > now() + interval '13 days' as ok from public.profiles where id=$1`, [u])
  assert.equal(p.plan, 'trial')
  assert.equal(p.ok, true)
})

test('grant_msg_access libera usuário existente e nunca rebaixa o demo', async () => {
  const { q, one, newUser } = await freshDb()
  await newUser('antigo@monuv.com.br', { msgAccess: false })
  const r = (await one(`select public.grant_msg_access('ANTIGO@monuv.com.br', 'active') r`)).r
  assert.equal(r.plan, 'active')
  assert.equal(r.trial_ends_at, null)

  const demo = await newUser('demo@monuv.com.br')
  await q(`update public.profiles set is_demo = true, plan = 'permanent', trial_ends_at = null where id=$1`, [demo])
  const d = (await one(`select public.grant_msg_access('demo@monuv.com.br') r`)).r
  assert.equal(d.plan, 'permanent')

  await assert.rejects(q(`select public.grant_msg_access('ninguem@x.com')`), /não existe/)
  await assert.rejects(q(`select public.grant_msg_access('antigo@monuv.com.br', 'permanent')`), /Plano inválido/)
})

test('grant_msg_access não é chamável pelo front', async () => {
  const { asUser, newUser } = await freshDb()
  const u = await newUser('a@x.com')
  await assert.rejects(asUser(u, `select public.grant_msg_access('a@x.com', 'active')`), /permission denied/)
})

test('migrations não mexem nas permissões de tabelas de outros sistemas', async () => {
  const { one } = await freshDb({ before: 'create table public.copv2_events (id int);' })
  const r = await one(`select has_table_privilege('authenticated', 'public.copv2_events', 'TRUNCATE') t`)
  assert.equal(r.t, true)
})

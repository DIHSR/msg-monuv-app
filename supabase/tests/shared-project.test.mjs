// Projeto Supabase compartilhado: usuários de outros sistemas não ganham acesso ao Monuv Mensagens.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDb } from './harness.mjs'

test('usuário novo de outro sistema não ganha perfil do Monuv Mensagens', async () => {
  const { one, newUser } = await freshDb()
  const other = await newUser('copv2@monuv.com.br', { msgAccess: false })
  assert.equal((await one(`select count(*)::int c from public.profiles where id=$1`, [other])).c, 0)
})

test('usuário criado com app_metadata.monuv_msg ganha perfil ativo', async () => {
  const { one, newUser } = await freshDb()
  const u = await newUser('msg@monuv.com.br')
  assert.equal((await one(`select plan from public.profiles where id=$1`, [u])).plan, 'active')
})

test('grant/revoke_msg_access liberam e suspendem usuário existente, sem tocar no demo', async () => {
  const { q, one, newUser } = await freshDb()
  await newUser('antigo@monuv.com.br', { msgAccess: false })
  assert.equal((await one(`select public.grant_msg_access('ANTIGO@monuv.com.br') r`)).r.plan, 'active')
  assert.equal((await one(`select public.revoke_msg_access('antigo@monuv.com.br') r`)).r.plan, 'suspended')
  assert.equal((await one(`select public.grant_msg_access('antigo@monuv.com.br') r`)).r.plan, 'active', 'reativa')

  const demo = await newUser('demo@monuv.com.br')
  await q(`update public.profiles set is_demo = true, plan = 'permanent' where id=$1`, [demo])
  assert.equal((await one(`select public.grant_msg_access('demo@monuv.com.br') r`)).r.plan, 'permanent')
  await assert.rejects(q(`select public.revoke_msg_access('demo@monuv.com.br')`), /demo/)
  assert.equal((await one(`select plan from public.profiles where id=$1`, [demo])).plan, 'permanent')

  await assert.rejects(q(`select public.grant_msg_access('ninguem@x.com')`), /não existe/)
  await assert.rejects(q(`select public.revoke_msg_access('ninguem@x.com')`), /não tem acesso/)
})

test('grant_msg_access não é chamável pelo front', async () => {
  const { asUser, newUser } = await freshDb()
  const u = await newUser('a@x.com')
  await assert.rejects(asUser(u, `select public.grant_msg_access('a@x.com')`), /permission denied/)
  await assert.rejects(asUser(u, `select public.revoke_msg_access('a@x.com')`), /permission denied/)
})

test('migrations não mexem nas permissões de tabelas de outros sistemas', async () => {
  const { one } = await freshDb({ before: 'create table public.copv2_events (id int);' })
  const r = await one(`select has_table_privilege('authenticated', 'public.copv2_events', 'TRUNCATE') t`)
  assert.equal(r.t, true)
})

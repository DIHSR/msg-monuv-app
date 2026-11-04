// Fila de campanhas processada pelo agendador do n8n (claim_campaign_batch).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDb } from './harness.mjs'

async function setup(recipients = 3, status = 'queued') {
  const t = await freshDb()
  const u = await t.newUser('a@x.com')
  const acc = await t.newAccount(u, 'W', 'P')
  const camp = (await t.one(
    `insert into public.campaigns(user_id, wa_account_id, name, template_name, template_language, status) values ($1,$2,'c','t','pt_BR',$3) returning id`,
    [u, acc, status],
  )).id
  for (let i = 0; i < recipients; i++) {
    await t.q(`insert into public.campaign_recipients(campaign_id, user_id, to_number) values ($1,$2,$3)`, [camp, u, `55119999900${i}`])
  }
  const claim = async (limit = 2) => (await t.one(`select public.claim_campaign_batch($1) r`, [limit])).r
  return { ...t, u, acc, camp, claim }
}

test('reserva lotes de destinatários pendentes e marca a campanha como running', async () => {
  const { one, camp, claim } = await setup(3)
  const b1 = await claim(2)
  assert.equal(b1.campaign.id, camp)
  assert.equal(b1.recipients.length, 2)
  assert.equal((await one(`select status from public.campaigns where id=$1`, [camp])).status, 'running')
  assert.equal((await one(`select count(*)::int c from public.campaign_recipients where status='sending'`)).c, 2)
  const b2 = await claim(2)
  assert.equal(b2.recipients.length, 1, 'não repete destinatário já reservado')
})

test('campanha sem pendentes e sem envios em andamento é concluída', async () => {
  const { q, one, camp, claim } = await setup(1)
  const b = await claim(5)
  await q(`update public.campaign_recipients set status='sent' where id=$1`, [b.recipients[0].id])
  assert.equal((await claim(5)).campaign, null)
  const c = await one(`select status, sent_count, finished_at from public.campaigns where id=$1`, [camp])
  assert.equal(c.status, 'completed')
  assert.equal(c.sent_count, 1)
  assert.ok(c.finished_at)
})

test('não conclui campanha com envio em andamento (outro worker)', async () => {
  const { one, camp, claim } = await setup(1)
  await claim(5)
  assert.equal((await claim(5)).campaign, null)
  assert.equal((await one(`select status from public.campaigns where id=$1`, [camp])).status, 'running')
})

test('destinatário preso em "sending" por mais de 10 min volta a ser reservado (crash no meio)', async () => {
  const { q, claim } = await setup(1)
  await claim(5)
  await q(`update public.campaign_recipients set claimed_at = now() - interval '11 minutes'`)
  const b = await claim(5)
  assert.equal(b.recipients.length, 1)
})

test('rascunho, cancelada e falha não entram na fila', async () => {
  for (const status of ['draft', 'cancelled', 'failed']) {
    const { claim } = await setup(2, status)
    assert.equal((await claim(5)).campaign, null, status)
  }
})

test('reveza entre campanhas (justiça entre tenants)', async () => {
  const t = await setup(4)
  const u2 = await t.newUser('b@x.com')
  const acc2 = await t.newAccount(u2, 'W2', 'P2')
  const camp2 = (await t.one(
    `insert into public.campaigns(user_id, wa_account_id, name, template_name, template_language, status) values ($1,$2,'c2','t','pt_BR','queued') returning id`,
    [u2, acc2],
  )).id
  await t.q(`insert into public.campaign_recipients(campaign_id, user_id, to_number) values ($1,$2,'5511888880000')`, [camp2, u2])
  const first = (await t.claim(1)).campaign.id
  const second = (await t.claim(1)).campaign.id
  assert.notEqual(first, second)
})

test('claim_campaign_batch não é executável pelo navegador', async () => {
  const { asUser, u } = await setup(1)
  await assert.rejects(asUser(u, `select public.claim_campaign_batch(5)`), /permission denied/)
})

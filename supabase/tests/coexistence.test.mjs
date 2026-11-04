// Coexistência: claim_wa_account grava os campos novos e reabre a janela de sincronização.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshDb } from './harness.mjs'

test('claim_wa_account grava is_on_biz_app/platform_type e zera coex_sync_requested_at ao reconectar', async () => {
  const { q, one, newUser } = await freshDb()
  const a = await newUser('a@x.com')
  const row = (extra) => JSON.stringify({ waba_id: 'W', phone_number_id: 'P', status: 'connected', ...extra })

  const r = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [a, row({ is_on_biz_app: true, platform_type: 'CLOUD_API' })])).r
  assert.equal(r.ok, true)
  assert.equal(r.account.is_on_biz_app, true)
  assert.equal(r.account.platform_type, 'CLOUD_API')

  await q(`update public.wa_accounts set coex_sync_requested_at = now() where phone_number_id='P'`)
  const again = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [a, row({ is_on_biz_app: true })])).r
  assert.equal(again.account.coex_sync_requested_at, null, 'novo onboarding abre nova janela de 24 h')
})

test('claim_wa_account sem is_on_biz_app assume número só na Cloud API', async () => {
  const { one, newUser } = await freshDb()
  const a = await newUser('a@x.com')
  const r = (await one(`select public.claim_wa_account($1, $2::jsonb) r`, [a, JSON.stringify({ waba_id: 'W', phone_number_id: 'P' })])).r
  assert.equal(r.account.is_on_biz_app, false)
})

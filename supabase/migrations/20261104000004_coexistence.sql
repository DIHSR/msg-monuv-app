-- Coexistência (WhatsApp Business app + Cloud API no mesmo número).
-- O Embedded Signup v5 oferece a coexistência por padrão; o n8n detecta pelo campo
-- `is_on_biz_app` do número e, nesse caso, NÃO registra o número (ele já está registrado).

alter table public.wa_accounts
  add column is_on_biz_app          boolean not null default false,
  add column platform_type          text,
  -- sincronização de contatos/histórico do app (só pode ser pedida uma vez, até 24 h após o onboarding)
  add column coex_sync_requested_at timestamptz;

create or replace function public.claim_wa_account(p_user_id uuid, p_row jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.wa_accounts;
begin
  insert into public.wa_accounts as a (
    user_id, business_id, waba_id, waba_name, phone_number_id, display_phone_number, verified_name,
    quality_rating, name_status, code_verification_status, phone_status, is_on_biz_app, platform_type,
    status, webhook_subscribed, last_error, connected_at)
  values (
    p_user_id, p_row ->> 'business_id', p_row ->> 'waba_id', p_row ->> 'waba_name', p_row ->> 'phone_number_id',
    p_row ->> 'display_phone_number', p_row ->> 'verified_name', p_row ->> 'quality_rating', p_row ->> 'name_status',
    p_row ->> 'code_verification_status', p_row ->> 'phone_status',
    coalesce((p_row ->> 'is_on_biz_app')::boolean, false), p_row ->> 'platform_type',
    coalesce(p_row ->> 'status', 'pending'), coalesce((p_row ->> 'webhook_subscribed')::boolean, false),
    p_row -> 'last_error', now())
  on conflict (phone_number_id) do update set
    business_id = excluded.business_id,
    waba_id = excluded.waba_id,
    waba_name = excluded.waba_name,
    display_phone_number = excluded.display_phone_number,
    verified_name = excluded.verified_name,
    quality_rating = excluded.quality_rating,
    name_status = excluded.name_status,
    code_verification_status = excluded.code_verification_status,
    phone_status = excluded.phone_status,
    is_on_biz_app = excluded.is_on_biz_app,
    platform_type = excluded.platform_type,
    status = excluded.status,
    webhook_subscribed = excluded.webhook_subscribed,
    last_error = excluded.last_error,
    connected_at = excluded.connected_at,
    -- novo onboarding = nova janela de sincronização
    coex_sync_requested_at = null
  where a.user_id = excluded.user_id
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'phone_in_use');
  end if;
  return jsonb_build_object('ok', true, 'account', to_jsonb(v_row));
end;
$$;

revoke execute on function public.claim_wa_account(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_wa_account(uuid, jsonb) to service_role;

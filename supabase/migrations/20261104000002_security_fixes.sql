-- =============================================================================
-- Correções da auditoria de segurança (run-1)
--   * n8n/es-exchange/phone-number-id-not-bound-to-granted-waba   (média)
--   * n8n/messages-send/daily-send-limit-check-then-insert-race    (baixa)
--   * endurecimentos: grants de coluna, TRUNCATE, Vault, conta desconectada
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Uma decisão, um lugar: ordem dos status de mensagem e janela do "dia" de envio
-- -----------------------------------------------------------------------------
create or replace function public.message_status_rank(p_status text)
returns integer
language sql
immutable
as $$
  select case p_status
    when 'accepted'  then 1
    when 'sent'      then 2
    when 'delivered' then 3
    when 'read'      then 4
    when 'failed'    then 5
    else 0
  end;
$$;

create or replace function public.sends_today(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.messages
   where user_id = p_user_id
     and direction = 'outbound'
     and created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
$$;

-- -----------------------------------------------------------------------------
-- Reserva atômica de envio: trava o profile, reconta e insere na mesma transação
-- -----------------------------------------------------------------------------
create or replace function public.reserve_outbound_message(p_user_id uuid, p_message jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_account_id uuid := nullif(p_message ->> 'wa_account_id', '')::uuid;
  v_id uuid;
begin
  -- serializa o consumo de cota do usuário até o commit desta transação
  select daily_send_limit into v_limit from public.profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  if not exists (select 1 from public.wa_accounts
                  where id = v_account_id and user_id = p_user_id and status <> 'disconnected') then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  if v_limit is not null and public.sends_today(p_user_id) >= v_limit then
    return jsonb_build_object('ok', false, 'error', 'daily_limit', 'daily_send_limit', v_limit);
  end if;

  insert into public.messages (user_id, wa_account_id, campaign_id, direction, to_number, from_number, type,
                               template_name, template_language, body_preview, request_payload, status)
  values (p_user_id, v_account_id, nullif(p_message ->> 'campaign_id', '')::uuid, 'outbound',
          p_message ->> 'to_number', p_message ->> 'from_number', 'template',
          p_message ->> 'template_name', p_message ->> 'template_language',
          left(p_message ->> 'body_preview', 4096), p_message -> 'request_payload', 'pending')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Vínculo atômico de número: nunca troca o dono de um phone_number_id existente
-- -----------------------------------------------------------------------------
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
    quality_rating, name_status, code_verification_status, phone_status, status, webhook_subscribed,
    last_error, connected_at)
  values (
    p_user_id, p_row ->> 'business_id', p_row ->> 'waba_id', p_row ->> 'waba_name', p_row ->> 'phone_number_id',
    p_row ->> 'display_phone_number', p_row ->> 'verified_name', p_row ->> 'quality_rating', p_row ->> 'name_status',
    p_row ->> 'code_verification_status', p_row ->> 'phone_status', coalesce(p_row ->> 'status', 'pending'),
    coalesce((p_row ->> 'webhook_subscribed')::boolean, false), p_row -> 'last_error', now())
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
    status = excluded.status,
    webhook_subscribed = excluded.webhook_subscribed,
    last_error = excluded.last_error,
    connected_at = excluded.connected_at
  where a.user_id = excluded.user_id
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'phone_in_use');
  end if;
  return jsonb_build_object('ok', true, 'account', to_jsonb(v_row));
end;
$$;

-- -----------------------------------------------------------------------------
-- Contexto do n8n: conta desconectada nunca entrega token; cota via sends_today
-- -----------------------------------------------------------------------------
create or replace function public.n8n_user_context(p_user_id uuid, p_wa_account_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_profile public.profiles;
  v_account public.wa_accounts;
  v_token text;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  select * into v_account from public.wa_accounts
   where user_id = p_user_id
     and status <> 'disconnected'
     and (p_wa_account_id is null or id = p_wa_account_id)
   order by connected_at desc
   limit 1;

  if v_account.id is not null then
    select ds.decrypted_secret into v_token
      from public.wa_credentials c
      join vault.decrypted_secrets ds on ds.id = c.token_secret_id
     where c.wa_account_id = v_account.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'can_use_app', public.can_use_app(v_profile),
    'is_demo', v_profile.is_demo,
    'plan', v_profile.plan,
    'daily_send_limit', v_profile.daily_send_limit,
    'sends_today', public.sends_today(p_user_id),
    'account', case when v_account.id is null then null else to_jsonb(v_account) end,
    'token', v_token
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Status: usa o rank único e só marca o destinatário da campanha da própria mensagem
-- -----------------------------------------------------------------------------
create or replace function public.apply_message_status(
  p_wa_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages;
  v_inserted boolean := false;
begin
  select * into v_msg from public.messages where wa_message_id = p_wa_message_id;

  insert into public.message_status_events (message_id, user_id, wa_message_id, status, occurred_at, payload)
  values (v_msg.id, v_msg.user_id, p_wa_message_id, p_status, p_occurred_at, p_payload)
  on conflict (wa_message_id, status) do nothing
  returning true into v_inserted;

  if v_msg.id is null then
    return jsonb_build_object('ok', false, 'reason', 'message_not_found');
  end if;

  if public.message_status_rank(p_status) > public.message_status_rank(v_msg.status) then
    update public.messages
       set status = p_status,
           error = case when p_status = 'failed' then p_payload -> 'errors' else error end
     where id = v_msg.id;
  end if;

  if v_msg.campaign_id is not null and p_status = 'failed' then
    update public.campaign_recipients
       set status = 'failed', error = p_payload -> 'errors'
     where wa_message_id = p_wa_message_id
       and campaign_id = v_msg.campaign_id
       and status <> 'failed';
  end if;

  return jsonb_build_object('ok', true, 'message_id', v_msg.id, 'new_event', coalesce(v_inserted, false));
end;
$$;

create or replace function public.attach_message_events(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages;
  v_best text;
begin
  select * into v_msg from public.messages where id = p_message_id;
  if v_msg.id is null or v_msg.wa_message_id is null then
    return;
  end if;

  update public.message_status_events
     set message_id = v_msg.id, user_id = v_msg.user_id
   where wa_message_id = v_msg.wa_message_id and message_id is null;

  select status into v_best from public.message_status_events
   where wa_message_id = v_msg.wa_message_id
   order by public.message_status_rank(status) desc
   limit 1;

  if public.message_status_rank(v_best) > public.message_status_rank(v_msg.status) then
    update public.messages set status = v_best where id = v_msg.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vault: apagar a credencial apaga os segredos (token e PIN)
-- -----------------------------------------------------------------------------
create or replace function public.delete_wa_secrets()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where id in (old.token_secret_id, old.pin_secret_id);
  return old;
end;
$$;

create trigger wa_credentials_delete_secrets
  after delete on public.wa_credentials
  for each row execute function public.delete_wa_secrets();

-- -----------------------------------------------------------------------------
-- app_errors: detalhes de erros internos do n8n (nunca devolvidos ao navegador)
-- -----------------------------------------------------------------------------
create table public.app_errors (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  execution_id text,
  code         text,
  message      text,
  detail       jsonb
);
alter table public.app_errors enable row level security;  -- sem policies: só service_role
revoke all on public.app_errors from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Grants: front grava só as colunas que lhe cabem; sem TRUNCATE/REFERENCES/TRIGGER
-- -----------------------------------------------------------------------------
revoke insert on public.campaigns, public.campaign_recipients from anon, authenticated;
grant insert (wa_account_id, name, template_name, template_language) on public.campaigns to authenticated;
grant insert (campaign_id, to_number, params) on public.campaign_recipients to authenticated;

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Execução: funções de serviço só para service_role
-- -----------------------------------------------------------------------------
revoke execute on function public.sends_today(uuid) from public, anon, authenticated;
revoke execute on function public.reserve_outbound_message(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_wa_account(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_wa_secrets() from public, anon, authenticated;
grant execute on function public.sends_today(uuid) to service_role;
grant execute on function public.reserve_outbound_message(uuid, jsonb) to service_role;
grant execute on function public.claim_wa_account(uuid, jsonb) to service_role;

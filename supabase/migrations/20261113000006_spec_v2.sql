-- =============================================================================
-- Spec v2 (13/11/2026)
--   * Lacuna 2: qualidade e limite de envio do número (phone_number_quality_update)
--   * Lacuna 3: alerta preventivo de inatividade da coexistência + motivos de desconexão
--   * Conversas: origem da mensagem (API x celular x histórico) e agrupamento por contato
--   * Campanhas: origem da lista, consentimento e contador de entregues
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) wa_accounts: limite de envio, atividade do app e desconexão
-- -----------------------------------------------------------------------------
alter table public.wa_accounts
  -- limite diário de conversas iniciadas pela empresa (TIER_250, TIER_2K, ... ou número)
  add column messaging_limit      text,
  add column quality_updated_at   timestamptz,
  -- coexistência: última atividade comprovada do app WhatsApp Business no celular
  -- (onboarding, mensagem enviada pelo celular, mudança de contatos no app)
  add column last_seen_at         timestamptz,
  -- preenchido pelo agendador quando last_seen_at passa de ~10 dias (a Meta desconecta em ~14)
  add column inactivity_alert_at  timestamptz,
  add column disconnected_at      timestamptz;

-- Contas em coexistência que já existem: o onboarding é a última atividade conhecida.
update public.wa_accounts set last_seen_at = connected_at where is_on_biz_app and last_seen_at is null;

-- -----------------------------------------------------------------------------
-- 2) wa_account_events: histórico de qualidade, limite e eventos da conta
-- -----------------------------------------------------------------------------
create table public.wa_account_events (
  id            bigint generated always as identity primary key,
  wa_account_id uuid not null references public.wa_accounts (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- phone_number_quality_update | account_update | inactivity
  field         text not null,
  event         text,
  payload       jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index wa_account_events_account_idx on public.wa_account_events (wa_account_id, occurred_at desc);

alter table public.wa_account_events enable row level security;
create policy wa_account_events_select on public.wa_account_events for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate, references, trigger on public.wa_account_events from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) Vínculo do número: coexistência começa "vista agora"; reconectar limpa a desconexão
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
  v_coex boolean := coalesce((p_row ->> 'is_on_biz_app')::boolean, false);
begin
  insert into public.wa_accounts as a (
    user_id, business_id, waba_id, waba_name, phone_number_id, display_phone_number, verified_name,
    quality_rating, name_status, code_verification_status, phone_status, is_on_biz_app, platform_type,
    messaging_limit, status, webhook_subscribed, last_error, connected_at, last_seen_at)
  values (
    p_user_id, p_row ->> 'business_id', p_row ->> 'waba_id', p_row ->> 'waba_name', p_row ->> 'phone_number_id',
    p_row ->> 'display_phone_number', p_row ->> 'verified_name', p_row ->> 'quality_rating', p_row ->> 'name_status',
    p_row ->> 'code_verification_status', p_row ->> 'phone_status', v_coex, p_row ->> 'platform_type',
    p_row ->> 'messaging_limit', coalesce(p_row ->> 'status', 'pending'),
    coalesce((p_row ->> 'webhook_subscribed')::boolean, false), p_row -> 'last_error', now(),
    case when v_coex then now() end)
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
    messaging_limit = coalesce(excluded.messaging_limit, a.messaging_limit),
    status = excluded.status,
    webhook_subscribed = excluded.webhook_subscribed,
    last_error = excluded.last_error,
    connected_at = excluded.connected_at,
    last_seen_at = excluded.last_seen_at,
    inactivity_alert_at = null,
    disconnected_at = null,
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

-- -----------------------------------------------------------------------------
-- 4) Alerta preventivo de inatividade (agendador de 1 min)
--    A Meta desconecta a coexistência com ~14 dias sem o app aberto no celular
--    (PARTNER_REMOVED + disconnection_info.reason = PRIMARY_INACTIVITY). Avisamos aos ~10.
-- -----------------------------------------------------------------------------
create or replace function public.refresh_inactivity_alerts(p_after interval default interval '10 days')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_flagged integer;
  v_cleared integer;
begin
  with flagged as (
    update public.wa_accounts
       set inactivity_alert_at = now()
     where is_on_biz_app
       and status = 'connected'
       and inactivity_alert_at is null
       and coalesce(last_seen_at, connected_at) < now() - p_after
    returning id, user_id, coalesce(last_seen_at, connected_at) as seen
  ), logged as (
    insert into public.wa_account_events (wa_account_id, user_id, field, event, payload)
    select id, user_id, 'inactivity', 'INACTIVITY_WARNING', jsonb_build_object('last_seen_at', seen) from flagged
    returning 1
  )
  select count(*) into v_flagged from logged;

  update public.wa_accounts
     set inactivity_alert_at = null
   where inactivity_alert_at is not null
     and (not is_on_biz_app or status <> 'connected' or coalesce(last_seen_at, connected_at) >= now() - p_after);
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('flagged', v_flagged, 'cleared', v_cleared);
end;
$$;

revoke execute on function public.refresh_inactivity_alerts(interval) from public, anon, authenticated;
grant execute on function public.refresh_inactivity_alerts(interval) to service_role;

-- -----------------------------------------------------------------------------
-- 5) messages: origem e contato normalizado (Conversas)
-- -----------------------------------------------------------------------------
-- Chave do contato. No Brasil a Meta costuma devolver o wa_id SEM o nono dígito
-- (digitado 5586995211166, wa_id 558695211166): usa 55 + DDD + 8 últimos dígitos
-- para que as duas formas caiam na mesma conversa.
create or replace function public.contact_key(p_number text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when d ~ '^55[0-9]{10,11}$' then '55' || substr(d, 3, 2) || right(d, 8)
    else nullif(d, '')
  end
  from (select pg_catalog.regexp_replace(coalesce(p_number, ''), '\D', '', 'g') as d) s;
$$;

alter table public.messages
  -- api = enviada/recebida pela Cloud API · business_app = enviada pelo celular (smb_message_echoes)
  -- history = importada do histórico do app (coexistência)
  add column origin       text not null default 'api' check (origin in ('api', 'business_app', 'history')),
  add column contact_name text,
  add column contact_key  text generated always as (
    public.contact_key(case when direction = 'inbound' then from_number else to_number end)
  ) stored;

create index messages_contact_idx on public.messages (wa_account_id, contact_key, created_at desc);

-- Uma linha por contato e conexão, com a última mensagem. RLS de messages vale (security_invoker).
create view public.conversations with (security_invoker = true) as
select distinct on (m.wa_account_id, m.contact_key)
  m.wa_account_id,
  m.user_id,
  m.contact_key,
  case when m.direction = 'inbound' then m.from_number else m.to_number end as contact_number,
  (select c.contact_name from public.messages c
    where c.wa_account_id = m.wa_account_id and c.contact_key = m.contact_key and c.contact_name is not null
    order by c.created_at desc limit 1) as contact_name,
  m.direction    as last_direction,
  m.origin       as last_origin,
  m.type         as last_type,
  m.body_preview as last_preview,
  m.status       as last_status,
  m.created_at   as last_at,
  count(*) over (partition by m.wa_account_id, m.contact_key) as message_count
from public.messages m
where m.contact_key is not null
order by m.wa_account_id, m.contact_key, m.created_at desc;

revoke all on public.conversations from anon;
grant select on public.conversations to authenticated;

-- -----------------------------------------------------------------------------
-- 6) Campanhas: origem da lista + consentimento obrigatórios; contador de entregues
-- -----------------------------------------------------------------------------
alter table public.campaigns
  add column list_source       text,
  add column consent_confirmed boolean not null default false,
  add column delivered_count   integer not null default 0;

grant insert (list_source, consent_confirmed) on public.campaigns to authenticated;

drop policy campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'draft'
    and consent_confirmed
    and length(trim(coalesce(list_source, ''))) >= 3
    and exists (select 1 from public.wa_accounts a
                where a.id = wa_account_id and a.user_id = (select auth.uid()))
  );

create or replace function public.refresh_campaign_counters(p_campaign_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.campaigns c set
    sent_count      = (select count(*) from public.campaign_recipients r where r.campaign_id = c.id and r.status = 'sent'),
    failed_count    = (select count(*) from public.campaign_recipients r where r.campaign_id = c.id and r.status = 'failed'),
    delivered_count = (select count(*) from public.messages m where m.campaign_id = c.id and m.status in ('delivered', 'read'))
  where c.id = p_campaign_id;
$$;

-- Status do webhook: além do que já fazia, mantém os contadores da campanha em dia.
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

  if v_msg.campaign_id is not null and p_status in ('delivered', 'read', 'failed') then
    perform public.refresh_campaign_counters(v_msg.campaign_id);
  end if;

  return jsonb_build_object('ok', true, 'message_id', v_msg.id, 'new_event', coalesce(v_inserted, false));
end;
$$;

revoke execute on function public.refresh_campaign_counters(uuid) from public, anon, authenticated;
revoke execute on function public.apply_message_status(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_campaign_counters(uuid) to service_role;
grant execute on function public.apply_message_status(text, text, timestamptz, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 7) Realtime
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.wa_account_events;

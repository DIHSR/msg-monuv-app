-- =============================================================================
-- Monuv Messaging — schema inicial
-- Front lê via RLS (auth.uid()); n8n escreve com service_role.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text,
  full_name        text,
  company_name     text,
  is_demo          boolean not null default false,
  plan             text not null default 'trial'
                   check (plan in ('trial', 'active', 'permanent', 'suspended')),
  trial_ends_at    timestamptz,
  daily_send_limit integer check (daily_send_limit is null or daily_send_limit >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Regra ÚNICA de acesso ao app. Usuário 'permanent' (demo do revisor) nunca expira.
create or replace function public.can_use_app(p public.profiles)
returns boolean
language sql
stable
as $$
  select case p.plan
    when 'permanent' then true
    when 'active'    then true
    when 'trial'     then p.trial_ends_at is null or p.trial_ends_at > now()
    else false
  end;
$$;

-- Cria profile automaticamente para cada usuário novo
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, trial_ends_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    now() + interval '14 days'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Usuário demo: bloqueia troca de senha / e-mail (o revisor usa por 1 ano).
-- Para alterar conscientemente pelo SQL Editor:
--   begin; set local app.allow_demo_change = 'on'; update auth.users ...; commit;
create or replace function public.protect_demo_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_demo_change', true), '') = 'on' then
    return new;
  end if;

  if exists (select 1 from public.profiles where id = new.id and is_demo) then
    if new.encrypted_password is distinct from old.encrypted_password
       or new.email is distinct from old.email
       or coalesce(new.email_change, '') <> coalesce(old.email_change, '') and coalesce(new.email_change, '') <> ''
       or new.banned_until is distinct from old.banned_until
       or new.deleted_at is distinct from old.deleted_at then
      raise exception 'Usuário de demonstração não pode ter senha/e-mail alterados.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_demo_user
  before update on auth.users
  for each row execute function public.protect_demo_user();

create or replace function public.protect_demo_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_demo_change', true), '') <> 'on'
     and exists (select 1 from public.profiles where id = old.id and is_demo) then
    raise exception 'Usuário de demonstração não pode ser excluído.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger protect_demo_user_delete
  before delete on auth.users
  for each row execute function public.protect_demo_user_delete();

-- ---------------------------------------------------------------------------
-- wa_accounts — números conectados (via Embedded Signup)
-- ---------------------------------------------------------------------------
create table public.wa_accounts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  business_id              text,
  waba_id                  text not null,
  waba_name                text,
  phone_number_id          text not null unique,
  display_phone_number     text,
  verified_name            text,
  quality_rating           text,
  name_status              text,
  code_verification_status text,
  phone_status             text,
  status                   text not null default 'pending'
                           check (status in ('pending', 'connected', 'error', 'disconnected')),
  webhook_subscribed       boolean not null default false,
  last_error               jsonb,
  connected_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index wa_accounts_user_idx on public.wa_accounts (user_id);
create index wa_accounts_waba_idx on public.wa_accounts (waba_id);

create trigger wa_accounts_updated_at before update on public.wa_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- wa_credentials — ponteiros para segredos no Supabase Vault (SEM acesso do front)
-- ---------------------------------------------------------------------------
create table public.wa_credentials (
  wa_account_id    uuid primary key references public.wa_accounts (id) on delete cascade,
  token_secret_id  uuid,
  pin_secret_id    uuid,
  token_type       text,
  token_expires_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger wa_credentials_updated_at before update on public.wa_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- templates — cache dos templates da WABA
-- ---------------------------------------------------------------------------
create table public.templates (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  wa_account_id    uuid not null references public.wa_accounts (id) on delete cascade,
  meta_template_id text,
  name             text not null,
  language         text not null,
  category         text,
  status           text,
  parameter_format text,
  components       jsonb not null default '[]'::jsonb,
  rejected_reason  text,
  quality_score    text,
  last_request     jsonb,
  last_response    jsonb,
  synced_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (wa_account_id, name, language)
);

create index templates_meta_id_idx on public.templates (meta_template_id);

create trigger templates_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaigns / campaign_recipients — envio em lote
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  wa_account_id     uuid not null references public.wa_accounts (id) on delete cascade,
  name              text not null,
  template_name     text not null,
  template_language text not null,
  status            text not null default 'draft'
                    check (status in ('draft', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  total             integer not null default 0,
  sent_count        integer not null default 0,
  failed_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now()
);

create index campaigns_user_idx on public.campaigns (user_id, created_at desc);

create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  to_number     text not null,
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  message_id    uuid,
  wa_message_id text,
  error         jsonb,
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id, status);

-- ---------------------------------------------------------------------------
-- messages / message_status_events
-- ---------------------------------------------------------------------------
create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  wa_account_id     uuid not null references public.wa_accounts (id) on delete cascade,
  campaign_id       uuid references public.campaigns (id) on delete set null,
  direction         text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  to_number         text,
  from_number       text,
  type              text not null default 'template',
  template_name     text,
  template_language text,
  body_preview      text,
  request_payload   jsonb,
  response_payload  jsonb,
  http_status       integer,
  wa_message_id     text unique,
  status            text not null default 'pending'
                    check (status in ('pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'received')),
  error             jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index messages_user_idx on public.messages (user_id, created_at desc);
create index messages_account_idx on public.messages (wa_account_id, created_at desc);

create trigger messages_updated_at before update on public.messages
  for each row execute function public.set_updated_at();

create table public.message_status_events (
  id            bigint generated always as identity primary key,
  message_id    uuid references public.messages (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  wa_message_id text not null,
  status        text not null,
  occurred_at   timestamptz,
  payload       jsonb,
  created_at    timestamptz not null default now(),
  unique (wa_message_id, status)
);

create index message_status_events_msg_idx on public.message_status_events (message_id);

-- ---------------------------------------------------------------------------
-- webhook_events — log bruto do webhook da Meta
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id              bigint generated always as identity primary key,
  received_at     timestamptz not null default now(),
  signature_valid boolean not null,
  object          text,
  field           text,
  waba_id         text,
  user_id         uuid references auth.users (id) on delete set null,
  payload         jsonb,
  processed       boolean not null default false,
  error           text
);

create index webhook_events_user_idx on public.webhook_events (user_id, received_at desc);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.profiles              enable row level security;
alter table public.wa_accounts           enable row level security;
alter table public.wa_credentials        enable row level security;
alter table public.templates             enable row level security;
alter table public.campaigns             enable row level security;
alter table public.campaign_recipients   enable row level security;
alter table public.messages              enable row level security;
alter table public.message_status_events enable row level security;
alter table public.webhook_events        enable row level security;

-- profiles: lê o próprio; só pode editar nome/empresa
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, company_name) on public.profiles to authenticated;

-- leitura própria
create policy wa_accounts_select on public.wa_accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy templates_select on public.templates for select to authenticated
  using (user_id = (select auth.uid()));
create policy messages_select on public.messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy message_status_events_select on public.message_status_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy webhook_events_select on public.webhook_events for select to authenticated
  using (user_id = (select auth.uid()));

-- escrita pelo front: só via n8n (service_role), exceto criação de campanhas
revoke insert, update, delete on public.wa_accounts, public.templates, public.messages,
  public.message_status_events, public.webhook_events from anon, authenticated;

-- wa_credentials: nenhuma policy => inacessível para anon/authenticated
revoke all on public.wa_credentials from anon, authenticated;

-- campaigns: usuário cria rascunho e destinatários; n8n atualiza o resto
create policy campaigns_select on public.campaigns for select to authenticated
  using (user_id = (select auth.uid()));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'draft'
    and exists (select 1 from public.wa_accounts a
                where a.id = wa_account_id and a.user_id = (select auth.uid()))
  );
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'draft');
revoke update on public.campaigns from anon, authenticated;

create policy campaign_recipients_select on public.campaign_recipients for select to authenticated
  using (user_id = (select auth.uid()));
create policy campaign_recipients_insert on public.campaign_recipients for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and exists (select 1 from public.campaigns c
                where c.id = campaign_id and c.user_id = (select auth.uid()) and c.status = 'draft')
  );
revoke update, delete on public.campaign_recipients from anon, authenticated;

-- =============================================================================
-- Funções para o n8n (service_role apenas)
-- =============================================================================

-- Guarda token / PIN no Vault e grava o ponteiro em wa_credentials
create or replace function public.wa_store_secret(p_wa_account_id uuid, p_kind text, p_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing uuid;
  v_id uuid;
  v_name text := 'wa_' || p_kind || '_' || p_wa_account_id::text;
begin
  if p_kind not in ('token', 'pin') then
    raise exception 'kind inválido: %', p_kind;
  end if;

  insert into public.wa_credentials (wa_account_id) values (p_wa_account_id)
  on conflict (wa_account_id) do nothing;

  select case p_kind when 'token' then token_secret_id else pin_secret_id end
    into v_existing
    from public.wa_credentials where wa_account_id = p_wa_account_id;

  if v_existing is not null then
    perform vault.update_secret(v_existing, p_value);
    v_id := v_existing;
  else
    v_id := vault.create_secret(p_value, v_name, 'WhatsApp ' || p_kind);
    if p_kind = 'token' then
      update public.wa_credentials set token_secret_id = v_id where wa_account_id = p_wa_account_id;
    else
      update public.wa_credentials set pin_secret_id = v_id where wa_account_id = p_wa_account_id;
    end if;
  end if;

  return v_id;
end;
$$;

-- Contexto completo do usuário para um workflow do n8n (inclui token decifrado)
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
  v_sends_today integer;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  if p_wa_account_id is not null then
    select * into v_account from public.wa_accounts
      where id = p_wa_account_id and user_id = p_user_id;
  else
    select * into v_account from public.wa_accounts
      where user_id = p_user_id and status <> 'disconnected'
      order by connected_at desc limit 1;
  end if;

  if v_account.id is not null then
    select ds.decrypted_secret into v_token
      from public.wa_credentials c
      join vault.decrypted_secrets ds on ds.id = c.token_secret_id
      where c.wa_account_id = v_account.id;
  end if;

  select count(*) into v_sends_today from public.messages
    where user_id = p_user_id and direction = 'outbound'
      and created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'can_use_app', public.can_use_app(v_profile),
    'is_demo', v_profile.is_demo,
    'plan', v_profile.plan,
    'daily_send_limit', v_profile.daily_send_limit,
    'sends_today', v_sends_today,
    'account', case when v_account.id is null then null else to_jsonb(v_account) end,
    'token', v_token
  );
end;
$$;

-- Aplica status vindo do webhook respeitando a ordem (read não volta para delivered)
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
  v_rank_new int;
  v_rank_old int;
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

  v_rank_new := case p_status when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3
                              when 'read' then 4 when 'failed' then 5 else 0 end;
  v_rank_old := case v_msg.status when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3
                                  when 'read' then 4 when 'failed' then 5 else 0 end;

  if v_rank_new > v_rank_old then
    update public.messages
      set status = p_status,
          error = case when p_status = 'failed' then p_payload -> 'errors' else error end
      where id = v_msg.id;
  end if;

  if v_msg.campaign_id is not null and p_status = 'failed' then
    update public.campaign_recipients
      set status = 'failed', error = p_payload -> 'errors'
      where wa_message_id = p_wa_message_id and status <> 'failed';
  end if;

  return jsonb_build_object('ok', true, 'message_id', v_msg.id, 'new_event', coalesce(v_inserted, false));
end;
$$;

-- Atualiza contadores de campanha
create or replace function public.refresh_campaign_counters(p_campaign_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.campaigns c set
    sent_count   = (select count(*) from public.campaign_recipients r where r.campaign_id = c.id and r.status = 'sent'),
    failed_count = (select count(*) from public.campaign_recipients r where r.campaign_id = c.id and r.status = 'failed')
  where c.id = p_campaign_id;
$$;

-- Liga eventos de status que chegaram ANTES do n8n gravar o wa_message_id (corrida comum)
create or replace function public.attach_message_events(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages;
  v_best text;
  v_rank_best int;
  v_rank_cur int;
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
    order by case status when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3
                         when 'read' then 4 when 'failed' then 5 else 0 end desc
    limit 1;

  v_rank_best := case v_best when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3
                             when 'read' then 4 when 'failed' then 5 else 0 end;
  v_rank_cur  := case v_msg.status when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3
                                   when 'read' then 4 when 'failed' then 5 else 0 end;

  if v_rank_best > v_rank_cur then
    update public.messages set status = v_best where id = v_msg.id;
  end if;
end;
$$;

-- Permissões: funções sensíveis só para service_role
revoke execute on function public.wa_store_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.n8n_user_context(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.apply_message_status(text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.refresh_campaign_counters(uuid) from public, anon, authenticated;
revoke execute on function public.attach_message_events(uuid) from public, anon, authenticated;
grant execute on function public.wa_store_secret(uuid, text, text) to service_role;
grant execute on function public.n8n_user_context(uuid, uuid) to service_role;
grant execute on function public.apply_message_status(text, text, timestamptz, jsonb) to service_role;
grant execute on function public.refresh_campaign_counters(uuid) to service_role;
grant execute on function public.attach_message_events(uuid) to service_role;

-- =============================================================================
-- Realtime
-- =============================================================================
alter publication supabase_realtime add table
  public.wa_accounts, public.templates, public.messages, public.message_status_events,
  public.campaigns, public.campaign_recipients;

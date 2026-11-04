-- Acesso ao Monuv Mensagens: uso INTERNO da Monuv, sem cobrança e sem trial,
-- num projeto Supabase COMPARTILHADO com outros sistemas Monuv (mesmo auth.users).
--
-- 1) Sem trial: planos passam a ser só active / permanent (demo do revisor) / suspended.
-- 2) Ter login no projeto não dá acesso: o perfil só nasce para quem for criado com
--      app_metadata = { "monuv_msg": true }
--    (app_metadata só é gravável com a service_role, nunca pelo próprio usuário no sign-up).
--    Usuários que já existem recebem acesso com public.grant_msg_access(email).

-- ---------------------------------------------------------------------------
-- 1) Sem trial
-- ---------------------------------------------------------------------------
update public.profiles set plan = 'active' where plan = 'trial';
alter table public.profiles alter column plan set default 'active';
alter table public.profiles drop constraint profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('active', 'permanent', 'suspended'));

-- Regra ÚNICA de acesso ao app.
create or replace function public.can_use_app(p public.profiles)
returns boolean
language sql
stable
as $$
  select p.plan in ('active', 'permanent');
$$;

-- ---------------------------------------------------------------------------
-- 2) Perfil só para quem é do Monuv Mensagens
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'monuv_msg', '') <> 'true' then
    return new;  -- usuário de outro sistema: sem perfil = sem acesso ao Monuv Mensagens
  end if;

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- trial_ends_at só existia para o trial (nenhuma função usa mais a coluna)
alter table public.profiles drop column trial_ends_at;

-- Libera (ou reativa) o Monuv Mensagens para um usuário que já existe no projeto — SQL Editor:
--   select public.grant_msg_access('pessoa@monuv.com.br');
create or replace function public.grant_msg_access(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user auth.users;
  v_profile public.profiles;
begin
  select * into v_user from auth.users where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'Usuário % não existe em auth.users.', p_email using errcode = 'P0002';
  end if;

  insert into public.profiles as p (id, email, full_name, plan)
  values (v_user.id, v_user.email, coalesce(v_user.raw_user_meta_data ->> 'full_name', split_part(v_user.email, '@', 1)), 'active')
  on conflict (id) do update set plan = 'active'
  where not p.is_demo  -- o demo do revisor continua 'permanent'
  returning * into v_profile;

  if v_profile.id is null then
    select * into v_profile from public.profiles where id = v_user.id;
  end if;
  return to_jsonb(v_profile);
end;
$$;

-- Corta o acesso (o login continua valendo para os outros sistemas):
--   select public.revoke_msg_access('pessoa@monuv.com.br');
create or replace function public.revoke_msg_access(p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  update public.profiles p set plan = 'suspended'
    from auth.users u
   where u.id = p.id and lower(u.email) = lower(trim(p_email))
  returning p.* into v_profile;

  if v_profile.id is null then
    raise exception 'Usuário % não tem acesso ao Monuv Mensagens.', p_email using errcode = 'P0002';
  end if;
  if v_profile.is_demo then
    raise exception 'O demo do revisor não pode ser suspenso por aqui.' using errcode = 'P0001';
  end if;
  return to_jsonb(v_profile);
end;
$$;

revoke execute on function public.grant_msg_access(text) from public, anon, authenticated;
revoke execute on function public.revoke_msg_access(text) from public, anon, authenticated;
grant execute on function public.grant_msg_access(text) to service_role;
grant execute on function public.revoke_msg_access(text) to service_role;

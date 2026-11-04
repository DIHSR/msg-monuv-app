-- Projeto Supabase compartilhado com outros sistemas Monuv (mesmo auth.users).
--
-- Antes: todo usuário novo do projeto — de QUALQUER sistema — ganhava perfil e trial de 14 dias
-- no Monuv Mensagens. Agora o perfil só nasce para quem for criado com
--   app_metadata = { "monuv_msg": true }
-- (app_metadata só é gravável com a service_role, nunca pelo próprio usuário no sign-up).
-- Usuários que já existem recebem acesso por public.grant_msg_access(email, plano).

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

-- Libera o Monuv Mensagens para um usuário que já existe no projeto (rodar no SQL Editor):
--   select public.grant_msg_access('pessoa@monuv.com.br');            -- trial de 14 dias
--   select public.grant_msg_access('pessoa@monuv.com.br', 'active');  -- sem prazo
create or replace function public.grant_msg_access(p_email text, p_plan text default 'trial')
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
  if p_plan not in ('trial', 'active') then
    raise exception 'Plano inválido: %. Use trial ou active (demo: supabase/scripts/create-demo-user.mjs).', p_plan
      using errcode = '22023';
  end if;

  select * into v_user from auth.users where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'Usuário % não existe em auth.users.', p_email using errcode = 'P0002';
  end if;

  insert into public.profiles as p (id, email, full_name, plan, trial_ends_at)
  values (
    v_user.id,
    v_user.email,
    coalesce(v_user.raw_user_meta_data ->> 'full_name', split_part(v_user.email, '@', 1)),
    p_plan,
    case when p_plan = 'trial' then now() + interval '14 days' end
  )
  on conflict (id) do update set
    plan = excluded.plan,
    trial_ends_at = excluded.trial_ends_at
  where not p.is_demo  -- nunca rebaixa o demo do revisor
  returning * into v_profile;

  if v_profile.id is null then
    select * into v_profile from public.profiles where id = v_user.id;
  end if;
  return to_jsonb(v_profile);
end;
$$;

revoke execute on function public.grant_msg_access(text, text) from public, anon, authenticated;
grant execute on function public.grant_msg_access(text, text) to service_role;

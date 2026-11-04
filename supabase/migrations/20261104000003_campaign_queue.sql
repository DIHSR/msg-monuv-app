-- =============================================================================
-- Fila de campanhas: o n8n (agendador, 1x/min) reserva lotes com SKIP LOCKED.
-- Substitui o loop com Wait dentro de uma execução longa: um crash no meio não
-- trava a campanha (destinatários "sending" antigos voltam para a fila).
--   draft --(API campaigns.start)--> queued --(1º lote)--> running --> completed
-- =============================================================================

alter table public.campaigns add column last_batch_at timestamptz;

alter table public.campaign_recipients add column claimed_at timestamptz;
alter table public.campaign_recipients drop constraint campaign_recipients_status_check;
alter table public.campaign_recipients
  add constraint campaign_recipients_status_check check (status in ('pending', 'sending', 'sent', 'failed'));

create index campaigns_queue_idx on public.campaigns (last_batch_at nulls first, created_at)
  where status in ('queued', 'running');

/**
 * Reserva até p_limit destinatários da próxima campanha na fila (revezando entre
 * campanhas pela última vez atendida). Campanhas sem pendentes e sem envios em
 * andamento são concluídas no caminho. Retorna { campaign, recipients } ou { campaign: null }.
 */
create or replace function public.claim_campaign_batch(p_limit integer, p_stale interval default interval '10 minutes')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_c public.campaigns;
  v_recipients jsonb;
begin
  for v_c in
    select * from public.campaigns
     where status in ('queued', 'running')
     order by last_batch_at nulls first, created_at
     for update skip locked
  loop
    with picked as (
      select id from public.campaign_recipients
       where campaign_id = v_c.id
         and (status = 'pending' or (status = 'sending' and claimed_at < now() - p_stale))
       order by created_at
       limit p_limit
       for update skip locked
    ), claimed as (
      update public.campaign_recipients r
         set status = 'sending', claimed_at = now()
        from picked
       where r.id = picked.id
      returning r.id, r.to_number, r.params
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'to_number', to_number, 'params', params)), '[]'::jsonb)
      into v_recipients from claimed;

    if jsonb_array_length(v_recipients) > 0 then
      update public.campaigns
         set status = 'running', started_at = coalesce(started_at, now()), last_batch_at = now()
       where id = v_c.id
      returning * into v_c;
      return jsonb_build_object('campaign', to_jsonb(v_c), 'recipients', v_recipients);
    end if;

    -- nada a reservar: conclui se não houver envio em andamento em outro worker
    if not exists (select 1 from public.campaign_recipients where campaign_id = v_c.id and status = 'sending') then
      perform public.refresh_campaign_counters(v_c.id);
      update public.campaigns
         set status = case when sent_count = 0 and failed_count > 0 then 'failed' else 'completed' end,
             finished_at = now()
       where id = v_c.id;
    end if;
  end loop;

  return jsonb_build_object('campaign', null, 'recipients', '[]'::jsonb);
end;
$$;

revoke execute on function public.claim_campaign_batch(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_campaign_batch(integer, interval) to service_role;

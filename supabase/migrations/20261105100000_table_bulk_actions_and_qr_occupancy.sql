-- Mantem o estado da mesa correto quando pedidos chegam por QR e ao fechar comandas.
create or replace function public.sync_table_status_from_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table_id uuid;
begin
  if tg_op <> 'INSERT' and old.table_id is not null and old.table_id is distinct from new.table_id then
    update public.tables t
       set status = case when exists (
             select 1 from public.orders o
              where o.table_id = old.table_id and o.id <> new.id
                and o.status not in ('entregue','cancelado')
           ) then 'ocupada'::public.table_status else 'livre'::public.table_status end,
           current_total = coalesce((select sum(o.total) from public.orders o
              where o.table_id = old.table_id and o.id <> new.id
                and o.status not in ('entregue','cancelado')), 0)
     where t.id = old.table_id and t.status <> 'reservada';
  end if;

  v_table_id := new.table_id;
  if v_table_id is not null then
    update public.tables t
       set status = case when new.status in ('entregue','cancelado') then
             case when exists (select 1 from public.orders o where o.table_id = v_table_id
               and o.id <> new.id and o.status not in ('entregue','cancelado'))
               then 'ocupada'::public.table_status else 'livre'::public.table_status end
             else 'ocupada'::public.table_status end,
           current_total = coalesce((select sum(o.total) from public.orders o
              where o.table_id = v_table_id and o.id <> new.id
                and o.status not in ('entregue','cancelado')), 0)
             + case when new.status not in ('entregue','cancelado') then new.total else 0 end
     where t.id = v_table_id and t.status <> 'reservada';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_sync_table_status on public.orders;
create trigger orders_sync_table_status
  after insert or update on public.orders
  for each row execute function public.sync_table_status_from_order();
revoke execute on function public.sync_table_status_from_order() from public, anon, authenticated;

-- Corrige mesas que ja tinham pedido aberto antes da instalacao deste gatilho.
update public.tables t set
  status = case when t.status = 'reservada' then t.status
    when exists (select 1 from public.orders o where o.table_id = t.id
      and o.status not in ('entregue','cancelado')) then 'ocupada'::public.table_status
    else 'livre'::public.table_status end,
  current_total = case when t.status = 'reservada' then t.current_total
    else coalesce((select sum(o.total) from public.orders o where o.table_id = t.id
      and o.status not in ('entregue','cancelado')), 0) end;

-- Substitui o fechamento simples: uma mesa continua ocupada se outra comanda estiver aberta.
create or replace function public.release_table_on_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.table_id is not null then
    update public.tables t
       set status = case when exists (select 1 from public.orders o where o.table_id = new.table_id
               and o.id <> new.id and o.status not in ('entregue','cancelado'))
               then 'ocupada'::public.table_status else 'livre'::public.table_status end,
           current_total = coalesce((select sum(o.total) from public.orders o where o.table_id = new.table_id
               and o.id <> new.id and o.status not in ('entregue','cancelado')), 0)
     where t.id = new.table_id and t.status <> 'reservada';
  end if;
  return new;
end;
$$;

create or replace function public.manage_table_bulk_action(
  p_action text,
  p_source_table uuid,
  p_target_table uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_source public.tables%rowtype;
  v_target public.tables%rowtype;
  v_target_order uuid;
  v_source_order record;
  v_count integer := 0;
  v_paid numeric(12,2);
begin
  if v_restaurant_id is null or not public.has_role(array['admin','garcom']::public.app_role[]) then
    raise exception 'Sem permissao para transferir ou juntar mesas';
  end if;
  if p_action not in ('transferir','juntar') or p_source_table is null
     or p_target_table is null or p_source_table = p_target_table then
    raise exception 'Acao ou mesas selecionadas invalidas';
  end if;

  select * into v_source from public.tables where id = p_source_table
    and restaurant_id = v_restaurant_id for update;
  if not found then raise exception 'Mesa de origem nao encontrada'; end if;
  select * into v_target from public.tables where id = p_target_table
    and restaurant_id = v_restaurant_id for update;
  if not found then raise exception 'Mesa de destino nao encontrada'; end if;
  if v_source.status = 'reservada' or v_target.status = 'reservada' then
    raise exception 'Nao e possivel usar uma mesa reservada nesta acao';
  end if;

  if p_action = 'transferir' then
    if exists (select 1 from public.orders where table_id = v_target.id
        and status not in ('entregue','cancelado')) then
      raise exception 'A mesa de destino precisa estar livre para receber a transferencia';
    end if;
    update public.orders set table_id = v_target.id
      where table_id = v_source.id and status not in ('entregue','cancelado');
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'A mesa de origem nao possui comanda aberta'; end if;
  else
    select o.id into v_target_order from public.orders o
     where o.table_id = v_target.id and o.status not in ('entregue','cancelado')
     order by o.created_at desc limit 1 for update;

    for v_source_order in select o.id from public.orders o
      where o.table_id = v_source.id and o.status not in ('entregue','cancelado')
      order by o.created_at for update
    loop
      v_count := v_count + 1;
      if exists (select 1 from public.payments p where p.order_id = v_source_order.id)
         or exists (select 1 from public.order_splits s where s.order_id = v_source_order.id) then
        raise exception 'A mesa de origem possui pagamentos ou divisao de conta; finalize ou cancele antes de juntar';
      end if;
      if v_target_order is null then
        v_target_order := v_source_order.id;
        update public.orders set table_id = v_target.id where id = v_target_order;
      else
        update public.order_items set order_id = v_target_order where order_id = v_source_order.id;
        update public.orders set status = 'cancelado' where id = v_source_order.id;
      end if;
    end loop;
    if v_count = 0 then raise exception 'A mesa de origem nao possui comanda aberta'; end if;
    if exists (select 1 from public.orders o where o.id = v_target_order) then
      select coalesce(sum(p.amount), 0) into v_paid from public.payments p
       where p.order_id = v_target_order and p.status = 'pago';
      update public.orders set payment_state = case when v_paid + 0.01 >= total
        then 'pago'::public.payment_status else 'pendente'::public.payment_status end
       where id = v_target_order;
    end if;
  end if;

  update public.tables t set
    status = case when exists (select 1 from public.orders o where o.table_id = t.id
      and o.status not in ('entregue','cancelado')) then 'ocupada'::public.table_status else 'livre'::public.table_status end,
    current_total = coalesce((select sum(o.total) from public.orders o where o.table_id = t.id
      and o.status not in ('entregue','cancelado')), 0)
  where t.id in (v_source.id, v_target.id) and t.status <> 'reservada';

  return jsonb_build_object('action', p_action, 'source_table', v_source.number,
    'target_table', v_target.number, 'orders_affected', v_count);
end;
$$;

revoke all on function public.manage_table_bulk_action(text, uuid, uuid) from public, anon;
grant execute on function public.manage_table_bulk_action(text, uuid, uuid) to authenticated;

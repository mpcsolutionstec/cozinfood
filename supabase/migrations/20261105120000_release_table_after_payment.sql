-- Uma comanda paga deixa de ocupar a mesa; os itens ainda pendentes seguem no KDS.
alter table public.payments
  add column if not exists split_id uuid unique
  references public.order_splits(id) on delete set null;

create or replace function public.sync_pos_payment_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_paid numeric(12,2);
  v_split_id uuid := nullif(to_jsonb(new)->>'split_id', '')::uuid;
begin
  if new.order_id is null or v_split_id is not null then return new; end if;
  update public.payments_log set status = new.status where payment_id = new.id;
  if new.status <> 'pago' then return new; end if;

  select * into v_order from public.orders where id = new.order_id for update;
  if not found then return new; end if;
  select coalesce(sum(amount), 0) into v_paid
    from public.payments where order_id = new.order_id and status = 'pago';
  if v_paid + 0.01 < v_order.total then return new; end if;

  -- O pedido continua no KDS pelos order_items pendentes, mas sai da comanda da mesa.
  if v_order.table_id is not null then
    update public.orders set payment_state = 'pago', status = 'entregue'
     where id = new.order_id and status not in ('entregue','cancelado');
  else
    update public.orders set payment_state = 'pago' where id = new.order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_sync_pos_order on public.payments;
create trigger payments_sync_pos_order
  after insert or update of status on public.payments
  for each row execute function public.sync_pos_payment_state();

-- Recalcula valores e ocupacao a partir de todas as comandas ainda abertas.
create or replace function public.sync_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_ids uuid[];
  v_table_ids uuid[];
  v_order_id uuid;
begin
  if tg_op = 'INSERT' then
    v_order_ids := array[new.order_id];
  elsif tg_op = 'DELETE' then
    v_order_ids := array[old.order_id];
  else
    v_order_ids := array[old.order_id];
    if new.order_id is distinct from old.order_id then
      v_order_ids := array_append(v_order_ids, new.order_id);
    end if;
  end if;

  foreach v_order_id in array v_order_ids loop
    update public.orders o set
      subtotal = coalesce((select sum(i.line_total) from public.order_items i
        where i.order_id = v_order_id and i.status <> 'cancelado'), 0),
      total = coalesce((select sum(i.line_total) from public.order_items i
        where i.order_id = v_order_id and i.status <> 'cancelado'), 0) + o.delivery_fee
     where o.id = v_order_id;
  end loop;

  select array_agg(distinct o.table_id) into v_table_ids
    from public.orders o where o.id = any(v_order_ids) and o.table_id is not null;
  if coalesce(cardinality(v_table_ids), 0) > 0 then
    update public.tables t set
      status = case when t.status = 'reservada' then t.status
        when exists (select 1 from public.orders o where o.table_id = t.id
          and o.status not in ('entregue','cancelado')) then 'ocupada'::public.table_status
        else 'livre'::public.table_status end,
      current_total = coalesce((select sum(o.total) from public.orders o where o.table_id = t.id
        and o.status not in ('entregue','cancelado')), 0)
     where t.id = any(v_table_ids);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.release_table_on_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.table_id is not null then
    update public.tables t set
      status = case when exists (select 1 from public.orders o where o.table_id = new.table_id
          and o.id <> new.id and o.status not in ('entregue','cancelado'))
        then 'ocupada'::public.table_status else 'livre'::public.table_status end,
      current_total = coalesce((select sum(o.total) from public.orders o where o.table_id = new.table_id
          and o.id <> new.id and o.status not in ('entregue','cancelado')), 0)
     where t.id = new.table_id and t.status <> 'reservada';
  end if;
  return new;
end;
$$;

-- Finaliza comandas antigas que ja estao integralmente pagas.
update public.orders o set payment_state = 'pago', status = 'entregue'
 where o.table_id is not null and o.status not in ('entregue','cancelado')
   and (select coalesce(sum(p.amount), 0) from public.payments p
     where p.order_id = o.id and p.status = 'pago') + 0.01 >= o.total;

-- Corrige o mapa das mesas apos finalizar as comandas pagas.
update public.tables t set
  status = case when t.status = 'reservada' then t.status
    when exists (select 1 from public.orders o where o.table_id = t.id
      and o.status not in ('entregue','cancelado')) then 'ocupada'::public.table_status
    else 'livre'::public.table_status end,
  current_total = case when t.status = 'reservada' then t.current_total
    else coalesce((select sum(o.total) from public.orders o where o.table_id = t.id
      and o.status not in ('entregue','cancelado')), 0) end;

revoke all on function public.sync_pos_payment_state() from public, anon, authenticated;
revoke all on function public.sync_order_totals() from public, anon, authenticated;

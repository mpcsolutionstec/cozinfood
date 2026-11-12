-- Reconcile paid table orders and persisted table occupancy when the waiter refreshes.
create or replace function public.refresh_waiter_tables()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_closed_orders integer := 0;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','garcom']::public.app_role[]) then
    raise exception 'Sem permissao para atualizar o salao' using errcode = '42501';
  end if;

  update public.orders o
     set payment_state = 'pago', status = 'entregue'
   where o.restaurant_id = v_restaurant_id
     and o.table_id is not null
     and o.status not in ('entregue','cancelado')
     and coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id and p.status = 'pago'), 0) + 0.01 >= o.total;
  get diagnostics v_closed_orders = row_count;

  update public.tables t
     set status = case
           when t.status = 'reservada' then t.status
           when exists (select 1 from public.orders o where o.table_id = t.id
             and o.restaurant_id = v_restaurant_id and o.status not in ('entregue','cancelado'))
             then 'ocupada'::public.table_status
           else 'livre'::public.table_status
         end,
         current_total = case
           when t.status = 'reservada' then t.current_total
           else coalesce((select sum(o.total) from public.orders o where o.table_id = t.id
             and o.restaurant_id = v_restaurant_id and o.status not in ('entregue','cancelado')), 0)
         end
   where t.restaurant_id = v_restaurant_id;

  return jsonb_build_object('closed_orders', v_closed_orders);
end;
$$;

revoke all on function public.refresh_waiter_tables() from public, anon;
grant execute on function public.refresh_waiter_tables() to authenticated;

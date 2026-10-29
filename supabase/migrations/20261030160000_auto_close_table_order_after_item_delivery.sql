-- Encerra automaticamente comandas de mesa quando todos os itens chegam a
-- um estado final. O trigger orders_release_table existente libera a mesa.
create or replace function public.close_table_order_when_items_terminal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_status public.order_status;
  v_has_delivered_items boolean;
begin
  if new.status not in ('entregue', 'cancelado')
     or old.status is not distinct from new.status then
    return new;
  end if;

  -- Serializa a finalização de itens da mesma comanda para evitar que duas
  -- atualizações simultâneas deixem a mesa ocupada por engano.
  select o.status into v_order_status
  from public.orders o
  where o.id = new.order_id and o.table_id is not null
  for update;

  if not found or v_order_status in ('entregue', 'cancelado') then
    return new;
  end if;

  if exists (
    select 1
    from public.order_items i
    where i.order_id = new.order_id
      and i.status not in ('entregue', 'cancelado')
  ) then
    return new;
  end if;

  select exists (
    select 1 from public.order_items i
    where i.order_id = new.order_id and i.status = 'entregue'
  ) into v_has_delivered_items;

  update public.orders
  set status = case when v_has_delivered_items then 'entregue'::public.order_status
                    else 'cancelado'::public.order_status end
  where id = new.order_id
    and status not in ('entregue', 'cancelado');

  return new;
end;
$$;

drop trigger if exists order_items_close_table_order on public.order_items;
create trigger order_items_close_table_order
  after update of status on public.order_items
  for each row
  execute function public.close_table_order_when_items_terminal();

revoke execute on function public.close_table_order_when_items_terminal()
  from public, anon, authenticated;

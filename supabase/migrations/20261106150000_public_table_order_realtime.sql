-- Broadcast only the order id on the QR-token topic. The QR token is already
-- the bearer capability used by the public ordering RPCs.
create or replace function public.broadcast_qr_order_item_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qr_token text;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return new;
    end if;
  end if;

  select t.qr_token into v_qr_token
  from public.orders o
  join public.tables t on t.id = o.table_id
  where o.id = new.order_id
    and t.qr_token is not null;

  if v_qr_token is null then
    return new;
  end if;

  begin
    perform realtime.send(
      payload := jsonb_build_object('order_id', new.order_id),
      event := 'order_status_updated',
      topic := 'qr-order:' || v_qr_token,
      private := false
    );
  exception when others then
    -- Realtime outages must never block kitchen updates or order creation.
    null;
  end;

  return new;
end;
$$;

revoke all on function public.broadcast_qr_order_item_status() from public, anon, authenticated;

drop trigger if exists order_items_broadcast_qr_insert on public.order_items;
drop trigger if exists order_items_broadcast_qr_status on public.order_items;
create trigger order_items_broadcast_qr_insert
  after insert on public.order_items
  for each row
  execute function public.broadcast_qr_order_item_status();

create trigger order_items_broadcast_qr_status
  after update of status on public.order_items
  for each row
  execute function public.broadcast_qr_order_item_status();

-- Compatibiliza os gatilhos do PDV com bancos onde a migration de divisao
-- de conta ainda nao criou payments.split_id.
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
  if v_paid + 0.01 >= v_order.total then
    update public.orders set payment_state = 'pago' where id = new.order_id;
    if v_order.table_id is not null and not exists (
      select 1 from public.order_items i
       where i.order_id = new.order_id and i.status not in ('entregue','cancelado')
    ) then
      update public.orders set status = 'entregue'
       where id = new.order_id and status not in ('entregue','cancelado');
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.sync_split_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_split_id uuid := nullif(to_jsonb(new)->>'split_id', '')::uuid;
  v_order_id uuid;
begin
  if v_split_id is null then return new; end if;
  update public.order_splits set status = new.status
   where id = v_split_id returning order_id into v_order_id;
  if v_order_id is not null then
    update public.orders set payment_state = case
      when (select coalesce(sum(amount), 0) from public.order_splits
        where order_id = v_order_id and status = 'pago') >=
        (select total from public.orders where id = v_order_id)
      then 'pago'::public.payment_status else 'pendente'::public.payment_status end
     where id = v_order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_sync_split_status on public.payments;
create trigger payments_sync_split_status
  after insert or update of status on public.payments
  for each row execute function public.sync_split_payment_status();

revoke all on function public.sync_pos_payment_state() from public, anon, authenticated;
revoke all on function public.sync_split_payment_status() from public, anon, authenticated;

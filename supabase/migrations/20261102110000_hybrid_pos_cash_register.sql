-- COZINFOOD PDV: caixa, recebimentos, leitura por codigo de barras e RPCs atomicas.
alter table public.products add column if not exists barcode text;
create unique index if not exists products_restaurant_barcode_uidx
  on public.products (restaurant_id, barcode) where barcode is not null and length(trim(barcode)) > 0;

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  operator_id uuid not null references public.profiles(id) on delete restrict,
  opening_amount numeric(12,2) not null default 0 check (opening_amount >= 0),
  closing_amount numeric(12,2) check (closing_amount is null or closing_amount >= 0),
  status text not null default 'aberto' check (status in ('aberto','fechado')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'aberto' and closed_at is null) or (status = 'fechado' and closed_at is not null))
);
create unique index if not exists cash_register_one_open_per_restaurant_uidx
  on public.cash_registers (restaurant_id) where status = 'aberto';
create index if not exists cash_registers_restaurant_opened_idx
  on public.cash_registers (restaurant_id, opened_at desc);

create table if not exists public.payments_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  cash_register_id uuid references public.cash_registers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  payment_id uuid unique references public.payments(id) on delete set null,
  operator_id uuid references public.profiles(id) on delete set null,
  payment_method text not null check (payment_method in ('dinheiro','pix','credito','debito')),
  value_paid numeric(12,2) not null check (value_paid > 0),
  cash_received numeric(12,2) not null default 0 check (cash_received >= 0),
  change_amount numeric(12,2) not null default 0 check (change_amount >= 0),
  status public.payment_status not null default 'pago',
  created_at timestamptz not null default now()
);
create index if not exists payments_log_register_created_idx
  on public.payments_log (cash_register_id, created_at desc);

alter table public.cash_registers enable row level security;
alter table public.payments_log enable row level security;
drop policy if exists cash_registers_staff on public.cash_registers;
create policy cash_registers_staff on public.cash_registers for all to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[]))
  with check (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[]));
drop policy if exists payments_log_staff on public.payments_log;
create policy payments_log_staff on public.payments_log for select to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[]));
drop policy if exists payments_log_insert_staff on public.payments_log;
create policy payments_log_insert_staff on public.payments_log for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[]));

create or replace function public.pos_open_cash_register(p_opening_amount numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_register public.cash_registers%rowtype;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','caixa']::public.app_role[]) then
    raise exception 'Apenas administrador ou caixa pode abrir o caixa';
  end if;
  if p_opening_amount is null or p_opening_amount < 0 then raise exception 'Valor de abertura invalido'; end if;
  insert into public.cash_registers (restaurant_id, operator_id, opening_amount)
  values (v_restaurant_id, auth.uid(), round(p_opening_amount, 2)) returning * into v_register;
  return to_jsonb(v_register);
exception when unique_violation then
  raise exception 'Ja existe um caixa aberto neste restaurante';
end;
$$;

create or replace function public.pos_close_cash_register(p_cash_register_id uuid, p_closing_amount numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_register public.cash_registers%rowtype;
begin
  if not public.has_role(array['admin','caixa']::public.app_role[]) then raise exception 'Sem permissao para fechar o caixa'; end if;
  if p_closing_amount is null or p_closing_amount < 0 then raise exception 'Informe o valor contado no fechamento'; end if;
  select * into v_register from public.cash_registers
  where id = p_cash_register_id and restaurant_id = public.current_restaurant_id() for update;
  if not found or v_register.status <> 'aberto' then raise exception 'Caixa aberto nao encontrado'; end if;
  if v_register.operator_id <> auth.uid() and not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Somente o operador responsavel ou administrador pode fechar este caixa';
  end if;
  update public.cash_registers set status = 'fechado', closing_amount = round(p_closing_amount, 2), closed_at = now()
  where id = p_cash_register_id returning * into v_register;
  return to_jsonb(v_register);
end;
$$;

create or replace function public.pos_save_order(
  p_order_type public.order_type,
  p_table_id uuid,
  p_order_id uuid,
  p_customer_name text,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_table_restaurant uuid;
  v_table_status public.table_status;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_item jsonb;
  v_addition jsonb;
  v_addition_row public.product_additions%rowtype;
  v_addition_quantity numeric(10,2);
  v_additions jsonb;
  v_product public.products%rowtype;
  v_fraction public.product_fractions%rowtype;
  v_fraction_id uuid;
  v_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_fraction_label text;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','caixa','garcom']::public.app_role[]) then
    raise exception 'Sem permissao para registrar vendas';
  end if;
  if p_order_type is null or p_order_type not in ('balcao','salao') then raise exception 'Tipo de venda invalido para o PDV'; end if;
  if p_order_type = 'salao' and p_table_id is null then raise exception 'Selecione uma mesa para atendimento no salao'; end if;
  if p_order_type = 'balcao' and p_table_id is not null then raise exception 'Venda de balcao nao pode estar vinculada a uma mesa'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 80 then
    raise exception 'Adicione de 1 a 80 itens ao pedido';
  end if;

  if p_table_id is not null then
    select restaurant_id, status into v_table_restaurant, v_table_status
    from public.tables where id = p_table_id for update;
    if not found or v_table_restaurant <> v_restaurant_id then raise exception 'Mesa nao encontrada neste restaurante'; end if;
    if v_table_status = 'reservada' then raise exception 'Esta mesa esta reservada'; end if;
  end if;

  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id and restaurant_id = v_restaurant_id for update;
    if not found or v_order.status in ('entregue','cancelado') then raise exception 'Comanda aberta nao encontrada'; end if;
    if v_order.order_type <> p_order_type or v_order.table_id is distinct from p_table_id then
      raise exception 'A comanda nao pertence ao modo ou mesa selecionada';
    end if;
    v_order_id := v_order.id;
  elsif p_table_id is not null then
    select * into v_order from public.orders
    where table_id = p_table_id and restaurant_id = v_restaurant_id and status not in ('entregue','cancelado')
    order by created_at desc limit 1 for update;
    if found then v_order_id := v_order.id; end if;
  end if;

  if v_order_id is null then
    insert into public.orders (restaurant_id, table_id, order_type, status, customer_name, created_by)
    values (v_restaurant_id, p_table_id, p_order_type, 'pendente', nullif(left(trim(coalesce(p_customer_name,'')),80),''), auth.uid())
    returning id into v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := coalesce(nullif(v_item->>'quantity','')::numeric, 1);
    if v_quantity <= 0 or v_quantity > 999 then raise exception 'Quantidade invalida no pedido'; end if;
    select * into v_product from public.products
    where id = (v_item->>'product_id')::uuid and restaurant_id = v_restaurant_id and active;
    if not found then raise exception 'Um produto nao esta mais disponivel'; end if;
    v_unit_price := v_product.base_price;
    v_fraction_label := null;
    v_additions := '[]'::jsonb;
    v_fraction_id := nullif(v_item->>'fraction_id','')::uuid;
    if v_fraction_id is not null then
      select * into v_fraction from public.product_fractions
      where id = v_fraction_id and product_id = v_product.id and active;
      if not found then raise exception 'Tamanho ou fracao nao esta mais disponivel'; end if;
      v_unit_price := v_fraction.price;
      v_fraction_label := v_fraction.name;
    elsif v_product.accepts_fractions and exists (
      select 1 from public.product_fractions pf where pf.product_id = v_product.id and pf.active
    ) then
      raise exception 'Selecione o tamanho de %', v_product.name;
    end if;
    if v_item ? 'additions' and jsonb_typeof(v_item->'additions') is distinct from 'array' then
      raise exception 'Formato de adicionais invalido';
    end if;
    for v_addition in select value from jsonb_array_elements(coalesce(v_item->'additions','[]'::jsonb)) loop
      select * into v_addition_row from public.product_additions
      where id = (v_addition->>'id')::uuid and restaurant_id = v_restaurant_id and active;
      if not found then raise exception 'Um adicional nao esta mais disponivel'; end if;
      v_addition_quantity := coalesce(nullif(v_addition->>'quantity','')::numeric,1);
      if v_addition_quantity <= 0 or v_addition_quantity > 10 then raise exception 'Quantidade de adicional invalida'; end if;
      v_unit_price := v_unit_price + v_addition_row.price * v_addition_quantity;
      v_additions := v_additions || jsonb_build_array(jsonb_build_object('id',v_addition_row.id,'quantity',v_addition_quantity));
    end loop;
    insert into public.order_items (order_id, product_id, name, quantity, unit_price, line_total, fraction_label, additions, notes, destination_sector)
    values (v_order_id, v_product.id, v_product.name, v_quantity, v_unit_price, round(v_unit_price * v_quantity, 2), v_fraction_label, v_additions,
      nullif(left(trim(coalesce(v_item->>'notes','')),300),''), v_product.destination_sector);
  end loop;

  update public.orders o set
    payment_state = case when coalesce((select sum(p.amount) from public.payments p where p.order_id=o.id and p.status='pago'),0) + 0.01 >= o.total
      then 'pago'::public.payment_status else 'pendente'::public.payment_status end,
    payment_method = case when coalesce((select sum(p.amount) from public.payments p where p.order_id=o.id and p.status='pago'),0) + 0.01 >= o.total
      then o.payment_method else null end
  where o.id = v_order_id;

  select * into v_order from public.orders where id = v_order_id;
  return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'status',v_order.status,'total',v_order.total,'table_id',v_order.table_id);
end;
$$;

create or replace function public.pos_finalize_order(p_order_id uuid, p_cash_register_id uuid, p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_order public.orders%rowtype;
  v_register public.cash_registers%rowtype;
  v_payment jsonb;
  v_method text;
  v_amount numeric(12,2);
  v_received numeric(12,2);
  v_change numeric(12,2);
  v_due numeric(12,2);
  v_sum numeric(12,2) := 0;
  v_methods text[] := '{}';
  v_total_change numeric(12,2) := 0;
  v_id uuid;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','caixa']::public.app_role[]) then raise exception 'Sem permissao para receber pagamentos'; end if;
  select * into v_order from public.orders where id = p_order_id and restaurant_id = v_restaurant_id for update;
  if not found or v_order.status = 'cancelado' then raise exception 'Pedido nao encontrado ou cancelado'; end if;
  select * into v_register from public.cash_registers where id = p_cash_register_id and restaurant_id = v_restaurant_id for update;
  if not found or v_register.status <> 'aberto' then raise exception 'Abra o caixa antes de receber pagamentos'; end if;
  if v_register.operator_id <> auth.uid() and not public.has_role(array['admin']::public.app_role[]) then raise exception 'Caixa pertence a outro operador'; end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 8 then raise exception 'Informe as formas de pagamento'; end if;

  select round(greatest(0, v_order.total - coalesce(sum(p.amount),0)),2) into v_due
  from public.payments p where p.order_id = v_order.id and p.status = 'pago';
  if v_due <= 0 then raise exception 'Nao ha saldo em aberto para este pedido'; end if;

  for v_payment in select value from jsonb_array_elements(p_payments) loop
    v_method := v_payment->>'method';
    v_amount := round(coalesce(nullif(v_payment->>'amount','')::numeric,0),2);
    v_received := round(coalesce(nullif(v_payment->>'cash_received','')::numeric,v_amount),2);
    if v_method is null or v_method not in ('cash','credit_card','debit_card') or v_amount <= 0 then raise exception 'Forma ou valor de pagamento invalido'; end if;
    if v_method <> 'cash' and abs(v_received-v_amount) > 0.01 then raise exception 'Somente dinheiro pode gerar troco'; end if;
    if v_method = 'cash' and v_received < v_amount then raise exception 'O valor recebido em dinheiro e menor que a parcela'; end if;
    v_change := case when v_method = 'cash' then round(v_received-v_amount,2) else 0 end;
    insert into public.payments (restaurant_id, order_id, amount, method, status, provider, paid_at)
    values (v_restaurant_id, v_order.id, v_amount, v_method, 'pago', 'pos', now()) returning id into v_id;
    insert into public.payments_log (restaurant_id, cash_register_id, order_id, payment_id, operator_id, payment_method, value_paid, cash_received, change_amount, status)
    values (v_restaurant_id, v_register.id, v_order.id, v_id, auth.uid(),
      case v_method when 'cash' then 'dinheiro' when 'credit_card' then 'credito' else 'debito' end,
      v_amount, case when v_method = 'cash' then v_received else v_amount end, v_change, 'pago');
    v_sum := v_sum + v_amount;
    v_total_change := v_total_change + v_change;
    if not (v_method = any(v_methods)) then v_methods := array_append(v_methods,v_method); end if;
  end loop;
  if abs(v_sum-v_due) > 0.01 then raise exception 'A soma dos pagamentos (%) precisa corresponder ao saldo (%)',v_sum,v_due; end if;

  update public.orders set payment_state = 'pago',
    payment_method = case when cardinality(v_methods)=1 then v_methods[1] else 'mixed' end
  where id = v_order.id returning * into v_order;
  if v_order.table_id is not null and not exists (
    select 1 from public.order_items i where i.order_id = v_order.id and i.status not in ('entregue','cancelado')
  ) then
    update public.orders set status = 'entregue' where id = v_order.id and status not in ('entregue','cancelado') returning * into v_order;
  end if;
  return jsonb_build_object('order_id',v_order.id,'payment_state',v_order.payment_state,'status',v_order.status,'total',v_order.total,'change',v_total_change);
end;
$$;

create or replace function public.sync_pos_payment_state()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_paid numeric(12,2);
begin
  if new.order_id is null or new.split_id is not null then return new; end if;
  update public.payments_log set status = new.status where payment_id = new.id;
  if new.status <> 'pago' then return new; end if;
  select * into v_order from public.orders where id = new.order_id for update;
  if not found then return new; end if;
  select coalesce(sum(amount),0) into v_paid from public.payments where order_id = new.order_id and status = 'pago';
  if v_paid + 0.01 >= v_order.total then
    update public.orders set payment_state = 'pago' where id = new.order_id;
    if v_order.table_id is not null and not exists (
      select 1 from public.order_items i where i.order_id = new.order_id and i.status not in ('entregue','cancelado')
    ) then
      update public.orders set status = 'entregue' where id = new.order_id and status not in ('entregue','cancelado');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists payments_sync_pos_order on public.payments;
create trigger payments_sync_pos_order after insert or update of status on public.payments
  for each row execute function public.sync_pos_payment_state();

-- Mantem historico do balcao finalizado pelo KDS; para mesa, o mesmo status
-- tambem aciona o trigger existente de liberacao da mesa.
create or replace function public.close_table_order_when_items_terminal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order_status public.order_status;
  v_order_type public.order_type;
  v_table_id uuid;
  v_has_delivered_items boolean;
begin
  if new.status not in ('entregue','cancelado') or old.status is not distinct from new.status then return new; end if;
  select o.status,o.order_type,o.table_id into v_order_status,v_order_type,v_table_id
  from public.orders o where o.id=new.order_id for update;
  if not found or v_order_status in ('entregue','cancelado') then return new; end if;
  if v_table_id is null and v_order_type <> 'balcao' then return new; end if;
  if exists(select 1 from public.order_items i where i.order_id=new.order_id and i.status not in ('entregue','cancelado')) then return new; end if;
  select exists(select 1 from public.order_items i where i.order_id=new.order_id and i.status='entregue') into v_has_delivered_items;
  update public.orders set status=case when v_has_delivered_items then 'entregue'::public.order_status else 'cancelado'::public.order_status end
  where id=new.order_id and status not in ('entregue','cancelado');
  return new;
end;
$$;
drop trigger if exists order_items_close_table_order on public.order_items;
create trigger order_items_close_table_order after update of status on public.order_items
  for each row execute function public.close_table_order_when_items_terminal();

revoke all on function public.pos_open_cash_register(numeric) from public, anon;
revoke all on function public.pos_close_cash_register(uuid,numeric) from public, anon;
revoke all on function public.pos_save_order(public.order_type,uuid,uuid,text,jsonb) from public, anon;
revoke all on function public.pos_finalize_order(uuid,uuid,jsonb) from public, anon;
revoke all on function public.sync_pos_payment_state() from public, anon, authenticated;
revoke execute on function public.close_table_order_when_items_terminal() from public, anon, authenticated;
grant execute on function public.pos_open_cash_register(numeric) to authenticated;
grant execute on function public.pos_close_cash_register(uuid,numeric) to authenticated;
grant execute on function public.pos_save_order(public.order_type,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.pos_finalize_order(uuid,uuid,jsonb) to authenticated;

do $$ begin alter publication supabase_realtime add table public.cash_registers;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.payments_log;
exception when duplicate_object then null; end $$;

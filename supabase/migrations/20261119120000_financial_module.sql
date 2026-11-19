-- COZINFOOD financial module: shifts, blind close, cash movements and payables.
-- Run this migration in the Supabase SQL Editor before publishing the UI.

create extension if not exists pgcrypto;

do $$ begin
  create type public.cash_movement_type as enum ('venda','sangria','reforco','estorno');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cash_payment_method as enum ('dinheiro','pix','credito','debito','voucher');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.financial_entry_type as enum ('receita','despesa');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.accounts_payable_status as enum ('pendente','pago','vencido','cancelado');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.financial_operator_function as enum ('caixa','cozinheiro','pizzaiolo');
exception when duplicate_object then null; end $$;

-- The application calls a restaurant a company in finance screens; restaurant_id
-- references the existing restaurants table and is the tenant boundary.
alter table public.cash_registers
  add column if not exists expected_amount numeric(12,2) not null default 0,
  add column if not exists difference numeric(12,2),
  add column if not exists justification text,
  add column if not exists closing_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists expected_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists difference_breakdown jsonb not null default '{}'::jsonb;

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  type public.financial_entry_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, name, type)
);
create index if not exists financial_categories_restaurant_type_idx
  on public.financial_categories (restaurant_id, type, active, name);

create table if not exists public.accounts_payable (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid not null references public.financial_categories(id) on delete restrict,
  installment_group_id uuid not null default gen_random_uuid(),
  installment_number integer not null default 1 check (installment_number > 0),
  installment_count integer not null default 1 check (installment_count > 0),
  supplier_name text not null check (length(trim(supplier_name)) between 2 and 120),
  description text not null check (length(trim(description)) between 2 and 240),
  amount numeric(12,2) not null check (amount > 0),
  due_date date not null,
  payment_date date,
  status public.accounts_payable_status not null default 'pendente',
  payment_method public.cash_payment_method,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (installment_number <= installment_count),
  check ((status = 'pago' and payment_date is not null) or status <> 'pago')
);
create index if not exists accounts_payable_restaurant_due_idx
  on public.accounts_payable (restaurant_id, due_date, status);
create index if not exists accounts_payable_restaurant_paid_idx
  on public.accounts_payable (restaurant_id, payment_date desc) where status = 'pago';
create index if not exists accounts_payable_group_idx
  on public.accounts_payable (installment_group_id, installment_number);

create table if not exists public.financial_operators (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  nome text not null check (length(trim(nome)) between 2 and 80),
  funcao public.financial_operator_function not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, profile_id)
);
create index if not exists financial_operators_restaurant_idx
  on public.financial_operators (restaurant_id, active, funcao);

create table if not exists public.restaurant_finance_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  manager_password_hash text,
  discrepancy_tolerance numeric(12,2) not null default 1.00 check (discrepancy_tolerance >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  cash_register_id uuid not null references public.cash_registers(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  source_payment_log_id uuid unique references public.payments_log(id) on delete set null,
  category_id uuid references public.financial_categories(id) on delete set null,
  type public.cash_movement_type not null,
  payment_method public.cash_payment_method not null default 'dinheiro',
  amount numeric(12,2) not null check (amount > 0),
  description text not null check (length(trim(description)) between 2 and 240),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_register_created_idx
  on public.cash_movements (cash_register_id, created_at desc);
create index if not exists cash_movements_restaurant_created_idx
  on public.cash_movements (restaurant_id, created_at desc);

insert into public.financial_categories (restaurant_id, name, type)
select r.id, seed.name, seed.type
from public.restaurants r
cross join (values
  ('Insumos / Mercado', 'despesa'::public.financial_entry_type),
  ('Embalagens', 'despesa'::public.financial_entry_type),
  ('Energia / Água', 'despesa'::public.financial_entry_type),
  ('Folha / Motoboys', 'despesa'::public.financial_entry_type),
  ('Impostos', 'despesa'::public.financial_entry_type),
  ('Equipamentos / Financiamentos', 'despesa'::public.financial_entry_type),
  ('Vendas', 'receita'::public.financial_entry_type),
  ('Outras receitas', 'receita'::public.financial_entry_type)
) as seed(name, type)
on conflict (restaurant_id, name, type) do nothing;

create or replace function public.seed_financial_categories_for_restaurant()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.financial_categories (restaurant_id,name,type) values
    (new.id,'Insumos / Mercado','despesa'),(new.id,'Embalagens','despesa'),(new.id,'Energia / Água','despesa'),
    (new.id,'Folha / Motoboys','despesa'),(new.id,'Impostos','despesa'),(new.id,'Equipamentos / Financiamentos','despesa'),
    (new.id,'Vendas','receita'),(new.id,'Outras receitas','receita')
  on conflict (restaurant_id,name,type) do nothing;
  return new;
end;
$$;
drop trigger if exists restaurants_seed_financial_categories on public.restaurants;
create trigger restaurants_seed_financial_categories after insert on public.restaurants
  for each row execute function public.seed_financial_categories_for_restaurant();

alter table public.cash_registers enable row level security;
alter table public.cash_movements enable row level security;
alter table public.financial_categories enable row level security;
alter table public.accounts_payable enable row level security;
alter table public.financial_operators enable row level security;
alter table public.restaurant_finance_settings enable row level security;

drop policy if exists cash_registers_staff on public.cash_registers;
drop policy if exists cash_registers_read_staff on public.cash_registers;
create policy cash_registers_read_staff on public.cash_registers for select to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[]));
drop policy if exists payments_log_staff on public.payments_log;
drop policy if exists payments_log_admin_read on public.payments_log;
create policy payments_log_admin_read on public.payments_log for select to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
drop policy if exists cash_movements_read_admin on public.cash_movements;
create policy cash_movements_read_admin on public.cash_movements for select to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
drop policy if exists financial_categories_read_staff on public.financial_categories;
drop policy if exists financial_categories_manage_admin on public.financial_categories;
create policy financial_categories_read_staff on public.financial_categories for select to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[]));
create policy financial_categories_manage_admin on public.financial_categories for all to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]))
  with check (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
drop policy if exists accounts_payable_admin on public.accounts_payable;
create policy accounts_payable_admin on public.accounts_payable for all to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]))
  with check (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
drop policy if exists financial_operators_admin on public.financial_operators;
create policy financial_operators_admin on public.financial_operators for all to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]))
  with check (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
drop policy if exists restaurant_finance_settings_admin on public.restaurant_finance_settings;
create policy restaurant_finance_settings_admin on public.restaurant_finance_settings for all to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]))
  with check (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));

-- Cashiers may read safe shift metadata only. Expected balances and audit fields
-- are returned exclusively by the close RPC after the blind count is submitted.
revoke all on public.cash_registers from anon, authenticated;
grant select (id, restaurant_id, operator_id, opening_amount, status, opened_at, closed_at, created_at)
  on public.cash_registers to authenticated;
revoke all on public.cash_movements from anon, authenticated;
grant select on public.cash_movements to authenticated;
revoke all on public.financial_categories from anon, authenticated;
grant select, insert, update, delete on public.financial_categories to authenticated;
revoke all on public.accounts_payable from anon, authenticated;
grant select, insert, update, delete on public.accounts_payable to authenticated;
revoke all on public.financial_operators from anon, authenticated;
grant select, insert, update, delete on public.financial_operators to authenticated;
revoke all on public.restaurant_finance_settings from anon, authenticated;
revoke all on public.payments_log from anon, authenticated;
grant select on public.payments_log to authenticated;

create or replace function public.initialize_cash_expected_amount()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.expected_amount := round(coalesce(new.opening_amount, 0), 2);
  return new;
end;
$$;
drop trigger if exists cash_register_expected_init on public.cash_registers;
create trigger cash_register_expected_init before insert on public.cash_registers
  for each row execute function public.initialize_cash_expected_amount();

create or replace function public.refresh_cash_register_expected(p_register_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expected numeric(12,2);
begin
  select round(r.opening_amount + coalesce(sum(
    case when m.type in ('venda','reforco') then m.amount else -m.amount end
  ), 0), 2) into v_expected
  from public.cash_registers r
  left join public.cash_movements m on m.cash_register_id = r.id
  where r.id = p_register_id
  group by r.id, r.opening_amount;
  update public.cash_registers set expected_amount = greatest(0, coalesce(v_expected, opening_amount))
  where id = p_register_id and status = 'aberto';
end;
$$;

create or replace function public.cash_movements_refresh_register()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_cash_register_expected(old.cash_register_id);
    return old;
  elsif tg_op = 'UPDATE' then
    perform public.refresh_cash_register_expected(old.cash_register_id);
    perform public.refresh_cash_register_expected(new.cash_register_id);
    return new;
  else
    perform public.refresh_cash_register_expected(new.cash_register_id);
    return new;
  end if;
end;
$$;
drop trigger if exists cash_movements_refresh_expected on public.cash_movements;
create trigger cash_movements_refresh_expected after insert or update or delete on public.cash_movements
  for each row execute function public.cash_movements_refresh_register();

create or replace function public.sync_cash_movement_from_payment_log()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_method public.cash_payment_method;
begin
  if new.cash_register_id is null then return new; end if;
  v_method := case new.payment_method
    when 'dinheiro' then 'dinheiro'::public.cash_payment_method
    when 'pix' then 'pix'::public.cash_payment_method
    when 'credito' then 'credito'::public.cash_payment_method
    when 'debito' then 'debito'::public.cash_payment_method
    else 'voucher'::public.cash_payment_method
  end;
  if new.status = 'pago' then
    insert into public.cash_movements (restaurant_id, cash_register_id, order_id, source_payment_log_id, type, payment_method, amount, description, created_by)
    values (new.restaurant_id, new.cash_register_id, new.order_id, new.id, 'venda', v_method, new.value_paid,
      'Venda PDV' || case when new.order_id is null then '' else ' · pedido ' || left(new.order_id::text, 8) end, new.operator_id)
    on conflict (source_payment_log_id) do update set
      type = 'venda', payment_method = excluded.payment_method, amount = excluded.amount,
      cash_register_id = excluded.cash_register_id, restaurant_id = excluded.restaurant_id;
  else
    update public.cash_movements set type = 'estorno', payment_method = v_method, amount = new.value_paid
    where source_payment_log_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists payments_log_sync_cash_movement on public.payments_log;
create trigger payments_log_sync_cash_movement after insert or update
  on public.payments_log for each row execute function public.sync_cash_movement_from_payment_log();

insert into public.cash_movements (restaurant_id, cash_register_id, order_id, source_payment_log_id, type, payment_method, amount, description, created_by)
select pl.restaurant_id, pl.cash_register_id, pl.order_id, pl.id, 'venda', pl.payment_method::public.cash_payment_method,
  pl.value_paid, 'Venda PDV · pedido ' || left(pl.order_id::text, 8), pl.operator_id
from public.payments_log pl
where pl.status = 'pago' and pl.cash_register_id is not null
  and pl.payment_method in ('dinheiro','pix','credito','debito')
on conflict (source_payment_log_id) do nothing;
select public.refresh_cash_register_expected(id) from public.cash_registers where status = 'aberto';
update public.cash_registers r set
  expected_amount = round(r.opening_amount + coalesce((select sum(case when m.type in ('venda','reforco') then m.amount else -m.amount end)
    from public.cash_movements m where m.cash_register_id=r.id and m.payment_method='dinheiro'),0),2),
  difference = case when r.closing_amount is null then null else round(r.closing_amount - (r.opening_amount + coalesce((select sum(case when m.type in ('venda','reforco') then m.amount else -m.amount end)
    from public.cash_movements m where m.cash_register_id=r.id and m.payment_method='dinheiro'),0)),2) end
where r.status='fechado';

create or replace function public.get_finance_manager_status()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_row public.restaurant_finance_settings%rowtype;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','caixa']::public.app_role[]) then raise exception 'Sem permissao'; end if;
  select * into v_row from public.restaurant_finance_settings where restaurant_id = v_restaurant_id;
  return jsonb_build_object('configured', v_row.manager_password_hash is not null,
    'discrepancy_tolerance', coalesce(v_row.discrepancy_tolerance, 1.00));
end;
$$;

create or replace function public.set_finance_manager_password(p_password text, p_tolerance numeric default 1.00)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem configurar a senha de gerente'; end if;
  if length(coalesce(p_password,'')) < 8 then raise exception 'Use uma senha de gerente com pelo menos 8 caracteres'; end if;
  if p_tolerance is null or p_tolerance < 0 or p_tolerance > 100 then raise exception 'Tolerancia invalida'; end if;
  insert into public.restaurant_finance_settings (restaurant_id, manager_password_hash, discrepancy_tolerance, updated_by, updated_at)
  values (v_restaurant_id, crypt(p_password, gen_salt('bf')), round(p_tolerance,2), auth.uid(), now())
  on conflict (restaurant_id) do update set manager_password_hash = excluded.manager_password_hash,
    discrepancy_tolerance = excluded.discrepancy_tolerance, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('configured', true, 'discrepancy_tolerance', round(p_tolerance,2));
end;
$$;

create or replace function public.open_finance_cash_register(p_opening_amount numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_register public.cash_registers%rowtype;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','caixa']::public.app_role[]) then raise exception 'Apenas administrador ou caixa pode abrir o caixa'; end if;
  if p_opening_amount is null or p_opening_amount < 0 then raise exception 'Valor de abertura invalido'; end if;
  insert into public.cash_registers (restaurant_id, operator_id, opening_amount)
  values (v_restaurant_id, auth.uid(), round(p_opening_amount,2)) returning * into v_register;
  return jsonb_build_object('id',v_register.id,'restaurant_id',v_register.restaurant_id,'operator_id',v_register.operator_id,
    'opening_amount',v_register.opening_amount,'status',v_register.status,'opened_at',v_register.opened_at);
exception when unique_violation then raise exception 'Ja existe um caixa aberto neste restaurante';
end;
$$;

create or replace function public.pos_open_cash_register(p_opening_amount numeric default 0)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public.open_finance_cash_register(p_opening_amount);
$$;

create or replace function public.create_cash_movement(
  p_cash_register_id uuid, p_type public.cash_movement_type, p_amount numeric,
  p_description text, p_category_id uuid default null, p_manager_password text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_register public.cash_registers%rowtype;
  v_settings public.restaurant_finance_settings%rowtype;
  v_category public.financial_categories%rowtype;
  v_movement public.cash_movements%rowtype;
  v_available_cash numeric(12,2);
begin
  if v_restaurant_id is null or not public.has_role(array['admin','caixa']::public.app_role[]) then raise exception 'Sem permissao para movimentar o caixa'; end if;
  if p_type not in ('sangria','reforco') then raise exception 'Tipo de movimentacao manual invalido'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'Informe um valor valido'; end if;
  if length(trim(coalesce(p_description,''))) not between 3 and 240 then raise exception 'Descreva o motivo da movimentacao'; end if;
  select * into v_register from public.cash_registers where id=p_cash_register_id and restaurant_id=v_restaurant_id for update;
  if not found or v_register.status <> 'aberto' then raise exception 'Caixa aberto nao encontrado'; end if;
  if v_register.operator_id <> auth.uid() and not public.has_role(array['admin']::public.app_role[]) then raise exception 'Este caixa pertence a outro operador'; end if;
  if p_type = 'sangria' then
    select round(v_register.opening_amount + coalesce(sum(case when m.type in ('venda','reforco') then m.amount else -m.amount end),0),2)
      into v_available_cash from public.cash_movements m where m.cash_register_id=v_register.id and m.payment_method='dinheiro';
    if p_amount > greatest(v_available_cash,0) then raise exception 'A sangria excede o dinheiro disponivel no caixa'; end if;
  end if;
  if p_type = 'sangria' then
    select * into v_settings from public.restaurant_finance_settings where restaurant_id=v_restaurant_id;
    if v_settings.manager_password_hash is null then raise exception 'O administrador precisa configurar uma senha de gerente antes de autorizar sangrias'; end if;
    if coalesce(p_manager_password,'') = '' or crypt(p_manager_password, v_settings.manager_password_hash) <> v_settings.manager_password_hash then
      raise exception 'Senha de gerente incorreta';
    end if;
  end if;
  if p_category_id is not null then
    select * into v_category from public.financial_categories where id=p_category_id and restaurant_id=v_restaurant_id and active;
    if not found or v_category.type <> 'despesa' then raise exception 'Selecione uma categoria de despesa valida'; end if;
  end if;
  insert into public.cash_movements (restaurant_id,cash_register_id,category_id,type,payment_method,amount,description,created_by)
  values (v_restaurant_id,p_cash_register_id,p_category_id,p_type,'dinheiro',round(p_amount,2),trim(p_description),auth.uid()) returning * into v_movement;
  return to_jsonb(v_movement);
end;
$$;

create or replace function public.close_cash_register_blind(
  p_cash_register_id uuid, p_counted_breakdown jsonb, p_justification text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_register public.cash_registers%rowtype;
  v_method public.cash_payment_method;
  v_settings public.restaurant_finance_settings%rowtype;
  v_expected_breakdown jsonb := '{}'::jsonb;
  v_difference_breakdown jsonb := '{}'::jsonb;
  v_counted numeric(12,2);
  v_expected numeric(12,2);
  v_difference numeric(12,2);
  v_total_counted numeric(12,2) := 0;
  v_total_expected numeric(12,2) := 0;
  v_total_difference numeric(12,2);
  v_requires_justification boolean := false;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','caixa']::public.app_role[]) then raise exception 'Sem permissao para fechar o caixa'; end if;
  if p_counted_breakdown is null or jsonb_typeof(p_counted_breakdown) <> 'object' then raise exception 'Informe a contagem por forma de pagamento'; end if;
  select * into v_register from public.cash_registers where id=p_cash_register_id and restaurant_id=v_restaurant_id for update;
  if not found or v_register.status <> 'aberto' then raise exception 'Caixa aberto nao encontrado'; end if;
  if v_register.operator_id <> auth.uid() and not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente o operador responsavel ou administrador pode fechar este caixa'; end if;
  select * into v_settings from public.restaurant_finance_settings where restaurant_id=v_restaurant_id;
  for v_method in select unnest(enum_range(null::public.cash_payment_method)) loop
    if p_counted_breakdown->>v_method::text is null then raise exception 'Informe a contagem de %',v_method; end if;
    v_counted := round((p_counted_breakdown->>v_method::text)::numeric,2);
    if v_counted < 0 then raise exception 'A contagem nao pode ser negativa'; end if;
    select round(coalesce(sum(case when m.type in ('venda','reforco') then m.amount else -m.amount end),0),2)
      into v_expected from public.cash_movements m where m.cash_register_id=v_register.id and m.payment_method=v_method;
    if v_method = 'dinheiro' then v_expected := v_expected + v_register.opening_amount; end if;
    v_difference := round(v_counted-v_expected,2);
    v_total_counted := v_total_counted+v_counted;
    v_total_expected := v_total_expected+v_expected;
    if abs(v_difference) > coalesce(v_settings.discrepancy_tolerance,1.00) then v_requires_justification := true; end if;
    v_expected_breakdown := jsonb_set(v_expected_breakdown,array[v_method::text],to_jsonb(v_expected),true);
    v_difference_breakdown := jsonb_set(v_difference_breakdown,array[v_method::text],to_jsonb(v_difference),true);
  end loop;
  v_total_difference := round(v_total_counted-v_total_expected,2);
  if abs(v_total_difference) > coalesce(v_settings.discrepancy_tolerance,1.00) then v_requires_justification := true; end if;
  if v_requires_justification and length(trim(coalesce(p_justification,''))) < 5 then
    raise exception 'Ha diferenca acima da tolerancia. Informe uma justificativa de pelo menos 5 caracteres';
  end if;
  update public.cash_registers set status='fechado', closed_at=now(), closing_amount=v_total_counted,
    expected_amount=v_total_expected, difference=v_total_difference,
    justification=nullif(trim(coalesce(p_justification,'')),''), closing_breakdown=p_counted_breakdown,
    expected_breakdown=v_expected_breakdown, difference_breakdown=v_difference_breakdown
  where id=v_register.id returning * into v_register;
  return jsonb_build_object('register_id',v_register.id,'status',v_register.status,'closing_amount',v_total_counted,
    'expected_amount',v_total_expected,'difference',v_total_difference,'justification',v_register.justification,
    'closing_breakdown',p_counted_breakdown,'expected_breakdown',v_expected_breakdown,'difference_breakdown',v_difference_breakdown,
    'discrepancy_tolerance',coalesce(v_settings.discrepancy_tolerance,1.00));
end;
$$;

create or replace function public.list_cash_register_audits(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_audits jsonb;
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem consultar auditorias de caixa'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'operator_name',q.operator_name,'opened_at',q.opened_at,'closed_at',q.closed_at,
    'opening_amount',q.opening_amount,'expected_amount',q.expected_amount,'closing_amount',q.closing_amount,
    'difference',q.difference,'justification',q.justification,'closing_breakdown',q.closing_breakdown,
    'expected_breakdown',q.expected_breakdown,'difference_breakdown',q.difference_breakdown
  ) order by q.closed_at desc),'[]'::jsonb) into v_audits
  from (
    select r.id,coalesce(p.full_name,'Operador') as operator_name,r.opened_at,r.closed_at,r.opening_amount,
      r.expected_amount,r.closing_amount,r.difference,r.justification,r.closing_breakdown,r.expected_breakdown,r.difference_breakdown
    from public.cash_registers r left join public.profiles p on p.id=r.operator_id
    where r.restaurant_id=v_restaurant_id and r.status='fechado'
    order by r.closed_at desc limit greatest(1,least(coalesce(p_limit,20),100))
  ) q;
  return v_audits;
end;
$$;

-- The legacy one-number close is disabled so all shift closures use the blind audit.
create or replace function public.pos_close_cash_register(p_cash_register_id uuid, p_closing_amount numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'Use o fechamento cego do modulo Financeiro';
end;
$$;

create or replace function public.create_accounts_payable_installments(
  p_category_id uuid, p_supplier_name text, p_description text, p_total_amount numeric,
  p_first_due_date date, p_installment_count integer default 1
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_category public.financial_categories%rowtype;
  v_group_id uuid := gen_random_uuid();
  v_base numeric(12,2);
  v_amount numeric(12,2);
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  i integer;
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem cadastrar contas'; end if;
  if length(trim(coalesce(p_supplier_name,''))) not between 2 and 120 then raise exception 'Informe o fornecedor'; end if;
  if length(trim(coalesce(p_description,''))) not between 2 and 240 then raise exception 'Informe a descricao da conta'; end if;
  if p_total_amount is null or p_total_amount <= 0 or p_total_amount > 10000000 then raise exception 'Informe um valor total valido'; end if;
  if p_first_due_date is null then raise exception 'Informe a data de vencimento'; end if;
  if p_installment_count is null or p_installment_count not between 1 and 120 then raise exception 'A quantidade de parcelas deve ficar entre 1 e 120'; end if;
  select * into v_category from public.financial_categories where id=p_category_id and restaurant_id=v_restaurant_id and active and type='despesa';
  if not found then raise exception 'Selecione uma categoria de despesa valida'; end if;
  v_base := trunc(round(p_total_amount,2)/p_installment_count,2);
  for i in 1..p_installment_count loop
    v_amount := case when i=p_installment_count then round(p_total_amount,2)-v_base*(p_installment_count-1) else v_base end;
    insert into public.accounts_payable (restaurant_id,category_id,installment_group_id,installment_number,installment_count,
      supplier_name,description,amount,due_date,created_by)
    values (v_restaurant_id,p_category_id,v_group_id,i,p_installment_count,trim(p_supplier_name),trim(p_description),v_amount,
      (p_first_due_date + make_interval(months => i-1))::date,auth.uid()) returning to_jsonb(accounts_payable) into v_item;
    v_result := v_result || jsonb_build_array(v_item);
  end loop;
  return v_result;
end;
$$;

create or replace function public.pay_accounts_payable(p_account_id uuid,p_payment_date date,p_payment_method public.cash_payment_method)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_row public.accounts_payable%rowtype;
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem dar baixa em contas'; end if;
  if p_payment_date is null or p_payment_method is null then raise exception 'Informe a data e a forma de pagamento'; end if;
  update public.accounts_payable set status='pago', payment_date=p_payment_date, payment_method=p_payment_method
  where id=p_account_id and restaurant_id=v_restaurant_id and status in ('pendente','vencido') returning * into v_row;
  if not found then raise exception 'Conta nao encontrada ou ja baixada'; end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.refresh_accounts_payable_status()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_count integer;
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem atualizar contas'; end if;
  update public.accounts_payable set status=case when due_date < current_date then 'vencido'::public.accounts_payable_status else 'pendente'::public.accounts_payable_status end
  where restaurant_id=v_restaurant_id and status in ('pendente','vencido');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.list_financial_operators()
returns setof public.financial_operators language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem consultar operadores'; end if;
  return query select * from public.financial_operators where restaurant_id=public.current_restaurant_id() order by nome;
end;
$$;

revoke all on function public.refresh_cash_register_expected(uuid) from public, anon, authenticated;
revoke all on function public.initialize_cash_expected_amount() from public, anon, authenticated;
revoke all on function public.cash_movements_refresh_register() from public, anon, authenticated;
revoke all on function public.sync_cash_movement_from_payment_log() from public, anon, authenticated;
revoke all on function public.seed_financial_categories_for_restaurant() from public, anon, authenticated;
revoke all on function public.get_finance_manager_status() from public, anon;
revoke all on function public.set_finance_manager_password(text,numeric) from public, anon;
revoke all on function public.open_finance_cash_register(numeric) from public, anon;
revoke all on function public.create_cash_movement(uuid,public.cash_movement_type,numeric,text,uuid,text) from public, anon;
revoke all on function public.close_cash_register_blind(uuid,jsonb,text) from public, anon;
revoke all on function public.list_cash_register_audits(integer) from public, anon;
revoke all on function public.pos_open_cash_register(numeric) from public, anon;
revoke all on function public.pos_close_cash_register(uuid,numeric) from public, anon, authenticated;
revoke all on function public.create_accounts_payable_installments(uuid,text,text,numeric,date,integer) from public, anon;
revoke all on function public.pay_accounts_payable(uuid,date,public.cash_payment_method) from public, anon;
revoke all on function public.refresh_accounts_payable_status() from public, anon;
revoke all on function public.list_financial_operators() from public, anon;
grant execute on function public.get_finance_manager_status() to authenticated;
grant execute on function public.set_finance_manager_password(text,numeric) to authenticated;
grant execute on function public.open_finance_cash_register(numeric) to authenticated;
grant execute on function public.create_cash_movement(uuid,public.cash_movement_type,numeric,text,uuid,text) to authenticated;
grant execute on function public.close_cash_register_blind(uuid,jsonb,text) to authenticated;
grant execute on function public.list_cash_register_audits(integer) to authenticated;
grant execute on function public.pos_open_cash_register(numeric) to authenticated;
grant execute on function public.create_accounts_payable_installments(uuid,text,text,numeric,date,integer) to authenticated;
grant execute on function public.pay_accounts_payable(uuid,date,public.cash_payment_method) to authenticated;
grant execute on function public.refresh_accounts_payable_status() to authenticated;
grant execute on function public.list_financial_operators() to authenticated;

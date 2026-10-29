-- COZINFOOD - execute no SQL Editor do Supabase (projeto novo).
create extension if not exists pgcrypto;
create type public.app_role as enum ('admin','garcom','cozinha','caixa','motoboy');
create type public.table_status as enum ('livre','ocupada','aguardando_conta','reservada');
create type public.order_type as enum ('salao','delivery','balcao','qr');
create type public.order_status as enum ('pendente','em_preparo','pronto','entregue','cancelado');
create type public.payment_status as enum ('pendente','aguardando','pago','falhou','estornado','cancelado');
create type public.item_status as enum ('pendente','em_preparo','pronto','entregue','cancelado');
create type public.fraction_pricing as enum ('maior_valor','media_ponderada');

create table public.restaurants(id uuid primary key default gen_random_uuid(),name text not null,slug text not null unique,currency text not null default 'BRL',fraction_pricing public.fraction_pricing not null default 'maior_valor',created_at timestamptz not null default now());
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,restaurant_id uuid not null references public.restaurants(id) on delete cascade,full_name text not null,role public.app_role not null default 'garcom',phone text,active boolean not null default true,created_at timestamptz not null default now());
create table public.tables(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,number integer not null,status public.table_status not null default 'livre',qr_token text not null unique default encode(gen_random_bytes(24),'hex'),current_total numeric(12,2) not null default 0 check(current_total>=0),capacity integer not null default 4,image_key text not null default 'round_2' check(image_key in ('round_2','square_4','rectangle_6','rectangle_8')),created_at timestamptz not null default now(),unique(restaurant_id,number));
create table public.categories(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,name text not null,slug text not null,sort_order int not null default 0,active boolean not null default true,created_at timestamptz not null default now(),unique(restaurant_id,slug));
create table public.products(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,category_id uuid references public.categories(id) on delete set null,name text not null,description text,base_price numeric(12,2) not null check(base_price>=0),accepts_fractions boolean not null default false,prep_minutes int not null default 15 check(prep_minutes>=0),destination_sector text not null default 'cozinha' check(destination_sector in ('cozinha','bar','forno_pizza')),image_path text,active boolean not null default true,created_at timestamptz not null default now());
create table public.product_fractions(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id) on delete cascade,name text not null,serves int not null check(serves between 1 and 4),price numeric(12,2) not null check(price>=0),active boolean not null default true,unique(product_id,name));
create table public.pizza_borders(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,name text not null,price numeric(12,2) not null default 0 check(price>=0),active boolean not null default true,unique(restaurant_id,name));
create table public.ingredients_stock(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,name text not null,unit text not null check(unit in ('g','kg','ml','l','un')),quantity numeric(14,3) not null default 0,minimum_quantity numeric(14,3) not null default 0,cost_per_unit numeric(12,4) not null default 0,updated_at timestamptz not null default now(),unique(restaurant_id,name));
create table public.recipes(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id) on delete cascade,ingredient_id uuid not null references public.ingredients_stock(id) on delete restrict,quantity numeric(14,3) not null check(quantity>0),unique(product_id,ingredient_id));
create table public.orders(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,table_id uuid references public.tables(id) on delete set null,order_number bigint generated always as identity,order_type public.order_type not null,status public.order_status not null default 'pendente',customer_name text,customer_phone text,delivery_address jsonb,delivery_fee numeric(12,2) not null default 0 check(delivery_fee>=0),assigned_courier uuid references public.profiles(id) on delete set null,subtotal numeric(12,2) not null default 0,total numeric(12,2) not null default 0,payment_method text,payment_state public.payment_status not null default 'pendente',notes text,created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,product_id uuid references public.products(id) on delete set null,name text not null,quantity numeric(10,2) not null default 1 check(quantity>0),unit_price numeric(12,2) not null check(unit_price>=0),line_total numeric(12,2) not null check(line_total>=0),fraction_label text,flavors jsonb not null default '[]',border_id uuid references public.pizza_borders(id) on delete set null,additions jsonb not null default '[]',notes text,destination_sector text not null default 'cozinha' check(destination_sector in ('cozinha','bar','forno_pizza')),status public.item_status not null default 'pendente',started_at timestamptz,ready_at timestamptz,created_at timestamptz not null default now());
create table public.payments(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,order_id uuid references public.orders(id) on delete set null,amount numeric(12,2) not null check(amount>0),method text not null check(method in ('pix','credit_card','debit_card','cash')),status public.payment_status not null default 'pendente',provider text not null default 'mercado_pago',provider_payment_id text,external_reference text not null unique default gen_random_uuid()::text,idempotency_key text unique,webhook_log jsonb not null default '[]',paid_at timestamptz,created_at timestamptz not null default now());
create table public.order_splits(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,split_number int not null,amount numeric(12,2) not null check(amount>0),customer_label text,token text not null unique default encode(gen_random_bytes(24),'hex'),status public.payment_status not null default 'pendente',created_at timestamptz not null default now(),unique(order_id,split_number));
create table public.order_split_items(split_id uuid not null references public.order_splits(id) on delete cascade,order_item_id uuid not null references public.order_items(id) on delete cascade,quantity numeric(10,2) not null check(quantity>0),primary key(split_id,order_item_id));
create table public.delivery_zones(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,name text not null,neighborhood text,radius_km numeric(8,2),fee numeric(12,2) not null check(fee>=0),active boolean not null default true,check(neighborhood is not null or radius_km is not null));
create table public.stock_movements(id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id) on delete cascade,ingredient_id uuid not null references public.ingredients_stock(id) on delete restrict,order_item_id uuid references public.order_items(id) on delete set null,quantity_delta numeric(14,3) not null,reason text not null,created_at timestamptz not null default now());
create index orders_restaurant_created_idx on public.orders(restaurant_id,created_at desc);create index order_items_order_idx on public.order_items(order_id);create index order_items_kds_idx on public.order_items(status,destination_sector,created_at);create index payments_order_idx on public.payments(order_id);

create function public.current_restaurant_id() returns uuid language sql stable security definer set search_path=public as $$ select restaurant_id from public.profiles where id=auth.uid() and active $$;
create function public.has_role(allowed public.app_role[]) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and active and role=any(allowed)) $$;
create function public.bootstrap_restaurant_admin(p_restaurant_name text) returns uuid language plpgsql security definer set search_path='' as $$ declare v_uid uuid:=auth.uid(); v_email text; v_full_name text; v_restaurant_id uuid; v_slug text; begin if v_uid is null then raise exception 'Faça login para configurar seu restaurante'; end if; if length(trim(coalesce(p_restaurant_name,'')))<2 or length(trim(p_restaurant_name))>80 then raise exception 'Informe um nome de restaurante entre 2 e 80 caracteres'; end if; select u.email,coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(u.email,'@',1)) into v_email,v_full_name from auth.users u where u.id=v_uid and u.email_confirmed_at is not null; if v_email is null then raise exception 'Confirme seu e-mail antes de configurar o restaurante'; end if; if exists(select 1 from public.profiles p where p.id=v_uid) then raise exception 'Esta conta já está vinculada a um perfil'; end if; v_slug:=trim(both '-' from regexp_replace(lower(trim(p_restaurant_name)),'[^a-z0-9]+','-','g'))||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8); insert into public.restaurants(name,slug) values(trim(p_restaurant_name),v_slug) returning id into v_restaurant_id; insert into public.profiles(id,restaurant_id,full_name,role) values(v_uid,v_restaurant_id,v_full_name,'admin'); return v_restaurant_id; end $$;
revoke all on function public.bootstrap_restaurant_admin(text) from public,anon;
grant execute on function public.bootstrap_restaurant_admin(text) to authenticated;
create function public.set_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create function public.sync_order_totals() returns trigger language plpgsql security definer set search_path=public as $$ declare oid uuid; begin oid=coalesce(new.order_id,old.order_id); update public.orders o set subtotal=coalesce((select sum(i.line_total) from public.order_items i where i.order_id=oid and i.status<>'cancelado'),0),total=coalesce((select sum(i.line_total) from public.order_items i where i.order_id=oid and i.status<>'cancelado'),0)+o.delivery_fee where o.id=oid; if (select table_id from public.orders where id=oid) is not null then update public.tables t set current_total=(select total from public.orders where id=oid),status=case when (select status from public.orders where id=oid)='cancelado' then 'livre'::public.table_status else 'ocupada'::public.table_status end where t.id=(select table_id from public.orders where id=oid); end if; return coalesce(new,old); end $$;
create trigger order_item_totals after insert or update or delete on public.order_items for each row execute function public.sync_order_totals();
create function public.deduct_recipe_stock() returns trigger language plpgsql security definer set search_path=public as $$ declare r record; begin if new.status='entregue' and old.status is distinct from 'entregue' then for r in select rc.ingredient_id,rc.quantity*new.quantity as qty from public.recipes rc where rc.product_id=new.product_id loop if not exists(select 1 from public.stock_movements m where m.order_item_id=new.id and m.ingredient_id=r.ingredient_id and m.quantity_delta<0) then update public.ingredients_stock set quantity=quantity-r.qty,updated_at=now() where id=r.ingredient_id; insert into public.stock_movements(restaurant_id,ingredient_id,order_item_id,quantity_delta,reason) select p.restaurant_id,r.ingredient_id,new.id,-r.qty,'baixa por item entregue' from public.products p where p.id=new.product_id; end if; end loop; end if; return new; end $$;
create trigger order_item_stock_deduction after update of status on public.order_items for each row execute function public.deduct_recipe_stock();
create function public.release_table_on_close() returns trigger language plpgsql security definer set search_path=public as $$ begin if new.status in ('entregue','cancelado') and new.table_id is not null then update public.tables set status='livre',current_total=0 where id=new.table_id; end if; return new; end $$;
create trigger orders_release_table after update of status on public.orders for each row execute function public.release_table_on_close();
create function public.close_table_order_when_items_terminal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ declare v_order_status public.order_status; v_has_delivered_items boolean; begin if new.status not in ('entregue','cancelado') or old.status is not distinct from new.status then return new; end if; select o.status into v_order_status from public.orders o where o.id=new.order_id and o.table_id is not null for update; if not found or v_order_status in ('entregue','cancelado') then return new; end if; if exists(select 1 from public.order_items i where i.order_id=new.order_id and i.status not in ('entregue','cancelado')) then return new; end if; select exists(select 1 from public.order_items i where i.order_id=new.order_id and i.status='entregue') into v_has_delivered_items; update public.orders set status=case when v_has_delivered_items then 'entregue'::public.order_status else 'cancelado'::public.order_status end where id=new.order_id and status not in ('entregue','cancelado'); return new; end $$;
create trigger order_items_close_table_order after update of status on public.order_items for each row execute function public.close_table_order_when_items_terminal();
revoke execute on function public.deduct_recipe_stock() from public, anon, authenticated;
revoke execute on function public.release_table_on_close() from public, anon, authenticated;
revoke execute on function public.close_table_order_when_items_terminal() from public, anon, authenticated;
revoke execute on function public.sync_order_totals() from public, anon, authenticated;

alter table public.restaurants enable row level security;alter table public.profiles enable row level security;alter table public.tables enable row level security;alter table public.categories enable row level security;alter table public.products enable row level security;alter table public.product_fractions enable row level security;alter table public.pizza_borders enable row level security;alter table public.ingredients_stock enable row level security;alter table public.recipes enable row level security;alter table public.orders enable row level security;alter table public.order_items enable row level security;alter table public.payments enable row level security;alter table public.delivery_zones enable row level security;alter table public.stock_movements enable row level security;
create policy restaurant_read on public.restaurants for select using(id=public.current_restaurant_id());
create policy restaurants_admin_update on public.restaurants for update to authenticated using(id=public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[])) with check(id=public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
create policy profiles_read on public.profiles for select using(restaurant_id=public.current_restaurant_id());
create policy profiles_admin_insert on public.profiles for insert to authenticated with check(restaurant_id=public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
create policy profiles_admin_update on public.profiles for update to authenticated using(restaurant_id=public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[])) with check(restaurant_id=public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
create policy profiles_admin_delete on public.profiles for delete to authenticated using(restaurant_id=public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
create policy tables_staff on public.tables for all using(restaurant_id=public.current_restaurant_id()) with check(restaurant_id=public.current_restaurant_id());
create policy categories_staff on public.categories for all using(restaurant_id=public.current_restaurant_id()) with check(restaurant_id=public.current_restaurant_id());
create policy products_staff on public.products for all using(restaurant_id=public.current_restaurant_id()) with check(restaurant_id=public.current_restaurant_id());
create policy fractions_staff on public.product_fractions for all using(exists(select 1 from public.products p where p.id=product_id and p.restaurant_id=public.current_restaurant_id())) with check(exists(select 1 from public.products p where p.id=product_id and p.restaurant_id=public.current_restaurant_id()));
create policy borders_staff on public.pizza_borders for all using(restaurant_id=public.current_restaurant_id()) with check(restaurant_id=public.current_restaurant_id());
create policy stock_staff on public.ingredients_stock for all using(restaurant_id=public.current_restaurant_id()) with check(restaurant_id=public.current_restaurant_id());
create policy recipes_staff on public.recipes for all using(exists(select 1 from public.products p where p.id=product_id and p.restaurant_id=public.current_restaurant_id())) with check(exists(select 1 from public.products p where p.id=product_id and p.restaurant_id=public.current_restaurant_id()));
create policy orders_staff on public.orders for all using(restaurant_id=public.current_restaurant_id()) with check(restaurant_id=public.current_restaurant_id());
create policy items_staff on public.order_items for all using(exists(select 1 from public.orders o where o.id=order_id and o.restaurant_id=public.current_restaurant_id())) with check(exists(select 1 from public.orders o where o.id=order_id and o.restaurant_id=public.current_restaurant_id()));
create policy payments_staff on public.payments for all using(restaurant_id=public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[])) with check(restaurant_id=public.current_restaurant_id() and public.has_role(array['admin','caixa']::public.app_role[]));
alter table public.order_splits enable row level security;alter table public.order_split_items enable row level security;
create policy splits_staff on public.order_splits for all using(exists(select 1 from public.orders o where o.id=order_id and o.restaurant_id=public.current_restaurant_id()) and public.has_role(array['admin','caixa','garcom']::public.app_role[])) with check(exists(select 1 from public.orders o where o.id=order_id and o.restaurant_id=public.current_restaurant_id()) and public.has_role(array['admin','caixa','garcom']::public.app_role[]));
create policy split_items_staff on public.order_split_items for all using(exists(select 1 from public.order_splits s join public.orders o on o.id=s.order_id where s.id=split_id and o.restaurant_id=public.current_restaurant_id()) and public.has_role(array['admin','caixa','garcom']::public.app_role[])) with check(exists(select 1 from public.order_splits s join public.orders o on o.id=s.order_id where s.id=split_id and o.restaurant_id=public.current_restaurant_id()) and public.has_role(array['admin','caixa','garcom']::public.app_role[]));
create policy zones_staff on public.delivery_zones for all using(restaurant_id=public.current_restaurant_id()) with check(restaurant_id=public.current_restaurant_id());
create policy movements_read on public.stock_movements for select using(restaurant_id=public.current_restaurant_id());
create policy movements_admin on public.stock_movements for insert with check(restaurant_id=public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));
alter publication supabase_realtime add table public.order_items;alter publication supabase_realtime add table public.tables;alter publication supabase_realtime add table public.orders;


-- Inventory, recipe costing, fractional deduction, and low-stock support.
alter table public.restaurants
  add column if not exists target_margin_percent numeric(5,2) not null default 60
  check (target_margin_percent between 0 and 100);

create table if not exists public.product_additions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, name)
);

alter table public.recipes alter column product_id drop not null;
alter table public.recipes add column if not exists product_fraction_id uuid references public.product_fractions(id) on delete cascade;
alter table public.recipes add column if not exists pizza_border_id uuid references public.pizza_borders(id) on delete cascade;
alter table public.recipes add column if not exists addition_id uuid references public.product_additions(id) on delete cascade;
alter table public.recipes add column if not exists unit text not null default 'g' check (unit in ('g','kg','ml','l','un'));

alter table public.recipes drop constraint if exists recipes_target_check;
alter table public.recipes add constraint recipes_target_check check (
  num_nonnulls(product_id, pizza_border_id, addition_id) = 1
  and (product_fraction_id is null or product_id is not null)
);

alter table public.recipes drop constraint if exists recipes_product_id_ingredient_id_key;
create unique index if not exists recipes_product_generic_unique
  on public.recipes(product_id, ingredient_id) where product_id is not null and product_fraction_id is null;
create unique index if not exists recipes_product_fraction_unique
  on public.recipes(product_id, product_fraction_id, ingredient_id) where product_fraction_id is not null;
create unique index if not exists recipes_border_unique
  on public.recipes(pizza_border_id, ingredient_id) where pizza_border_id is not null;
create unique index if not exists recipes_addition_unique
  on public.recipes(addition_id, ingredient_id) where addition_id is not null;

alter table public.product_additions enable row level security;
drop policy if exists additions_staff on public.product_additions;
create policy additions_staff on public.product_additions for all
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists recipes_staff on public.recipes;
create policy recipes_staff on public.recipes for all
  using (
    (product_id is not null and exists(select 1 from public.products p where p.id = product_id and p.restaurant_id = public.current_restaurant_id()))
    or (pizza_border_id is not null and exists(select 1 from public.pizza_borders b where b.id = pizza_border_id and b.restaurant_id = public.current_restaurant_id()))
    or (addition_id is not null and exists(select 1 from public.product_additions a where a.id = addition_id and a.restaurant_id = public.current_restaurant_id()))
  )
  with check (
    (product_id is not null and exists(select 1 from public.products p where p.id = product_id and p.restaurant_id = public.current_restaurant_id()))
    or (pizza_border_id is not null and exists(select 1 from public.pizza_borders b where b.id = pizza_border_id and b.restaurant_id = public.current_restaurant_id()))
    or (addition_id is not null and exists(select 1 from public.product_additions a where a.id = addition_id and a.restaurant_id = public.current_restaurant_id()))
  );

create or replace function public.inventory_convert_unit(p_amount numeric, p_from text, p_to text)
returns numeric language plpgsql immutable set search_path = public as $$
begin
  if p_from = p_to then return p_amount; end if;
  if p_from = 'g' and p_to = 'kg' then return p_amount / 1000; end if;
  if p_from = 'kg' and p_to = 'g' then return p_amount * 1000; end if;
  if p_from = 'ml' and p_to = 'l' then return p_amount / 1000; end if;
  if p_from = 'l' and p_to = 'ml' then return p_amount * 1000; end if;
  raise exception 'Unidades incompatveis na ficha tcnica: % para %', p_from, p_to;
end;
$$;

create or replace function public.save_inventory_recipe(
  p_target_type text,
  p_target_id uuid,
  p_product_fraction_id uuid,
  p_rows jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_role public.app_role;
  v_product_id uuid;
  v_target_id uuid;
  v_row jsonb;
  v_ingredient_id uuid;
  v_quantity numeric;
  v_unit text;
  v_stock_unit text;
begin
  select role into v_role from public.profiles where id = auth.uid() and restaurant_id = v_restaurant_id and active;
  if v_role is distinct from 'admin' then raise exception 'Apenas administrador pode editar fichas tcnicas'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Lista de insumos invlida'; end if;

  if p_target_type = 'product' then
    select id into v_product_id from public.products where id = p_target_id and restaurant_id = v_restaurant_id;
    if v_product_id is null then raise exception 'Produto no encontrado neste restaurante'; end if;
    if p_product_fraction_id is not null and not exists(select 1 from public.product_fractions where id = p_product_fraction_id and product_id = v_product_id) then raise exception 'Tamanho no pertence a este produto'; end if;
    delete from public.recipes where product_id = v_product_id and product_fraction_id is not distinct from p_product_fraction_id;
  elsif p_target_type = 'border' then
    select id into v_target_id from public.pizza_borders where id = p_target_id and restaurant_id = v_restaurant_id;
    if v_target_id is null then raise exception 'Borda no encontrada neste restaurante'; end if;
    delete from public.recipes where pizza_border_id = v_target_id;
  elsif p_target_type = 'addition' then
    select id into v_target_id from public.product_additions where id = p_target_id and restaurant_id = v_restaurant_id;
    if v_target_id is null then raise exception 'Adicional no encontrado neste restaurante'; end if;
    delete from public.recipes where addition_id = v_target_id;
  else
    raise exception 'Tipo de ficha tcnica invlido';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_ingredient_id := (v_row->>'ingredient_id')::uuid;
    v_quantity := (v_row->>'quantity')::numeric;
    v_unit := v_row->>'unit';
    if v_quantity is null or v_quantity <= 0 or v_unit not in ('g','kg','ml','l','un') then raise exception 'Quantidade ou unidade invlida'; end if;
    select unit into v_stock_unit from public.ingredients_stock where id = v_ingredient_id and restaurant_id = v_restaurant_id;
    if v_stock_unit is null then raise exception 'Ingredient is not in this restaurant'; end if;
    perform public.inventory_convert_unit(v_quantity, v_unit, v_stock_unit);
    insert into public.recipes(product_id, product_fraction_id, pizza_border_id, addition_id, ingredient_id, quantity, unit)
    values (
      case when p_target_type = 'product' then v_product_id end,
      case when p_target_type = 'product' then p_product_fraction_id end,
      case when p_target_type = 'border' then v_target_id end,
      case when p_target_type = 'addition' then v_target_id end,
      v_ingredient_id, v_quantity, v_unit
    );
  end loop;
end;
$$;

create or replace function public.record_stock_movement(p_ingredient_id uuid, p_quantity_delta numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_role public.app_role;
begin
  select role into v_role from public.profiles where id = auth.uid() and restaurant_id = v_restaurant_id and active;
  if v_role is distinct from 'admin' then raise exception 'Apenas administrador pode ajustar estoque'; end if;
  if p_quantity_delta = 0 or length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe uma quantidade e motivo vlidos'; end if;
  update public.ingredients_stock set quantity = quantity + p_quantity_delta, updated_at = now()
    where id = p_ingredient_id and restaurant_id = v_restaurant_id;
  if not found then raise exception 'Insumo no encontrado neste restaurante'; end if;
  insert into public.stock_movements(restaurant_id, ingredient_id, quantity_delta, reason)
    values (v_restaurant_id, p_ingredient_id, p_quantity_delta, trim(p_reason));
end;
$$;

create or replace function public.apply_order_item_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_restaurant_id uuid;
  r record;
  v_target numeric;
  v_diff numeric;
begin
  select restaurant_id into v_restaurant_id from public.orders where id = new.order_id;
  if v_restaurant_id is null then raise exception 'Pedido no encontrado'; end if;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(new.flavors) = 'array' then new.flavors else '[]'::jsonb end) as flavor(value) where coalesce(flavor.value->>'product_id', '') <> '' and coalesce(nullif(flavor.value->>'fraction', '')::numeric, 1) <= 0) then raise exception 'Flavor fractions must be positive'; end if;
  if abs(coalesce((select sum(coalesce(nullif(flavor.value->>'fraction', '')::numeric, 1)) from jsonb_array_elements(case when jsonb_typeof(new.flavors) = 'array' then new.flavors else '[]'::jsonb end) as flavor(value) where coalesce(flavor.value->>'product_id', '') <> ''), 1) - 1) > 0.0001 then raise exception 'Flavor fractions must add up to one'; end if;

  for r in
    with flavor_parts as (
      select (flavor.value->>'product_id')::uuid as product_id,
             nullif(flavor.value->>'product_fraction_id', '')::uuid as product_fraction_id,
             coalesce(nullif(flavor.value->>'fraction', '')::numeric, 1) as share
      from jsonb_array_elements(case when jsonb_typeof(new.flavors) = 'array' then new.flavors else '[]'::jsonb end) as flavor(value)
      where coalesce(flavor.value->>'product_id', '') <> ''
      union all
      select new.product_id, null::uuid, 1::numeric
      where new.product_id is not null and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(new.flavors) = 'array' then new.flavors else '[]'::jsonb end) as flavor(value)
        where coalesce(flavor.value->>'product_id', '') <> ''
      )
    ), product_recipes as (
      select rc.ingredient_id,
        sum(public.inventory_convert_unit(rc.quantity, rc.unit, s.unit) * fp.share * new.quantity) as qty
      from flavor_parts fp
      join public.products p on p.id = fp.product_id and p.restaurant_id = v_restaurant_id
      join lateral (
        select x.* from public.recipes x
        where x.product_id = p.id
          and (x.product_fraction_id = fp.product_fraction_id or x.product_fraction_id is null)
          and (
            x.product_fraction_id = fp.product_fraction_id
            or (
              x.product_fraction_id is null
              and not exists (
                select 1 from public.recipes e
                where e.product_id = p.id
                  and e.product_fraction_id = fp.product_fraction_id
              )
            )
          )
      ) rc on true
      join public.ingredients_stock s on s.id = rc.ingredient_id
      group by rc.ingredient_id
    ), border_recipes as (
      select rc.ingredient_id, sum(public.inventory_convert_unit(rc.quantity, rc.unit, s.unit) * new.quantity) as qty
      from public.recipes rc join public.ingredients_stock s on s.id = rc.ingredient_id
      where new.border_id is not null and rc.pizza_border_id = new.border_id and s.restaurant_id = v_restaurant_id
      group by rc.ingredient_id
    ), addition_recipes as (
      select rc.ingredient_id,
        sum(public.inventory_convert_unit(rc.quantity, rc.unit, s.unit) * coalesce(nullif(addition.value->>'quantity', '')::numeric, 1) * new.quantity) as qty
      from jsonb_array_elements(case when jsonb_typeof(new.additions) = 'array' then new.additions else '[]'::jsonb end) as addition(value)
      join public.recipes rc on rc.addition_id = case
        when coalesce(addition.value->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (addition.value->>'id')::uuid
        else null
      end
      join public.ingredients_stock s on s.id = rc.ingredient_id and s.restaurant_id = v_restaurant_id
      group by rc.ingredient_id
    ), expected as (
      select ingredient_id, sum(qty) as qty from (
        select * from product_recipes union all select * from border_recipes union all select * from addition_recipes
      ) uses group by ingredient_id
    ), actual as (
      select ingredient_id, sum(quantity_delta) as delta from public.stock_movements where order_item_id = new.id group by ingredient_id
    )
    select coalesce(e.ingredient_id, a.ingredient_id) as ingredient_id, coalesce(e.qty, 0) as qty, coalesce(a.delta, 0) as delta
    from expected e full join actual a using (ingredient_id)
  loop
    v_target := case when new.status = 'cancelado' then 0 else -r.qty end;
    v_diff := v_target - r.delta;
    if v_diff <> 0 then
      update public.ingredients_stock set quantity = quantity + v_diff, updated_at = now()
        where id = r.ingredient_id and restaurant_id = v_restaurant_id;
      insert into public.stock_movements(restaurant_id, ingredient_id, order_item_id, quantity_delta, reason)
        values (v_restaurant_id, r.ingredient_id, new.id, v_diff,
          case when new.status = 'cancelado' then 'estorno de item cancelado' when r.delta = 0 then 'baixa automtica por pedido' else 'ajuste de ficha tcnica do item' end);
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.cancel_order_items_and_restore_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    update public.order_items set status = 'cancelado' where order_id = new.id and status <> 'cancelado';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_cancel_items on public.orders;
create trigger orders_cancel_items after update of status on public.orders
  for each row execute function public.cancel_order_items_and_restore_stock();
revoke execute on function public.cancel_order_items_and_restore_stock() from public, anon, authenticated;

comment on column public.order_items.flavors is 'Stock deduction format: [{"product_id":"uuid","product_fraction_id":"uuid","fraction":0.5}]. Fraction values must sum to 1.';
comment on column public.order_items.additions is 'Stock deduction format: [{"id":"product_additions uuid","quantity":1}]';

drop trigger if exists order_item_stock_deduction on public.order_items;
create trigger order_item_stock_deduction
  after insert or update of status, quantity, flavors, additions, border_id, product_id on public.order_items
  for each row when (new.status in ('pronto','entregue','cancelado'))
  execute function public.apply_order_item_stock();

revoke execute on function public.apply_order_item_stock() from public, anon, authenticated;
revoke execute on function public.inventory_convert_unit(numeric, text, text) from public, anon, authenticated;
revoke execute on function public.save_inventory_recipe(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_inventory_recipe(text, uuid, uuid, jsonb) to authenticated;
revoke execute on function public.record_stock_movement(uuid, numeric, text) from public, anon;
grant execute on function public.record_stock_movement(uuid, numeric, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.ingredients_stock;
exception when duplicate_object then null;
end $$;


-- Live inventory movement history.
do $$ begin
  alter publication supabase_realtime add table public.stock_movements;
exception when duplicate_object then null;
end $$;\n\n

-- Atendimento no salao e autoatendimento seguro por QR Code.
-- O token impresso na mesa e a unica identificacao publica da mesa; os precos
-- e os setores sempre sao calculados a partir do catalogo no banco.

alter table public.restaurants
  add column if not exists public_menu_enabled boolean not null default true,
  add column if not exists public_menu_description text not null default '',
  add column if not exists public_menu_phone text not null default '';

create table if not exists public.public_menu_submissions (
  request_id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  response jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.public_menu_submissions enable row level security;
revoke all on public.public_menu_submissions from public, anon, authenticated;

create index if not exists orders_open_table_idx
  on public.orders (table_id, created_at desc)
  where table_id is not null and status not in ('entregue', 'cancelado');

create table if not exists public.table_order_submissions (
  request_id uuid primary key,
  table_id uuid not null references public.tables(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  response jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.table_order_submissions enable row level security;
revoke all on public.table_order_submissions from public, anon, authenticated;

create or replace function public.get_public_table_menu(p_qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_table public.tables%rowtype;
  v_menu jsonb;
begin
  select t.* into v_table
  from public.tables t
  where t.qr_token = p_qr_token;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'table_id', v_table.id,
    'table_number', v_table.number,
    'table_status', v_table.status,
    'restaurant_name', r.name,
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'slug', c.slug,
          'products', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', p.id,
                'name', p.name,
                'description', p.description,
                'base_price', p.base_price,
                'image_path', p.image_path,
                'accepts_fractions', p.accepts_fractions,
                'destination_sector', p.destination_sector,
                'fractions', coalesce((
                  select jsonb_agg(
                    jsonb_build_object('id', pf.id, 'name', pf.name, 'serves', pf.serves, 'price', pf.price)
                    order by pf.serves, pf.price
                  )
                  from public.product_fractions pf
                  where pf.product_id = p.id and pf.active
                ), '[]'::jsonb)
              ) order by p.name
            )
            from public.products p
            where p.category_id = c.id and p.restaurant_id = r.id and p.active
          ), '[]'::jsonb)
        ) order by c.sort_order, c.name
      )
      from public.categories c
      where c.restaurant_id = r.id and c.active
        and exists (select 1 from public.products p where p.category_id = c.id and p.active)
    ), '[]'::jsonb)
  ) into v_menu
  from public.restaurants r
  where r.id = v_table.restaurant_id;

  return v_menu;
end;
$$;

create or replace function public.submit_table_order(
  p_qr_token text,
  p_customer_name text,
  p_items jsonb,
  p_notes text default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table public.tables%rowtype;
  v_submission public.table_order_submissions%rowtype;
  v_order_id uuid;
  v_order_number bigint;
  v_item jsonb;
  v_product public.products%rowtype;
  v_fraction public.product_fractions%rowtype;
  v_product_id uuid;
  v_fraction_id uuid;
  v_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_fraction_label text;
  v_total numeric(12,2);
  v_customer_name text := left(trim(coalesce(p_customer_name, '')), 80);
  v_item_notes text;
  v_response jsonb;
begin
  if p_qr_token is null or length(p_qr_token) < 32 then
    raise exception 'QR Code invalido.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 40 then
    raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'As observacoes do pedido excedem o limite permitido.' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'Identificador da solicitacao invalido.' using errcode = '22023';
  end if;

  -- Serializa a abertura e o reaproveitamento da comanda para esta mesa.
  select t.* into v_table
  from public.tables t
  where t.qr_token = p_qr_token
  for update;

  if not found then
    raise exception 'Esta mesa nao existe ou o QR Code foi renovado.' using errcode = 'P0002';
  end if;
  if v_table.status = 'reservada' then
    raise exception 'Esta mesa esta reservada e nao pode receber pedidos pelo QR Code.' using errcode = '55000';
  end if;

  select s.* into v_submission
  from public.table_order_submissions s
  where s.request_id = p_request_id;
  if found then
    if v_submission.table_id <> v_table.id then
      raise exception 'Este identificador ja foi usado em outra mesa.' using errcode = '22023';
    end if;
    return v_submission.response;
  end if;

  select o.id, o.order_number into v_order_id, v_order_number
  from public.orders o
  where o.table_id = v_table.id
    and o.status not in ('entregue', 'cancelado')
  order by o.created_at desc
  limit 1
  for update;

  if v_order_id is null then
    insert into public.orders (
      restaurant_id, table_id, order_type, status, customer_name, notes, created_by
    ) values (
      v_table.restaurant_id,
      v_table.id,
      case when auth.uid() is null then 'qr'::public.order_type else 'salao'::public.order_type end,
      'pendente',
      nullif(v_customer_name, ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    ) returning id, order_number into v_order_id, v_order_number;
  else
    update public.orders
    set customer_name = coalesce(customer_name, nullif(v_customer_name, '')),
        notes = case
          when nullif(trim(coalesce(p_notes, '')), '') is null then notes
          when nullif(notes, '') is null then trim(p_notes)
          else notes || E'\n' || trim(p_notes)
        end
    where id = v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_fraction_id := nullif(v_item->>'fraction_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_notes := left(trim(coalesce(v_item->>'notes', '')), 500);

    if v_product_id is null or v_quantity <= 0 or v_quantity > 99 then
      raise exception 'Item ou quantidade invalida no pedido.' using errcode = '22023';
    end if;

    select p.* into v_product
    from public.products p
    where p.id = v_product_id
      and p.restaurant_id = v_table.restaurant_id
      and p.active;

    if not found then
      raise exception 'Um dos produtos nao esta mais disponivel.' using errcode = '22023';
    end if;

    if v_fraction_id is not null then
      select pf.* into v_fraction
      from public.product_fractions pf
      where pf.id = v_fraction_id
        and pf.product_id = v_product.id
        and pf.active;
      if not found then
        raise exception 'O tamanho escolhido nao esta mais disponivel.' using errcode = '22023';
      end if;
      v_unit_price := v_fraction.price;
      v_fraction_label := v_fraction.name;
    else
      if v_product.accepts_fractions and exists (
        select 1 from public.product_fractions pf where pf.product_id = v_product.id and pf.active
      ) then
        raise exception 'Selecione o tamanho de %.', v_product.name using errcode = '22023';
      end if;
      v_fraction_label := null;
      v_unit_price := v_product.base_price;
    end if;

    insert into public.order_items (
      order_id, product_id, name, quantity, unit_price, line_total,
      fraction_label, flavors, destination_sector, notes
    ) values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_quantity,
      v_unit_price,
      round(v_quantity * v_unit_price, 2),
      v_fraction_label,
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product.id,
        'product_fraction_id', v_fraction_id,
        'fraction', 1
      )),
      v_product.destination_sector,
      nullif(v_item_notes, '')
    );
  end loop;

  select coalesce(o.total, 0) into v_total from public.orders o where o.id = v_order_id;

  v_response := jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total', v_total,
    'table_number', v_table.number
  );
  insert into public.table_order_submissions(request_id, table_id, order_id, response)
  values (p_request_id, v_table.id, v_order_id, v_response);
  return v_response;
end;
$$;

create or replace function public.get_public_table_order_status(p_qr_token text, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_table_id uuid;
begin
  select t.id into v_table_id from public.tables t where t.qr_token = p_qr_token;
  if v_table_id is null then
    return null;
  end if;

  select o.* into v_order
  from public.orders o
  where o.id = p_order_id and o.table_id = v_table_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'total', v_order.total,
    'created_at', v_order.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'fraction_label', i.fraction_label, 'status', i.status))
      from public.order_items i where i.order_id = v_order.id and i.status <> 'cancelado'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_public_table_open_order(p_qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_table_id uuid;
  v_order_id uuid;
begin
  if p_qr_token is null or length(p_qr_token) < 32 then return null; end if;
  select t.id into v_table_id from public.tables t where t.qr_token = p_qr_token;
  if v_table_id is null then return null; end if;
  select o.id into v_order_id
  from public.orders o
  where o.table_id = v_table_id and o.status not in ('entregue','cancelado')
  order by o.created_at desc limit 1;
  if v_order_id is null then return null; end if;
  return public.get_public_table_order_status(p_qr_token, v_order_id);
end;
$$;

create or replace function public.get_public_digital_menu(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  select r.* into v_restaurant
  from public.restaurants r
  where r.slug = p_slug and r.public_menu_enabled;
  if not found then return null; end if;

  return jsonb_build_object(
    'restaurant_name', v_restaurant.name,
    'description', v_restaurant.public_menu_description,
    'phone', v_restaurant.public_menu_phone,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slug', c.slug,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'description', p.description,
            'base_price', p.base_price,
            'image_path', p.image_path,
            'accepts_fractions', p.accepts_fractions,
            'destination_sector', p.destination_sector,
            'categories', jsonb_build_object('name', c.name),
            'fractions', coalesce((
              select jsonb_agg(jsonb_build_object('id', pf.id, 'name', pf.name, 'serves', pf.serves, 'price', pf.price) order by pf.serves, pf.price)
              from public.product_fractions pf where pf.product_id = p.id and pf.active
            ), '[]'::jsonb)
          ) order by p.name)
          from public.products p
          where p.category_id = c.id and p.restaurant_id = v_restaurant.id and p.active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c
      where c.restaurant_id = v_restaurant.id and c.active
        and exists (select 1 from public.products p where p.category_id = c.id and p.restaurant_id = v_restaurant.id and p.active)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_digital_menu_order(
  p_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_notes text default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_submission public.public_menu_submissions%rowtype;
  v_order_id uuid;
  v_order_number bigint;
  v_item jsonb;
  v_product public.products%rowtype;
  v_fraction public.product_fractions%rowtype;
  v_product_id uuid;
  v_fraction_id uuid;
  v_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_fraction_label text;
  v_total numeric(12,2);
  v_response jsonb;
  v_name text := left(trim(coalesce(p_customer_name, '')), 80);
  v_phone text := left(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), 15);
begin
  if p_request_id is null then raise exception 'Identificador do pedido invalido.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select s.* into v_submission from public.public_menu_submissions s where s.request_id = p_request_id;
  if found then return v_submission.response; end if;

  select r.* into v_restaurant from public.restaurants r
  where r.slug = p_slug and r.public_menu_enabled;
  if not found then raise exception 'Este cardapio nao esta disponivel.' using errcode = 'P0002'; end if;
  if length(v_name) < 2 then raise exception 'Informe seu nome para o pedido.' using errcode = '22023'; end if;
  if length(v_phone) < 10 then raise exception 'Informe um telefone valido.' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 40 then
    raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 500 then raise exception 'A observacao excede o limite.' using errcode = '22023'; end if;

  insert into public.orders(restaurant_id, order_type, status, customer_name, customer_phone, notes, created_by)
  values (v_restaurant.id, 'balcao', 'pendente', v_name, v_phone, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id, order_number into v_order_id, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_fraction_id := nullif(v_item->>'fraction_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    if v_product_id is null or v_quantity <= 0 or v_quantity > 99 then
      raise exception 'Produto ou quantidade invalida.' using errcode = '22023';
    end if;

    select p.* into v_product from public.products p
    where p.id = v_product_id and p.restaurant_id = v_restaurant.id and p.active;
    if not found then raise exception 'Um produto nao esta mais disponivel.' using errcode = '22023'; end if;

    if v_fraction_id is not null then
      select pf.* into v_fraction from public.product_fractions pf
      where pf.id = v_fraction_id and pf.product_id = v_product.id and pf.active;
      if not found then raise exception 'Um tamanho nao esta mais disponivel.' using errcode = '22023'; end if;
      v_unit_price := v_fraction.price;
      v_fraction_label := v_fraction.name;
    else
      if v_product.accepts_fractions and exists (select 1 from public.product_fractions pf where pf.product_id = v_product.id and pf.active) then
        raise exception 'Selecione o tamanho de %.', v_product.name using errcode = '22023';
      end if;
      v_unit_price := v_product.base_price;
      v_fraction_label := null;
    end if;

    insert into public.order_items(order_id, product_id, name, quantity, unit_price, line_total, fraction_label, flavors, destination_sector)
    values (
      v_order_id, v_product.id, v_product.name, v_quantity, v_unit_price, round(v_quantity * v_unit_price, 2),
      v_fraction_label,
      jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'product_fraction_id', v_fraction_id, 'fraction', 1)),
      v_product.destination_sector
    );
  end loop;

  select o.total into v_total from public.orders o where o.id = v_order_id;
  v_response := jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'total', v_total);
  insert into public.public_menu_submissions(request_id, restaurant_id, order_id, response)
  values (p_request_id, v_restaurant.id, v_order_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.get_public_table_menu(text) from public;
revoke all on function public.submit_table_order(text, text, jsonb, text, uuid) from public;
revoke all on function public.get_public_table_order_status(text, uuid) from public;
revoke all on function public.get_public_table_open_order(text) from public;
revoke all on function public.get_public_digital_menu(text) from public;
revoke all on function public.submit_digital_menu_order(text, text, text, jsonb, text, uuid) from public;
grant execute on function public.get_public_table_menu(text) to anon, authenticated;
grant execute on function public.submit_table_order(text, text, jsonb, text, uuid) to anon, authenticated;
grant execute on function public.get_public_table_order_status(text, uuid) to anon, authenticated;
grant execute on function public.get_public_table_open_order(text) to anon, authenticated;
grant execute on function public.get_public_digital_menu(text) to anon, authenticated;
grant execute on function public.submit_digital_menu_order(text, text, text, jsonb, text, uuid) to anon, authenticated;

-- Fotos publicas dos produtos; somente administradores do restaurante podem alterar arquivos.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
for select using (bucket_id = 'product-images');

drop policy if exists product_images_admin_insert on storage.objects;
create policy product_images_admin_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  and public.has_role(array['admin']::public.app_role[])
);

drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  and public.has_role(array['admin']::public.app_role[])
);

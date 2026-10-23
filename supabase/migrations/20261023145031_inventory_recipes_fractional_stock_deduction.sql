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
          and (x.product_fraction_id is null or not exists(select 1 from public.recipes e where e.product_id = p.id and e.product_fraction_id = fp.product_fraction_id))
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
  for each row execute function public.apply_order_item_stock();

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

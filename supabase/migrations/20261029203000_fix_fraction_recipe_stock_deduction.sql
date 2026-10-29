begin;

-- Pause stock processing while existing open orders and completed orders are reconciled.
drop trigger if exists order_item_stock_deduction on public.order_items;

-- Previous versions selected a generic recipe even when a size-specific recipe
-- existed, and could ignore the exact-size recipe entirely.
create or replace function public.apply_order_item_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_restaurant_id uuid;
  r record;
  v_target numeric;
  v_diff numeric;
begin
  select restaurant_id into v_restaurant_id
    from public.orders where id = new.order_id;
  if v_restaurant_id is null then raise exception 'Pedido nao encontrado'; end if;

  if exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(new.flavors) = 'array' then new.flavors else '[]'::jsonb end) as flavor(value)
    where coalesce(flavor.value->>'product_id', '') <> ''
      and coalesce(nullif(flavor.value->>'fraction', '')::numeric, 1) <= 0
  ) then raise exception 'Flavor fractions must be positive'; end if;

  if abs(coalesce((
    select sum(coalesce(nullif(flavor.value->>'fraction', '')::numeric, 1))
    from jsonb_array_elements(case when jsonb_typeof(new.flavors) = 'array' then new.flavors else '[]'::jsonb end) as flavor(value)
    where coalesce(flavor.value->>'product_id', '') <> ''
  ), 1) - 1) > 0.0001 then raise exception 'Flavor fractions must add up to one'; end if;

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
        select 1
        from jsonb_array_elements(case when jsonb_typeof(new.flavors) = 'array' then new.flavors else '[]'::jsonb end) as flavor(value)
        where coalesce(flavor.value->>'product_id', '') <> ''
      )
    ), product_recipes as (
      select rc.ingredient_id,
             sum(public.inventory_convert_unit(rc.quantity, rc.unit, s.unit) * fp.share * new.quantity) as qty
      from flavor_parts fp
      join public.products p on p.id = fp.product_id and p.restaurant_id = v_restaurant_id
      join lateral (
        select x.*
        from public.recipes x
        where x.product_id = p.id
          and (
            x.product_fraction_id = fp.product_fraction_id
            or (
              x.product_fraction_id is null
              and not exists (
                select 1 from public.recipes exact_recipe
                where exact_recipe.product_id = p.id
                  and exact_recipe.product_fraction_id = fp.product_fraction_id
              )
            )
          )
      ) rc on true
      join public.ingredients_stock s on s.id = rc.ingredient_id and s.restaurant_id = v_restaurant_id
      group by rc.ingredient_id
    ), border_recipes as (
      select rc.ingredient_id,
             sum(public.inventory_convert_unit(rc.quantity, rc.unit, s.unit) * new.quantity) as qty
      from public.recipes rc
      join public.ingredients_stock s on s.id = rc.ingredient_id
      where new.border_id is not null
        and rc.pizza_border_id = new.border_id
        and s.restaurant_id = v_restaurant_id
      group by rc.ingredient_id
    ), addition_recipes as (
      select rc.ingredient_id,
             sum(public.inventory_convert_unit(rc.quantity, rc.unit, s.unit)
               * coalesce(nullif(addition.value->>'quantity', '')::numeric, 1) * new.quantity) as qty
      from jsonb_array_elements(case when jsonb_typeof(new.additions) = 'array' then new.additions else '[]'::jsonb end) as addition(value)
      join public.recipes rc on rc.addition_id = case
        when coalesce(addition.value->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (addition.value->>'id')::uuid
        else null
      end
      join public.ingredients_stock s on s.id = rc.ingredient_id and s.restaurant_id = v_restaurant_id
      group by rc.ingredient_id
    ), expected as (
      select ingredient_id, sum(qty) as qty
      from (
        select * from product_recipes
        union all select * from border_recipes
        union all select * from addition_recipes
      ) uses
      group by ingredient_id
    ), actual as (
      select ingredient_id, sum(quantity_delta) as delta
      from public.stock_movements
      where order_item_id = new.id
      group by ingredient_id
    )
    select coalesce(e.ingredient_id, a.ingredient_id) as ingredient_id,
           coalesce(e.qty, 0) as qty,
           coalesce(a.delta, 0) as delta
    from expected e
    full join actual a using (ingredient_id)
  loop
    v_target := case when new.status = 'cancelado' then 0 else -r.qty end;
    v_diff := v_target - r.delta;
    if v_diff <> 0 then
      update public.ingredients_stock
         set quantity = quantity + v_diff, updated_at = now()
       where id = r.ingredient_id and restaurant_id = v_restaurant_id;
      insert into public.stock_movements(restaurant_id, ingredient_id, order_item_id, quantity_delta, reason)
      values (
        v_restaurant_id,
        r.ingredient_id,
        new.id,
        v_diff,
        case
          when new.status = 'cancelado' then 'estorno de item cancelado'
          when r.delta = 0 then 'baixa automatica ao concluir o preparo'
          else 'ajuste de ficha tecnica do item'
        end
      );
    end if;
  end loop;
  return new;
end;
$$;

create trigger order_item_stock_deduction
  after insert or update of status, quantity, flavors, additions, border_id, product_id
  on public.order_items
  for each row
  when (new.status in ('pronto', 'entregue', 'cancelado'))
  execute function public.apply_order_item_stock();

-- Re-run the corrected calculation for items already marked ready/delivered.
-- The movement ledger makes this safe to repeat and prevents duplicate deductions.
update public.order_items
   set status = status
 where status in ('pronto', 'entregue');

commit;

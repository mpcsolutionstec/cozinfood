begin;

-- Block new stock updates while the existing early deductions are restored.
drop trigger if exists order_item_stock_deduction on public.order_items;

-- Items created before this migration were deducted at order submission.
-- Restore that early deduction for orders that have not reached the ready stage.
do $$
declare
  movement record;
begin
  for movement in
    select sm.restaurant_id,
           sm.ingredient_id,
           sm.order_item_id,
           sum(sm.quantity_delta) as net_delta
    from public.stock_movements sm
    join public.order_items oi on oi.id = sm.order_item_id
    where oi.status in ('pendente', 'em_preparo')
      and sm.order_item_id is not null
    group by sm.restaurant_id, sm.ingredient_id, sm.order_item_id
    having sum(sm.quantity_delta) < 0
  loop
    update public.ingredients_stock
       set quantity = quantity - movement.net_delta,
           updated_at = now()
     where id = movement.ingredient_id
       and restaurant_id = movement.restaurant_id;

    insert into public.stock_movements(restaurant_id, ingredient_id, order_item_id, quantity_delta, reason)
    values (
      movement.restaurant_id,
      movement.ingredient_id,
      movement.order_item_id,
      -movement.net_delta,
      'estorno de baixa antecipada; aguardando preparo'
    );
  end loop;
end;
$$;

-- The trigger function already calculates the recipe, fractions, borders and
-- additions, and is idempotent through stock_movements.order_item_id. Gate it
-- so only ready/delivered/cancelled item changes can affect inventory.
create trigger order_item_stock_deduction
  after insert or update of status, quantity, flavors, additions, border_id, product_id
  on public.order_items
  for each row
  when (new.status in ('pronto', 'entregue', 'cancelado'))
  execute function public.apply_order_item_stock();

commit;

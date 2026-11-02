-- Persist POS pizzas as a single ticket item while retaining each flavor share
-- for exact recipe inventory deduction when the item is marked ready.
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
  v_flavor jsonb;
  v_flavor_product public.products%rowtype;
  v_flavor_fraction public.product_fractions%rowtype;
  v_flavors jsonb;
  v_flavor_count integer;
  v_flavor_sum numeric(8,5);
  v_flavor_max numeric(12,2);
  v_flavor_weighted numeric(12,2);
  v_flavor_share numeric(8,5);
  v_size_name text;
  v_flavor_names text[];
  v_fraction_pricing public.fraction_pricing;
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
  select fraction_pricing into v_fraction_pricing from public.restaurants where id = v_restaurant_id;

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
    v_flavors := '[]'::jsonb;
    v_fraction_id := nullif(v_item->>'fraction_id','')::uuid;

    if v_item ? 'flavors' and jsonb_typeof(v_item->'flavors') is distinct from 'array' then
      raise exception 'Formato de sabores invalido';
    end if;
    v_flavor_count := jsonb_array_length(coalesce(v_item->'flavors','[]'::jsonb));
    if v_flavor_count > 0 then
      if v_flavor_count > 4 then raise exception 'Selecione de 1 a 4 sabores'; end if;
      v_flavor_sum := 0;
      v_flavor_max := 0;
      v_flavor_weighted := 0;
      v_flavor_names := array[]::text[];
      v_size_name := null;
      for v_flavor in select value from jsonb_array_elements(v_item->'flavors') loop
        v_flavor_share := coalesce(nullif(v_flavor->>'fraction','')::numeric, 0);
        if v_flavor_share <= 0 or v_flavor_share > 1 then raise exception 'Fracao de sabor invalida'; end if;
        select p.* into v_flavor_product
        from public.products p join public.categories c on c.id = p.category_id
        where p.id = (v_flavor->>'product_id')::uuid and p.restaurant_id = v_restaurant_id
          and p.active and c.slug = 'pizzas';
        if not found then raise exception 'Um sabor de pizza nao esta disponivel'; end if;
        select * into v_flavor_fraction from public.product_fractions
        where id = nullif(v_flavor->>'product_fraction_id','')::uuid
          and product_id = v_flavor_product.id and active;
        if not found then raise exception 'Um sabor nao possui o tamanho selecionado'; end if;
        if v_size_name is null then v_size_name := v_flavor_fraction.name;
        elsif v_size_name <> v_flavor_fraction.name then raise exception 'Todos os sabores devem usar o mesmo tamanho'; end if;

        v_flavor_sum := v_flavor_sum + v_flavor_share;
        v_flavor_max := greatest(v_flavor_max, v_flavor_fraction.price);
        v_flavor_weighted := v_flavor_weighted + v_flavor_fraction.price * v_flavor_share;
        v_flavor_names := array_append(v_flavor_names, concat(round(v_flavor_share * 100)::integer, '% ', v_flavor_product.name));
        v_flavors := v_flavors || jsonb_build_array(jsonb_build_object(
          'product_id', v_flavor_product.id,
          'product_fraction_id', v_flavor_fraction.id,
          'fraction', v_flavor_share
        ));
      end loop;
      if abs(v_flavor_sum - 1) > 0.0001 then raise exception 'As fracoes dos sabores devem somar 100%%'; end if;
      v_unit_price := case when v_fraction_pricing = 'media_ponderada' then v_flavor_weighted else v_flavor_max end;
      v_fraction_label := concat(v_size_name, ' · ', array_to_string(v_flavor_names, ' / '));
      -- The primary product is retained as the ticket's display/product reference.
      select * into v_product from public.products where id = (v_item->>'product_id')::uuid and restaurant_id = v_restaurant_id and active;
    elsif v_fraction_id is not null then
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
    insert into public.order_items (order_id, product_id, name, quantity, unit_price, line_total, fraction_label, flavors, additions, notes, destination_sector)
    values (v_order_id, v_product.id, v_product.name, v_quantity, v_unit_price, round(v_unit_price * v_quantity, 2), v_fraction_label, v_flavors, v_additions,
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

revoke all on function public.pos_save_order(public.order_type,uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.pos_save_order(public.order_type,uuid,uuid,text,jsonb) to authenticated;

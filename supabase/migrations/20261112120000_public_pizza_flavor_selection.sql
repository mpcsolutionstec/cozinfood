-- Public menus support pizzas with one to four equal flavor shares.
-- Prices and flavor rows are recalculated server-side using the restaurant rule.

create or replace function public.resolve_public_pizza_flavors(
  p_restaurant_id uuid,
  p_primary_product_id uuid,
  p_flavors jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_primary public.products%rowtype;
  v_product public.products%rowtype;
  v_fraction public.product_fractions%rowtype;
  v_flavor jsonb;
  v_flavors jsonb := '[]'::jsonb;
  v_count integer;
  v_share numeric(8,5);
  v_share_sum numeric(8,5) := 0;
  v_price_max numeric(12,2) := 0;
  v_price_weighted numeric(12,2) := 0;
  v_unit_price numeric(12,2);
  v_fraction_name text;
  v_flavor_names text[] := array[]::text[];
  v_pricing public.fraction_pricing;
  v_seen_product_ids uuid[] := array[]::uuid[];
begin
  if p_flavors is null or jsonb_typeof(p_flavors) is distinct from 'array' then
    raise exception 'Formato de sabores invalido.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_flavors);
  if v_count < 1 or v_count > 4 then
    raise exception 'Selecione de 1 a 4 sabores.' using errcode = '22023';
  end if;

  select p.* into v_primary
  from public.products p
  join public.categories c on c.id = p.category_id
  where p.id = p_primary_product_id
    and p.restaurant_id = p_restaurant_id
    and p.active
    and c.slug = 'pizzas';
  if not found then raise exception 'A pizza selecionada nao esta disponivel.' using errcode = '22023'; end if;

  for v_flavor in select value from jsonb_array_elements(p_flavors) loop
    v_share := coalesce(nullif(v_flavor->>'fraction','')::numeric, 0);
    if v_share <= 0 or v_share > 1 then
      raise exception 'Fracao de sabor invalida.' using errcode = '22023';
    end if;

    select p.* into v_product
    from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = nullif(v_flavor->>'product_id','')::uuid
      and p.restaurant_id = p_restaurant_id
      and p.active
      and c.slug = 'pizzas';
    if not found then raise exception 'Um sabor de pizza nao esta disponivel.' using errcode = '22023'; end if;
    if v_product.id = any(v_seen_product_ids) then raise exception 'Escolha cada sabor uma unica vez.' using errcode = '22023'; end if;
    v_seen_product_ids := array_append(v_seen_product_ids, v_product.id);

    select pf.* into v_fraction
    from public.product_fractions pf
    where pf.id = nullif(v_flavor->>'product_fraction_id','')::uuid
      and pf.product_id = v_product.id
      and pf.active;
    if not found then raise exception 'Um sabor nao possui o tamanho selecionado.' using errcode = '22023'; end if;

    if v_fraction_name is null then v_fraction_name := v_fraction.name;
    elsif v_fraction_name <> v_fraction.name then
      raise exception 'Todos os sabores devem usar o mesmo tamanho.' using errcode = '22023';
    end if;
    v_share_sum := v_share_sum + v_share;
    v_price_max := greatest(v_price_max, v_fraction.price);
    v_price_weighted := v_price_weighted + v_fraction.price * v_share;
    v_flavor_names := array_append(v_flavor_names, concat(round(v_share * 100)::integer, '% ', v_product.name));
    v_flavors := v_flavors || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'product_fraction_id', v_fraction.id,
      'fraction', v_share
    ));
  end loop;

  if abs(v_share_sum - 1) > 0.0001 then raise exception 'As fracoes dos sabores devem somar 100%%.' using errcode = '22023'; end if;

  select r.fraction_pricing into v_pricing from public.restaurants r where r.id = p_restaurant_id;
  v_unit_price := case when v_pricing = 'media_ponderada' then v_price_weighted else v_price_max end;

  return jsonb_build_object(
    'unit_price', round(v_unit_price, 2),
    'fraction_label', concat(v_fraction_name, ' · ', array_to_string(v_flavor_names, ' / ')),
    'flavors', v_flavors
  );
end;
$$;

revoke all on function public.resolve_public_pizza_flavors(uuid,uuid,jsonb) from public, anon, authenticated;

create or replace function public.get_public_table_menu(p_qr_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_table public.tables%rowtype;
  v_menu jsonb;
begin
  select t.* into v_table from public.tables t where t.qr_token = p_qr_token;
  if not found then return null; end if;

  select jsonb_build_object(
    'table_id', v_table.id,
    'table_number', v_table.number,
    'table_status', v_table.status,
    'restaurant_name', r.name,
    'fraction_pricing', r.fraction_pricing,
    'pizza_flavors_enabled', true,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'description', p.description,
            'base_price', p.base_price, 'image_url', p.image_url, 'image_path', p.image_path,
            'accepts_fractions', p.accepts_fractions, 'destination_sector', p.destination_sector,
            'fractions', coalesce((
              select jsonb_agg(jsonb_build_object('id', pf.id, 'name', pf.name, 'serves', pf.serves, 'price', pf.price) order by pf.serves, pf.price)
              from public.product_fractions pf where pf.product_id = p.id and pf.active
            ), '[]'::jsonb)
          ) order by p.name)
          from public.products p where p.category_id = c.id and p.restaurant_id = r.id and p.active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c
      where c.restaurant_id = r.id and c.active
        and exists (select 1 from public.products p where p.category_id = c.id and p.restaurant_id = r.id and p.active)
    ), '[]'::jsonb)
  ) into v_menu
  from public.restaurants r where r.id = v_table.restaurant_id;
  return v_menu;
end;
$$;

create or replace function public.get_public_digital_menu(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  select r.* into v_restaurant from public.restaurants r where r.slug = p_slug and r.public_menu_enabled;
  if not found then return null; end if;

  return jsonb_build_object(
    'restaurant_name', v_restaurant.name,
    'description', v_restaurant.public_menu_description,
    'phone', v_restaurant.public_menu_phone,
    'fraction_pricing', v_restaurant.fraction_pricing,
    'pizza_flavors_enabled', true,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug,
        'products', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'description', p.description,
            'base_price', p.base_price, 'image_url', p.image_url, 'image_path', p.image_path,
            'accepts_fractions', p.accepts_fractions, 'destination_sector', p.destination_sector,
            'categories', jsonb_build_object('name', c.name, 'slug', c.slug),
            'fractions', coalesce((
              select jsonb_agg(jsonb_build_object('id', pf.id, 'name', pf.name, 'serves', pf.serves, 'price', pf.price) order by pf.serves, pf.price)
              from public.product_fractions pf where pf.product_id = p.id and pf.active
            ), '[]'::jsonb)
          ) order by p.name)
          from public.products p where p.category_id = c.id and p.restaurant_id = v_restaurant.id and p.active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c
      where c.restaurant_id = v_restaurant.id and c.active
        and exists (select 1 from public.products p where p.category_id = c.id and p.restaurant_id = v_restaurant.id and p.active)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_table_order(
  p_qr_token text,
  p_customer_name text,
  p_items jsonb,
  p_notes text default null,
  p_request_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_table public.tables%rowtype;
  v_submission public.table_order_submissions%rowtype;
  v_order_id uuid;
  v_order_number bigint;
  v_item jsonb;
  v_product public.products%rowtype;
  v_fraction public.product_fractions%rowtype;
  v_selection jsonb;
  v_flavors jsonb;
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
  if p_qr_token is null or length(p_qr_token) < 32 then raise exception 'QR Code invalido.' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 40 then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'As observacoes do pedido excedem o limite permitido.' using errcode = '22023'; end if;
  if p_request_id is null then raise exception 'Identificador da solicitacao invalido.' using errcode = '22023'; end if;

  select t.* into v_table from public.tables t where t.qr_token = p_qr_token for update;
  if not found then raise exception 'Esta mesa nao existe ou o QR Code foi renovado.' using errcode = 'P0002'; end if;
  if v_table.status = 'reservada' then raise exception 'Esta mesa esta reservada e nao pode receber pedidos pelo QR Code.' using errcode = '55000'; end if;

  select s.* into v_submission from public.table_order_submissions s where s.request_id = p_request_id;
  if found then
    if v_submission.table_id <> v_table.id then raise exception 'Este identificador ja foi usado em outra mesa.' using errcode = '22023'; end if;
    return v_submission.response;
  end if;

  select o.id, o.order_number into v_order_id, v_order_number
  from public.orders o
  where o.table_id = v_table.id and o.status not in ('entregue', 'cancelado')
  order by o.created_at desc limit 1 for update;

  if v_order_id is null then
    insert into public.orders(restaurant_id, table_id, order_type, status, customer_name, notes, created_by)
    values (v_table.restaurant_id, v_table.id,
      case when auth.uid() is null then 'qr'::public.order_type else 'salao'::public.order_type end,
      'pendente', nullif(v_customer_name, ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id, order_number into v_order_id, v_order_number;
  else
    update public.orders set customer_name = coalesce(customer_name, nullif(v_customer_name, '')),
      notes = case when nullif(trim(coalesce(p_notes, '')), '') is null then notes
        when nullif(notes, '') is null then trim(p_notes) else notes || E'\n' || trim(p_notes) end
    where id = v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_fraction_id := nullif(v_item->>'fraction_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_notes := left(trim(coalesce(v_item->>'notes', '')), 500);
    if v_product_id is null or v_quantity <= 0 or v_quantity > 99 then raise exception 'Item ou quantidade invalida no pedido.' using errcode = '22023'; end if;

    select p.* into v_product from public.products p
    where p.id = v_product_id and p.restaurant_id = v_table.restaurant_id and p.active;
    if not found then raise exception 'Um dos produtos nao esta mais disponivel.' using errcode = '22023'; end if;

    if v_item ? 'flavors' and jsonb_typeof(v_item->'flavors') is distinct from 'array' then raise exception 'Formato de sabores invalido.' using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(v_item->'flavors','[]'::jsonb)) > 0 then
      if v_fraction_id is not null then raise exception 'Use o tamanho dos sabores da pizza.' using errcode = '22023'; end if;
      v_selection := public.resolve_public_pizza_flavors(v_table.restaurant_id, v_product.id, v_item->'flavors');
      v_unit_price := (v_selection->>'unit_price')::numeric;
      v_fraction_label := v_selection->>'fraction_label';
      v_flavors := v_selection->'flavors';
    else
      if v_fraction_id is not null then
        select pf.* into v_fraction from public.product_fractions pf
        where pf.id = v_fraction_id and pf.product_id = v_product.id and pf.active;
        if not found then raise exception 'O tamanho escolhido nao esta mais disponivel.' using errcode = '22023'; end if;
        v_unit_price := v_fraction.price;
        v_fraction_label := v_fraction.name;
      else
        if v_product.accepts_fractions and exists(select 1 from public.product_fractions pf where pf.product_id = v_product.id and pf.active) then
          raise exception 'Selecione o tamanho de %.', v_product.name using errcode = '22023';
        end if;
        v_unit_price := v_product.base_price;
        v_fraction_label := null;
      end if;
      v_flavors := jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'product_fraction_id', v_fraction_id, 'fraction', 1));
    end if;

    insert into public.order_items(order_id, product_id, name, quantity, unit_price, line_total, fraction_label, flavors, destination_sector, notes)
    values(v_order_id, v_product.id, v_product.name, v_quantity, v_unit_price, round(v_quantity * v_unit_price, 2), v_fraction_label, v_flavors, v_product.destination_sector, nullif(v_item_notes, ''));
  end loop;

  select coalesce(o.total, 0) into v_total from public.orders o where o.id = v_order_id;
  v_response := jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'total', v_total, 'table_number', v_table.number);
  insert into public.table_order_submissions(request_id, table_id, order_id, response) values(p_request_id, v_table.id, v_order_id, v_response);
  return v_response;
end;
$$;

create or replace function public.submit_digital_menu_order(
  p_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_items jsonb,
  p_notes text default null,
  p_request_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_submission public.public_menu_submissions%rowtype;
  v_order_id uuid;
  v_order_number bigint;
  v_item jsonb;
  v_product public.products%rowtype;
  v_fraction public.product_fractions%rowtype;
  v_selection jsonb;
  v_flavors jsonb;
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

  select r.* into v_restaurant from public.restaurants r where r.slug = p_slug and r.public_menu_enabled;
  if not found then raise exception 'Este cardapio nao esta disponivel.' using errcode = 'P0002'; end if;
  if length(v_name) < 2 then raise exception 'Informe seu nome para o pedido.' using errcode = '22023'; end if;
  if length(v_phone) < 10 then raise exception 'Informe um telefone valido.' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 40 then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode = '22023'; end if;
  if length(coalesce(p_notes, '')) > 500 then raise exception 'A observacao excede o limite.' using errcode = '22023'; end if;

  insert into public.orders(restaurant_id, order_type, status, customer_name, customer_phone, notes, created_by)
  values(v_restaurant.id, 'balcao', 'pendente', v_name, v_phone, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id, order_number into v_order_id, v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_fraction_id := nullif(v_item->>'fraction_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    if v_product_id is null or v_quantity <= 0 or v_quantity > 99 then raise exception 'Produto ou quantidade invalida.' using errcode = '22023'; end if;
    select p.* into v_product from public.products p where p.id = v_product_id and p.restaurant_id = v_restaurant.id and p.active;
    if not found then raise exception 'Um produto nao esta mais disponivel.' using errcode = '22023'; end if;

    if v_item ? 'flavors' and jsonb_typeof(v_item->'flavors') is distinct from 'array' then raise exception 'Formato de sabores invalido.' using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(v_item->'flavors','[]'::jsonb)) > 0 then
      if v_fraction_id is not null then raise exception 'Use o tamanho dos sabores da pizza.' using errcode = '22023'; end if;
      v_selection := public.resolve_public_pizza_flavors(v_restaurant.id, v_product.id, v_item->'flavors');
      v_unit_price := (v_selection->>'unit_price')::numeric;
      v_fraction_label := v_selection->>'fraction_label';
      v_flavors := v_selection->'flavors';
    else
      if v_fraction_id is not null then
        select pf.* into v_fraction from public.product_fractions pf where pf.id = v_fraction_id and pf.product_id = v_product.id and pf.active;
        if not found then raise exception 'Um tamanho nao esta mais disponivel.' using errcode = '22023'; end if;
        v_unit_price := v_fraction.price;
        v_fraction_label := v_fraction.name;
      else
        if v_product.accepts_fractions and exists(select 1 from public.product_fractions pf where pf.product_id = v_product.id and pf.active) then
          raise exception 'Selecione o tamanho de %.', v_product.name using errcode = '22023';
        end if;
        v_unit_price := v_product.base_price;
        v_fraction_label := null;
      end if;
      v_flavors := jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'product_fraction_id', v_fraction_id, 'fraction', 1));
    end if;

    insert into public.order_items(order_id, product_id, name, quantity, unit_price, line_total, fraction_label, flavors, destination_sector)
    values(v_order_id, v_product.id, v_product.name, v_quantity, v_unit_price, round(v_quantity * v_unit_price, 2), v_fraction_label, v_flavors, v_product.destination_sector);
  end loop;

  select o.total into v_total from public.orders o where o.id = v_order_id;
  v_response := jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'total', v_total);
  insert into public.public_menu_submissions(request_id, restaurant_id, order_id, response) values(p_request_id, v_restaurant.id, v_order_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.get_public_table_menu(text) from public;
revoke all on function public.get_public_digital_menu(text) from public;
revoke all on function public.submit_table_order(text,text,jsonb,text,uuid) from public;
revoke all on function public.submit_digital_menu_order(text,text,text,jsonb,text,uuid) from public;
grant execute on function public.get_public_table_menu(text) to anon, authenticated;
grant execute on function public.get_public_digital_menu(text) to anon, authenticated;
grant execute on function public.submit_table_order(text,text,jsonb,text,uuid) to anon, authenticated;
grant execute on function public.submit_digital_menu_order(text,text,text,jsonb,text,uuid) to anon, authenticated;

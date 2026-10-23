-- Atendimento no salao e autoatendimento seguro por QR Code.
-- O token impresso na mesa e a unica identificacao publica da mesa; os precos
-- e os setores sempre sao calculados a partir do catalogo no banco.

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

revoke all on function public.get_public_table_menu(text) from public;
revoke all on function public.submit_table_order(text, text, jsonb, text, uuid) from public;
revoke all on function public.get_public_table_order_status(text, uuid) from public;
grant execute on function public.get_public_table_menu(text) to anon, authenticated;
grant execute on function public.submit_table_order(text, text, jsonb, text, uuid) to anon, authenticated;
grant execute on function public.get_public_table_order_status(text, uuid) to anon, authenticated;

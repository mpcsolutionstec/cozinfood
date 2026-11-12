-- Expose pizza borders/additions in both public menus and persist them on orders.
create or replace function public.get_public_table_menu(p_qr_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_table public.tables%rowtype; v_menu jsonb;
begin
  select * into v_table from public.tables where qr_token = p_qr_token;
  if not found then return null; end if;
  select jsonb_build_object(
    'table_id',v_table.id,'table_number',v_table.number,'table_status',v_table.status,'restaurant_name',r.name,
    'fraction_pricing',r.fraction_pricing,'pizza_flavors_enabled',true,
    'pizza_borders',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'price',b.price) order by b.name) from public.pizza_borders b where b.restaurant_id=r.id and b.active),'[]'::jsonb),
    'product_additions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'price',a.price) order by a.name) from public.product_additions a where a.restaurant_id=r.id and a.active),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'slug',c.slug,
      'products',coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.name,'description',p.description,'base_price',p.base_price,'image_url',p.image_url,'image_path',p.image_path,
        'accepts_fractions',p.accepts_fractions,'destination_sector',p.destination_sector,
        'fractions',coalesce((select jsonb_agg(jsonb_build_object('id',pf.id,'name',pf.name,'serves',pf.serves,'price',pf.price) order by pf.serves,pf.price) from public.product_fractions pf where pf.product_id=p.id and pf.active),'[]'::jsonb)
      ) order by p.name) from public.products p where p.category_id=c.id and p.restaurant_id=r.id and p.active),'[]'::jsonb)
    ) order by c.sort_order,c.name) from public.categories c where c.restaurant_id=r.id and c.active
      and exists(select 1 from public.products p where p.category_id=c.id and p.restaurant_id=r.id and p.active)),'[]'::jsonb)
  ) into v_menu from public.restaurants r where r.id=v_table.restaurant_id;
  return v_menu;
end $$;

create or replace function public.get_public_digital_menu(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_restaurant public.restaurants%rowtype;
begin
  select * into v_restaurant from public.restaurants where slug=p_slug and public_menu_enabled;
  if not found then return null; end if;
  return jsonb_build_object(
    'restaurant_name',v_restaurant.name,'description',v_restaurant.public_menu_description,'phone',v_restaurant.public_menu_phone,
    'fraction_pricing',v_restaurant.fraction_pricing,'pizza_flavors_enabled',true,
    'pizza_borders',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'price',b.price) order by b.name) from public.pizza_borders b where b.restaurant_id=v_restaurant.id and b.active),'[]'::jsonb),
    'product_additions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'price',a.price) order by a.name) from public.product_additions a where a.restaurant_id=v_restaurant.id and a.active),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'slug',c.slug,
      'products',coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.name,'description',p.description,'base_price',p.base_price,'image_url',p.image_url,'image_path',p.image_path,
        'accepts_fractions',p.accepts_fractions,'destination_sector',p.destination_sector,'categories',jsonb_build_object('name',c.name,'slug',c.slug),
        'fractions',coalesce((select jsonb_agg(jsonb_build_object('id',pf.id,'name',pf.name,'serves',pf.serves,'price',pf.price) order by pf.serves,pf.price) from public.product_fractions pf where pf.product_id=p.id and pf.active),'[]'::jsonb)
      ) order by p.name) from public.products p where p.category_id=c.id and p.restaurant_id=v_restaurant.id and p.active),'[]'::jsonb)
    ) order by c.sort_order,c.name) from public.categories c where c.restaurant_id=v_restaurant.id and c.active
      and exists(select 1 from public.products p where p.category_id=c.id and p.restaurant_id=v_restaurant.id and p.active)),'[]'::jsonb)
  );
end $$;

create or replace function public.submit_table_order(p_qr_token text,p_customer_name text,p_items jsonb,p_notes text default null,p_request_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_table public.tables%rowtype; v_submission public.table_order_submissions%rowtype; v_order_id uuid; v_order_number bigint;
  v_item jsonb; v_product public.products%rowtype; v_fraction public.product_fractions%rowtype; v_border public.pizza_borders%rowtype;
  v_addition public.product_additions%rowtype; v_addition_json jsonb; v_additions jsonb; v_selection jsonb; v_flavors jsonb;
  v_fraction_id uuid; v_border_id uuid; v_quantity numeric(10,2); v_addition_quantity numeric(10,2); v_unit_price numeric(12,2); v_fraction_label text;
  v_total numeric(12,2); v_name text:=left(trim(coalesce(p_customer_name,'')),80); v_item_notes text; v_response jsonb;
begin
  if p_qr_token is null or length(p_qr_token)<32 then raise exception 'QR Code invalido.' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 40 then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode='22023'; end if;
  if length(coalesce(p_notes,''))>1000 or p_request_id is null then raise exception 'Dados do pedido invalidos.' using errcode='22023'; end if;
  select * into v_table from public.tables where qr_token=p_qr_token for update;
  if not found then raise exception 'Esta mesa nao existe ou o QR Code foi renovado.' using errcode='P0002'; end if;
  if v_table.status='reservada' then raise exception 'Esta mesa esta reservada e nao pode receber pedidos pelo QR Code.' using errcode='55000'; end if;
  select * into v_submission from public.table_order_submissions where request_id=p_request_id;
  if found then if v_submission.table_id<>v_table.id then raise exception 'Este identificador ja foi usado em outra mesa.' using errcode='22023'; end if; return v_submission.response; end if;
  select id,order_number into v_order_id,v_order_number from public.orders where table_id=v_table.id and status not in ('entregue','cancelado') order by created_at desc limit 1 for update;
  if v_order_id is null then
    insert into public.orders(restaurant_id,table_id,order_type,status,customer_name,notes,created_by)
    values(v_table.restaurant_id,v_table.id,case when auth.uid() is null then 'qr'::public.order_type else 'salao'::public.order_type end,'pendente',nullif(v_name,''),nullif(trim(coalesce(p_notes,'')),''),auth.uid())
    returning id,order_number into v_order_id,v_order_number;
  else
    update public.orders set customer_name=coalesce(customer_name,nullif(v_name,'')),notes=case when nullif(trim(coalesce(p_notes,'')),'') is null then notes when nullif(notes,'') is null then trim(p_notes) else notes||E'\n'||trim(p_notes) end where id=v_order_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity:=coalesce((v_item->>'quantity')::numeric,1); v_fraction_id:=nullif(v_item->>'fraction_id','')::uuid; v_border_id:=null;
    v_item_notes:=left(trim(coalesce(v_item->>'notes','')),500);
    if v_quantity<=0 or v_quantity>99 then raise exception 'Item ou quantidade invalida no pedido.' using errcode='22023'; end if;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and restaurant_id=v_table.restaurant_id and active;
    if not found then raise exception 'Um dos produtos nao esta mais disponivel.' using errcode='22023'; end if;
    if v_item ? 'additions' and jsonb_typeof(v_item->'additions') is distinct from 'array' then raise exception 'Formato de adicionais invalido.' using errcode='22023'; end if;
    if (nullif(v_item->>'border_id','') is not null or jsonb_array_length(coalesce(v_item->'additions','[]'::jsonb))>0)
      and not exists(select 1 from public.categories c where c.id=v_product.category_id and c.slug='pizzas') then
      raise exception 'Borda e adicionais so podem ser escolhidos para pizzas.' using errcode='22023';
    end if;
    if v_item ? 'flavors' and jsonb_typeof(v_item->'flavors') is distinct from 'array' then raise exception 'Formato de sabores invalido.' using errcode='22023'; end if;
    if jsonb_array_length(coalesce(v_item->'flavors','[]'::jsonb))>0 then
      if v_fraction_id is not null then raise exception 'Use o tamanho dos sabores da pizza.' using errcode='22023'; end if;
      v_selection:=public.resolve_public_pizza_flavors(v_table.restaurant_id,v_product.id,v_item->'flavors');
      v_unit_price:=(v_selection->>'unit_price')::numeric; v_fraction_label:=v_selection->>'fraction_label'; v_flavors:=v_selection->'flavors';
    else
      if v_fraction_id is not null then select * into v_fraction from public.product_fractions where id=v_fraction_id and product_id=v_product.id and active; if not found then raise exception 'O tamanho escolhido nao esta mais disponivel.' using errcode='22023'; end if; v_unit_price:=v_fraction.price; v_fraction_label:=v_fraction.name;
      else if v_product.accepts_fractions and exists(select 1 from public.product_fractions where product_id=v_product.id and active) then raise exception 'Selecione o tamanho de %.',v_product.name using errcode='22023'; end if; v_unit_price:=v_product.base_price; v_fraction_label:=null; end if;
      v_flavors:=jsonb_build_array(jsonb_build_object('product_id',v_product.id,'product_fraction_id',v_fraction_id,'fraction',1));
    end if;
    v_additions:='[]'::jsonb;
    for v_addition_json in select value from jsonb_array_elements(coalesce(v_item->'additions','[]'::jsonb)) loop
      select * into v_addition from public.product_additions where id=nullif(v_addition_json->>'id','')::uuid and restaurant_id=v_table.restaurant_id and active;
      if not found then raise exception 'Um adicional nao esta mais disponivel.' using errcode='22023'; end if;
      v_addition_quantity:=coalesce(nullif(v_addition_json->>'quantity','')::numeric,1);
      if v_addition_quantity<=0 or v_addition_quantity>10 then raise exception 'Quantidade de adicional invalida.' using errcode='22023'; end if;
      v_unit_price:=v_unit_price+v_addition.price*v_addition_quantity;
      v_additions:=v_additions||jsonb_build_array(jsonb_build_object('id',v_addition.id,'quantity',v_addition_quantity));
    end loop;
    if nullif(v_item->>'border_id','') is not null then
      select * into v_border from public.pizza_borders where id=(v_item->>'border_id')::uuid and restaurant_id=v_table.restaurant_id and active;
      if not found then raise exception 'A borda selecionada nao esta mais disponivel.' using errcode='22023'; end if;
      v_unit_price:=v_unit_price+v_border.price; v_border_id:=v_border.id;
    end if;
    insert into public.order_items(order_id,product_id,name,quantity,unit_price,line_total,fraction_label,flavors,additions,border_id,destination_sector,notes)
    values(v_order_id,v_product.id,v_product.name,v_quantity,v_unit_price,round(v_unit_price*v_quantity,2),v_fraction_label,v_flavors,v_additions,v_border_id,v_product.destination_sector,nullif(v_item_notes,''));
  end loop;
  select coalesce(total,0) into v_total from public.orders where id=v_order_id;
  v_response:=jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'total',v_total,'table_number',v_table.number);
  insert into public.table_order_submissions(request_id,table_id,order_id,response) values(p_request_id,v_table.id,v_order_id,v_response);
  return v_response;
end $$;

create or replace function public.submit_digital_menu_order(p_slug text,p_customer_name text,p_customer_phone text,p_items jsonb,p_notes text default null,p_request_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant public.restaurants%rowtype; v_submission public.public_menu_submissions%rowtype; v_order_id uuid; v_order_number bigint;
  v_item jsonb; v_product public.products%rowtype; v_fraction public.product_fractions%rowtype; v_border public.pizza_borders%rowtype;
  v_addition public.product_additions%rowtype; v_addition_json jsonb; v_additions jsonb; v_selection jsonb; v_flavors jsonb;
  v_fraction_id uuid; v_border_id uuid; v_quantity numeric(10,2); v_addition_quantity numeric(10,2); v_unit_price numeric(12,2); v_fraction_label text;
  v_total numeric(12,2); v_response jsonb; v_name text:=left(trim(coalesce(p_customer_name,'')),80); v_phone text:=left(regexp_replace(coalesce(p_customer_phone,''),'[^0-9]','','g'),15);
begin
  if p_request_id is null then raise exception 'Identificador do pedido invalido.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_submission from public.public_menu_submissions where request_id=p_request_id; if found then return v_submission.response; end if;
  select * into v_restaurant from public.restaurants where slug=p_slug and public_menu_enabled;
  if not found then raise exception 'Este cardapio nao esta disponivel.' using errcode='P0002'; end if;
  if length(v_name)<2 then raise exception 'Informe seu nome para o pedido.' using errcode='22023'; end if;
  if length(v_phone)<10 then raise exception 'Informe um telefone valido.' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 40 then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode='22023'; end if;
  if length(coalesce(p_notes,''))>500 then raise exception 'A observacao excede o limite.' using errcode='22023'; end if;
  insert into public.orders(restaurant_id,order_type,status,customer_name,customer_phone,notes,created_by) values(v_restaurant.id,'balcao','pendente',v_name,v_phone,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id,order_number into v_order_id,v_order_number;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity:=coalesce((v_item->>'quantity')::numeric,1); v_fraction_id:=nullif(v_item->>'fraction_id','')::uuid; v_border_id:=null;
    if v_quantity<=0 or v_quantity>99 then raise exception 'Produto ou quantidade invalida.' using errcode='22023'; end if;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and restaurant_id=v_restaurant.id and active;
    if not found then raise exception 'Um produto nao esta mais disponivel.' using errcode='22023'; end if;
    if v_item ? 'additions' and jsonb_typeof(v_item->'additions') is distinct from 'array' then raise exception 'Formato de adicionais invalido.' using errcode='22023'; end if;
    if (nullif(v_item->>'border_id','') is not null or jsonb_array_length(coalesce(v_item->'additions','[]'::jsonb))>0)
      and not exists(select 1 from public.categories c where c.id=v_product.category_id and c.slug='pizzas') then
      raise exception 'Borda e adicionais so podem ser escolhidos para pizzas.' using errcode='22023';
    end if;
    if v_item ? 'flavors' and jsonb_typeof(v_item->'flavors') is distinct from 'array' then raise exception 'Formato de sabores invalido.' using errcode='22023'; end if;
    if jsonb_array_length(coalesce(v_item->'flavors','[]'::jsonb))>0 then
      if v_fraction_id is not null then raise exception 'Use o tamanho dos sabores da pizza.' using errcode='22023'; end if;
      v_selection:=public.resolve_public_pizza_flavors(v_restaurant.id,v_product.id,v_item->'flavors');
      v_unit_price:=(v_selection->>'unit_price')::numeric; v_fraction_label:=v_selection->>'fraction_label'; v_flavors:=v_selection->'flavors';
    else
      if v_fraction_id is not null then select * into v_fraction from public.product_fractions where id=v_fraction_id and product_id=v_product.id and active; if not found then raise exception 'Um tamanho nao esta mais disponivel.' using errcode='22023'; end if; v_unit_price:=v_fraction.price; v_fraction_label:=v_fraction.name;
      else if v_product.accepts_fractions and exists(select 1 from public.product_fractions where product_id=v_product.id and active) then raise exception 'Selecione o tamanho de %.',v_product.name using errcode='22023'; end if; v_unit_price:=v_product.base_price; v_fraction_label:=null; end if;
      v_flavors:=jsonb_build_array(jsonb_build_object('product_id',v_product.id,'product_fraction_id',v_fraction_id,'fraction',1));
    end if;
    v_additions:='[]'::jsonb;
    for v_addition_json in select value from jsonb_array_elements(coalesce(v_item->'additions','[]'::jsonb)) loop
      select * into v_addition from public.product_additions where id=nullif(v_addition_json->>'id','')::uuid and restaurant_id=v_restaurant.id and active;
      if not found then raise exception 'Um adicional nao esta mais disponivel.' using errcode='22023'; end if;
      v_addition_quantity:=coalesce(nullif(v_addition_json->>'quantity','')::numeric,1);
      if v_addition_quantity<=0 or v_addition_quantity>10 then raise exception 'Quantidade de adicional invalida.' using errcode='22023'; end if;
      v_unit_price:=v_unit_price+v_addition.price*v_addition_quantity;
      v_additions:=v_additions||jsonb_build_array(jsonb_build_object('id',v_addition.id,'quantity',v_addition_quantity));
    end loop;
    if nullif(v_item->>'border_id','') is not null then
      select * into v_border from public.pizza_borders where id=(v_item->>'border_id')::uuid and restaurant_id=v_restaurant.id and active;
      if not found then raise exception 'A borda selecionada nao esta mais disponivel.' using errcode='22023'; end if;
      v_unit_price:=v_unit_price+v_border.price; v_border_id:=v_border.id;
    end if;
    insert into public.order_items(order_id,product_id,name,quantity,unit_price,line_total,fraction_label,flavors,additions,border_id,destination_sector)
    values(v_order_id,v_product.id,v_product.name,v_quantity,v_unit_price,round(v_unit_price*v_quantity,2),v_fraction_label,v_flavors,v_additions,v_border_id,v_product.destination_sector);
  end loop;
  select total into v_total from public.orders where id=v_order_id;
  v_response:=jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'total',v_total);
  insert into public.public_menu_submissions(request_id,restaurant_id,order_id,response) values(p_request_id,v_restaurant.id,v_order_id,v_response);
  return v_response;
end $$;

revoke all on function public.get_public_table_menu(text) from public;
revoke all on function public.get_public_digital_menu(text) from public;
revoke all on function public.submit_table_order(text,text,jsonb,text,uuid) from public;
revoke all on function public.submit_digital_menu_order(text,text,text,jsonb,text,uuid) from public;
grant execute on function public.get_public_table_menu(text) to anon,authenticated;
grant execute on function public.get_public_digital_menu(text) to anon,authenticated;
grant execute on function public.submit_table_order(text,text,jsonb,text,uuid) to anon,authenticated;
grant execute on function public.submit_digital_menu_order(text,text,text,jsonb,text,uuid) to anon,authenticated;

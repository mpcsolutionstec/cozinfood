-- Persist item-level notes from the public digital menu for the KDS.
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
  v_border public.pizza_borders%rowtype;
  v_addition public.product_additions%rowtype;
  v_addition_json jsonb;
  v_additions jsonb;
  v_selection jsonb;
  v_flavors jsonb;
  v_fraction_id uuid;
  v_border_id uuid;
  v_quantity numeric(10,2);
  v_addition_quantity numeric(10,2);
  v_unit_price numeric(12,2);
  v_fraction_label text;
  v_item_notes text;
  v_total numeric(12,2);
  v_response jsonb;
  v_name text := left(trim(coalesce(p_customer_name, '')), 80);
  v_phone text := left(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g'), 15);
begin
  if p_request_id is null then raise exception 'Identificador do pedido invalido.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_submission from public.public_menu_submissions where request_id=p_request_id;
  if found then return v_submission.response; end if;

  select * into v_restaurant from public.restaurants where slug=p_slug and public_menu_enabled;
  if not found then raise exception 'Este cardapio nao esta disponivel.' using errcode='P0002'; end if;
  if length(v_name)<2 then raise exception 'Informe seu nome para o pedido.' using errcode='22023'; end if;
  if length(v_phone)<10 then raise exception 'Informe um telefone valido.' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 40 then raise exception 'Adicione entre 1 e 40 itens ao pedido.' using errcode='22023'; end if;
  if length(coalesce(p_notes,''))>500 then raise exception 'A observacao excede o limite.' using errcode='22023'; end if;

  insert into public.orders(restaurant_id,order_type,status,customer_name,customer_phone,notes,created_by)
  values(v_restaurant.id,'balcao','pendente',v_name,v_phone,nullif(trim(coalesce(p_notes,'')),''),auth.uid())
  returning id,order_number into v_order_id,v_order_number;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity:=coalesce((v_item->>'quantity')::numeric,1);
    v_fraction_id:=nullif(v_item->>'fraction_id','')::uuid;
    v_border_id:=null;
    v_item_notes:=left(trim(coalesce(v_item->>'notes','')),500);
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
      v_unit_price:=(v_selection->>'unit_price')::numeric;
      v_fraction_label:=v_selection->>'fraction_label';
      v_flavors:=v_selection->'flavors';
    else
      if v_fraction_id is not null then
        select * into v_fraction from public.product_fractions where id=v_fraction_id and product_id=v_product.id and active;
        if not found then raise exception 'Um tamanho nao esta mais disponivel.' using errcode='22023'; end if;
        v_unit_price:=v_fraction.price;
        v_fraction_label:=v_fraction.name;
      else
        if v_product.accepts_fractions and exists(select 1 from public.product_fractions where product_id=v_product.id and active) then
          raise exception 'Selecione o tamanho de %.',v_product.name using errcode='22023';
        end if;
        v_unit_price:=v_product.base_price;
        v_fraction_label:=null;
      end if;
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
      v_unit_price:=v_unit_price+v_border.price;
      v_border_id:=v_border.id;
    end if;

    insert into public.order_items(order_id,product_id,name,quantity,unit_price,line_total,fraction_label,flavors,additions,border_id,destination_sector,notes)
    values(v_order_id,v_product.id,v_product.name,v_quantity,v_unit_price,round(v_unit_price*v_quantity,2),v_fraction_label,v_flavors,v_additions,v_border_id,v_product.destination_sector,nullif(v_item_notes,''));
  end loop;

  select total into v_total from public.orders where id=v_order_id;
  v_response:=jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'total',v_total);
  insert into public.public_menu_submissions(request_id,restaurant_id,order_id,response) values(p_request_id,v_restaurant.id,v_order_id,v_response);
  return v_response;
end $$;

revoke all on function public.submit_digital_menu_order(text,text,text,jsonb,text,uuid) from public;
grant execute on function public.submit_digital_menu_order(text,text,text,jsonb,text,uuid) to anon,authenticated;

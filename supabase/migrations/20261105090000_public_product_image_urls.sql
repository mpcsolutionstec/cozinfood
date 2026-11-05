-- Public menu RPCs must return externally hosted product photos saved by the product catalog.
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
                'image_url', p.image_url,
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
            'image_url', p.image_url,
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

revoke all on function public.get_public_table_menu(text) from public;
grant execute on function public.get_public_table_menu(text) to anon, authenticated;
revoke all on function public.get_public_digital_menu(text) from public;
grant execute on function public.get_public_digital_menu(text) to anon, authenticated;

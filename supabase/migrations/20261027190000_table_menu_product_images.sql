-- Inclui o caminho da foto no menu publico aberto pelo QR Code da mesa.
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

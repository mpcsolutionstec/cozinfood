create policy restaurants_admin_update
  on public.restaurants
  for update to authenticated
  using (
    id = public.current_restaurant_id()
    and public.has_role(array['admin']::public.app_role[])
  )
  with check (
    id = public.current_restaurant_id()
    and public.has_role(array['admin']::public.app_role[])
  );

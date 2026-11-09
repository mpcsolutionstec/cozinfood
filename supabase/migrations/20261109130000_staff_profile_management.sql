-- Gerenciamento seguro dos membros e das funcoes da equipe do restaurante.
create or replace function public.list_restaurant_staff()
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  role public.app_role,
  active boolean,
  created_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Somente administradores podem consultar a equipe';
  end if;
  return query
    select p.id, p.full_name, u.email::text, p.phone, p.role, p.active, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    where p.restaurant_id = v_restaurant_id
    order by p.role, p.full_name;
end;
$$;

create or replace function public.update_staff_member(
  p_user_id uuid,
  p_role public.app_role,
  p_active boolean,
  p_full_name text,
  p_phone text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_admin_count integer;
  v_target public.profiles%rowtype;
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Somente administradores podem editar a equipe';
  end if;
  if p_role is null or p_role not in ('admin','garcom','caixa') then raise exception 'Funcao de equipe invalida'; end if;
  if p_active is null then raise exception 'Informe se o perfil esta ativo'; end if;
  if length(trim(coalesce(p_full_name,''))) not between 2 and 80 then
    raise exception 'O nome deve ter entre 2 e 80 caracteres';
  end if;
  if length(trim(coalesce(p_phone,''))) > 30 then raise exception 'O telefone deve ter ate 30 caracteres'; end if;

  perform 1 from public.restaurants where id = v_restaurant_id for update;
  select * into v_target from public.profiles
  where id = p_user_id and restaurant_id = v_restaurant_id for update;
  if not found then raise exception 'Usuario nao encontrado neste restaurante'; end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or not p_active) then
    raise exception 'Nao e permitido remover ou desativar seu proprio perfil de administrador';
  end if;

  if v_target.role = 'admin' and v_target.active and (p_role <> 'admin' or not p_active) then
    select count(*) into v_admin_count from public.profiles
    where restaurant_id = v_restaurant_id and role = 'admin' and active;
    if v_admin_count <= 1 then raise exception 'O restaurante precisa manter pelo menos um administrador ativo'; end if;
  end if;

  update public.profiles set role = p_role, active = p_active,
    full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone,'')), '')
  where id = p_user_id and restaurant_id = v_restaurant_id;
end;
$$;

revoke all on function public.list_restaurant_staff() from public, anon;
revoke all on function public.update_staff_member(uuid,public.app_role,boolean,text,text) from public, anon;
grant execute on function public.list_restaurant_staff() to authenticated;
grant execute on function public.update_staff_member(uuid,public.app_role,boolean,text,text) to authenticated;

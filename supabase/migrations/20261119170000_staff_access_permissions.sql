-- Per-user application access controls and password-based cashier accounts.
alter table public.profiles
  add column if not exists username text,
  add column if not exists permissions text[] not null default '{}';

create unique index if not exists profiles_username_ci_uidx
  on public.profiles (lower(username)) where username is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='profiles_username_format_check' and conrelid='public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_permissions_allowed_check' and conrelid='public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_permissions_allowed_check check (permissions <@
      array['waiter.access','pdv.access','pdv.sell','finance.cash.access','finance.cash.open','finance.cash.close',
        'finance.cash.withdrawal','finance.cash.reinforcement','finance.dashboard.access','finance.payables.access']::text[]);
  end if;
end $$;

-- Permission changes must go through the admin-only RPC, never a direct profile update.
revoke update on public.profiles from anon, authenticated;
revoke update (id,full_name,phone,role,restaurant_id,active,created_at,username,permissions) on public.profiles from anon, authenticated;
revoke insert,delete on public.profiles from anon, authenticated;
grant select (id,full_name,role,restaurant_id,active,username,permissions) on public.profiles to authenticated;

create or replace function public.default_staff_permissions(p_role public.app_role)
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select case p_role
    when 'admin' then array[]::text[]
    when 'garcom' then array['waiter.access']::text[]
    when 'caixa' then array[
      'pdv.access','pdv.sell','finance.cash.open','finance.cash.close'
    ]::text[]
    else array[]::text[] end;
$$;

create or replace function public.apply_default_staff_permissions()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.role is distinct from old.role then
    new.permissions := public.default_staff_permissions(new.role);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_default_staff_permissions on public.profiles;
create trigger profiles_default_staff_permissions before insert or update of role on public.profiles
for each row execute function public.apply_default_staff_permissions();

update public.profiles
set permissions = public.default_staff_permissions(role)
where coalesce(cardinality(permissions),0) = 0 and role <> 'admin';

create or replace function public.has_staff_permission(p_permission text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role public.app_role; v_permissions text[];
begin
  if auth.uid() is null or p_permission is null then return false; end if;
  select p.role,p.permissions into v_role,v_permissions
  from public.profiles p
  where p.id=auth.uid() and p.restaurant_id=public.current_restaurant_id() and p.active;
  if not found then return false; end if;
  if v_role='admin' then return true; end if;
  return p_permission = any(coalesce(v_permissions,'{}'::text[]));
end;
$$;

drop function if exists public.list_restaurant_staff();
create function public.list_restaurant_staff()
returns table (
  id uuid, full_name text, email text, phone text, username text,
  role public.app_role, active boolean, permissions text[], created_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Somente administradores podem consultar a equipe';
  end if;
  return query select p.id,p.full_name,u.email::text,p.phone,p.username,p.role,p.active,p.permissions,p.created_at
    from public.profiles p join auth.users u on u.id=p.id
    where p.restaurant_id=v_restaurant_id order by p.role,p.full_name;
end;
$$;

create or replace function public.update_staff_member(
  p_user_id uuid,p_role public.app_role,p_active boolean,p_full_name text,p_phone text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_admin_count integer; v_target public.profiles%rowtype;
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem editar a equipe'; end if;
  if p_role is null or p_role not in ('admin','garcom','caixa') then raise exception 'Funcao de equipe invalida'; end if;
  if p_active is null or length(trim(coalesce(p_full_name,''))) not between 2 and 80 then raise exception 'Informe nome e status validos'; end if;
  if length(trim(coalesce(p_phone,''))) > 30 then raise exception 'Telefone invalido'; end if;
  perform 1 from public.restaurants where id=v_restaurant_id for update;
  select * into v_target from public.profiles where id=p_user_id and restaurant_id=v_restaurant_id for update;
  if not found then raise exception 'Usuario nao encontrado neste restaurante'; end if;
  if p_user_id=auth.uid() and (p_role<>'admin' or not p_active) then raise exception 'Nao e permitido remover ou desativar seu proprio perfil de administrador'; end if;
  if v_target.role='admin' and v_target.active and (p_role<>'admin' or not p_active) then
    select count(*) into v_admin_count from public.profiles where restaurant_id=v_restaurant_id and role='admin' and active;
    if v_admin_count<=1 then raise exception 'O restaurante precisa manter pelo menos um administrador ativo'; end if;
  end if;
  update public.profiles set role=p_role,active=p_active,full_name=trim(p_full_name),phone=nullif(trim(coalesce(p_phone,'')),'')
  where id=p_user_id and restaurant_id=v_restaurant_id;
end;
$$;

create or replace function public.update_staff_permissions(p_user_id uuid,p_permissions text[])
returns text[] language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_role public.app_role; v_allowed text[];
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then raise exception 'Somente administradores podem alterar permissoes'; end if;
  if p_permissions is null then raise exception 'Selecione as permissoes do usuario'; end if;
  select role into v_role from public.profiles where id=p_user_id and restaurant_id=v_restaurant_id for update;
  if not found then raise exception 'Usuario nao encontrado neste restaurante'; end if;
  if v_role='admin' then raise exception 'Administradores possuem acesso completo e nao usam permissoes personalizadas'; end if;
  v_allowed := case v_role
    when 'caixa' then array['pdv.access','pdv.sell','finance.cash.access','finance.cash.open','finance.cash.close','finance.cash.withdrawal','finance.cash.reinforcement']::text[]
    when 'garcom' then array['waiter.access']::text[]
    else array[]::text[] end;
  if exists(select 1 from unnest(p_permissions) as item(permission) where not (permission = any(v_allowed))) then raise exception 'Uma ou mais permissoes nao sao validas para esta funcao'; end if;
  update public.profiles set permissions=(select coalesce(array_agg(distinct permission order by permission),'{}'::text[]) from unnest(p_permissions) as item(permission))
  where id=p_user_id and restaurant_id=v_restaurant_id;
  return (select permissions from public.profiles where id=p_user_id);
end;
$$;

-- Keep the cashier's direct table access bounded by the configured module grants.
drop policy if exists cash_registers_read_staff on public.cash_registers;
create policy cash_registers_read_staff on public.cash_registers for select to authenticated
  using (restaurant_id=public.current_restaurant_id() and
    (public.has_staff_permission('finance.cash.access') or public.has_staff_permission('pdv.access')));

revoke all on function public.default_staff_permissions(public.app_role) from public,anon,authenticated;
revoke all on function public.apply_default_staff_permissions() from public,anon,authenticated;
revoke all on function public.has_staff_permission(text) from public,anon;
revoke all on function public.list_restaurant_staff() from public,anon;
revoke all on function public.update_staff_member(uuid,public.app_role,boolean,text,text) from public,anon;
revoke all on function public.update_staff_permissions(uuid,text[]) from public,anon;
grant execute on function public.has_staff_permission(text) to authenticated;
grant execute on function public.list_restaurant_staff() to authenticated;
grant execute on function public.update_staff_member(uuid,public.app_role,boolean,text,text) to authenticated;
grant execute on function public.update_staff_permissions(uuid,text[]) to authenticated;

create or replace function public.get_finance_manager_status()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_row public.restaurant_finance_settings%rowtype;
begin
  if v_restaurant_id is null or not (public.has_staff_permission('finance.cash.access') or public.has_role(array['admin']::public.app_role[])) then
    raise exception 'Seu usuario nao tem permissao para acessar a configuracao do caixa';
  end if;
  select * into v_row from public.restaurant_finance_settings where restaurant_id=v_restaurant_id;
  return jsonb_build_object('configured',v_row.manager_password_hash is not null,
    'discrepancy_tolerance',coalesce(v_row.discrepancy_tolerance,1.00));
end;
$$;
revoke all on function public.get_finance_manager_status() from public,anon;
grant execute on function public.get_finance_manager_status() to authenticated;

-- Replace the broad read wrapper from the previous cash fix with a per-user module check.
create or replace function public.get_open_cash_register()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_register jsonb;
begin
  if v_restaurant_id is null or not (public.has_staff_permission('finance.cash.access') or public.has_staff_permission('pdv.access')) then
    raise exception 'Seu usuario nao tem permissao para consultar o caixa';
  end if;
  select jsonb_build_object('id',r.id,'restaurant_id',r.restaurant_id,'operator_id',r.operator_id,'opening_amount',r.opening_amount,
    'status',r.status,'opened_at',r.opened_at,'closed_at',r.closed_at,'created_at',r.created_at)
    into v_register from public.cash_registers r where r.restaurant_id=v_restaurant_id and r.status='aberto' limit 1;
  return v_register;
end;
$$;

-- Wrap sensitive operations while preserving the existing, atomic business logic.
do $$ begin
  if to_regprocedure('public.pos_save_order(public.order_type,uuid,uuid,text,jsonb)') is not null
     and to_regprocedure('public.pos_save_order_legacy(public.order_type,uuid,uuid,text,jsonb)') is null then
    alter function public.pos_save_order(public.order_type,uuid,uuid,text,jsonb) rename to pos_save_order_legacy;
  end if;
  if to_regprocedure('public.open_finance_cash_register(numeric)') is not null
     and to_regprocedure('public.open_finance_cash_register_legacy(numeric)') is null then
    alter function public.open_finance_cash_register(numeric) rename to open_finance_cash_register_legacy;
  end if;
  if to_regprocedure('public.create_cash_movement(uuid,public.cash_movement_type,numeric,text,uuid,text)') is not null
     and to_regprocedure('public.create_cash_movement_legacy(uuid,public.cash_movement_type,numeric,text,uuid,text)') is null then
    alter function public.create_cash_movement(uuid,public.cash_movement_type,numeric,text,uuid,text) rename to create_cash_movement_legacy;
  end if;
  if to_regprocedure('public.close_cash_register_blind(uuid,jsonb,text)') is not null
     and to_regprocedure('public.close_cash_register_blind_legacy(uuid,jsonb,text)') is null then
    alter function public.close_cash_register_blind(uuid,jsonb,text) rename to close_cash_register_blind_legacy;
  end if;
end $$;

create or replace function public.pos_save_order(p_order_type public.order_type,p_table_id uuid,p_order_id uuid,p_customer_name text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_staff_permission('pdv.access') then raise exception 'Seu usuario nao tem permissao para acessar o PDV'; end if;
  return public.pos_save_order_legacy(p_order_type,p_table_id,p_order_id,p_customer_name,p_items);
end;
$$;
create or replace function public.open_finance_cash_register(p_opening_amount numeric default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_staff_permission('finance.cash.open') then raise exception 'Seu usuario nao tem permissao para abrir o caixa'; end if;
  return public.open_finance_cash_register_legacy(p_opening_amount);
end;
$$;
create or replace function public.create_cash_movement(
  p_cash_register_id uuid,p_type public.cash_movement_type,p_amount numeric,p_description text,
  p_category_id uuid default null,p_manager_password text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_type='sangria' and not public.has_staff_permission('finance.cash.withdrawal') then raise exception 'Seu usuario nao tem permissao para registrar sangria'; end if;
  if p_type='reforco' and not public.has_staff_permission('finance.cash.reinforcement') then raise exception 'Seu usuario nao tem permissao para registrar reforco'; end if;
  return public.create_cash_movement_legacy(p_cash_register_id,p_type,p_amount,p_description,p_category_id,p_manager_password);
end;
$$;
create or replace function public.close_cash_register_blind(p_cash_register_id uuid,p_counted_breakdown jsonb,p_justification text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_staff_permission('finance.cash.close') then raise exception 'Seu usuario nao tem permissao para fechar o caixa'; end if;
  return public.close_cash_register_blind_legacy(p_cash_register_id,p_counted_breakdown,p_justification);
end;
$$;

revoke all on function public.pos_save_order_legacy(public.order_type,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.open_finance_cash_register_legacy(numeric) from public,anon,authenticated;
revoke all on function public.create_cash_movement_legacy(uuid,public.cash_movement_type,numeric,text,uuid,text) from public,anon,authenticated;
revoke all on function public.close_cash_register_blind_legacy(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.pos_save_order(public.order_type,uuid,uuid,text,jsonb) from public,anon;
revoke all on function public.open_finance_cash_register(numeric) from public,anon;
revoke all on function public.create_cash_movement(uuid,public.cash_movement_type,numeric,text,uuid,text) from public,anon;
revoke all on function public.close_cash_register_blind(uuid,jsonb,text) from public,anon;
grant execute on function public.pos_save_order(public.order_type,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.open_finance_cash_register(numeric) to authenticated;
grant execute on function public.create_cash_movement(uuid,public.cash_movement_type,numeric,text,uuid,text) to authenticated;
grant execute on function public.close_cash_register_blind(uuid,jsonb,text) to authenticated;

drop policy if exists financial_categories_read_staff on public.financial_categories;
create policy financial_categories_read_staff on public.financial_categories for select to authenticated
  using (restaurant_id=public.current_restaurant_id() and
    (public.has_staff_permission('finance.cash.access') or public.has_role(array['admin']::public.app_role[])));

-- Secure payment finalization behind a per-user permission check while preserving existing POS logic.
do $$ begin
  if to_regprocedure('public.pos_finalize_order(uuid,uuid,jsonb)') is not null
     and to_regprocedure('public.pos_finalize_order_legacy(uuid,uuid,jsonb)') is null then
    alter function public.pos_finalize_order(uuid,uuid,jsonb) rename to pos_finalize_order_legacy;
  end if;
end $$;
create or replace function public.pos_finalize_order(p_order_id uuid,p_cash_register_id uuid,p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_staff_permission('pdv.sell') then raise exception 'Seu usuario nao tem permissao para finalizar vendas no PDV'; end if;
  return public.pos_finalize_order_legacy(p_order_id,p_cash_register_id,p_payments);
end;
$$;
revoke all on function public.pos_finalize_order_legacy(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.pos_finalize_order(uuid,uuid,jsonb) from public,anon;
grant execute on function public.pos_finalize_order(uuid,uuid,jsonb) to authenticated;

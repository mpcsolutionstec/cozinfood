-- Independent active cash shifts per operator. Admins may target a selected shift for manual movements.
drop index if exists public.cash_register_one_open_per_restaurant_uidx;
create unique index if not exists cash_register_one_open_per_operator_uidx
  on public.cash_registers(restaurant_id,operator_id) where status='aberto';

create or replace function public.get_open_cash_register()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_restaurant_id uuid:=public.current_restaurant_id(); v_register jsonb;
begin
 if v_restaurant_id is null or not (public.has_staff_permission('finance.cash.access') or public.has_staff_permission('pdv.access')) then raise exception 'Sem permissao para consultar o caixa'; end if;
 select jsonb_build_object('id',r.id,'restaurant_id',r.restaurant_id,'operator_id',r.operator_id,'opening_amount',r.opening_amount,'status',r.status,'opened_at',r.opened_at,'closed_at',r.closed_at,'created_at',r.created_at)
 into v_register from public.cash_registers r where r.restaurant_id=v_restaurant_id and r.operator_id=auth.uid() and r.status='aberto' limit 1;
 return v_register;
end; $$;

create or replace function public.create_cash_movement(p_cash_register_id uuid,p_type public.cash_movement_type,p_amount numeric,p_description text,p_category_id uuid default null,p_manager_password text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_register public.cash_registers%rowtype;
begin
 select * into v_register from public.cash_registers where id=p_cash_register_id and restaurant_id=public.current_restaurant_id();
 if not found or v_register.status<>'aberto' then raise exception 'Turno de caixa nao encontrado'; end if;
 if v_register.operator_id<>auth.uid() and not public.has_role(array['admin']::public.app_role[]) then raise exception 'Este caixa nao pertence ao usuario logado'; end if;
 if p_type='sangria' and not (public.has_staff_permission('finance.cash.withdrawal') or public.has_role(array['admin']::public.app_role[])) then raise exception 'Sem permissao para sangria'; end if;
 if p_type='reforco' and not (public.has_staff_permission('finance.cash.reinforcement') or public.has_role(array['admin']::public.app_role[])) then raise exception 'Sem permissao para reforco'; end if;
 return public.create_cash_movement_legacy(p_cash_register_id,p_type,p_amount,p_description,p_category_id,p_manager_password);
end; $$;

create or replace function public.close_cash_register_blind(p_cash_register_id uuid,p_counted_breakdown jsonb,p_justification text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_register public.cash_registers%rowtype;
begin
 select * into v_register from public.cash_registers where id=p_cash_register_id and restaurant_id=public.current_restaurant_id();
 if not found or v_register.operator_id<>auth.uid() then raise exception 'Este caixa nao pertence ao usuario logado'; end if;
 if not public.has_staff_permission('finance.cash.close') then raise exception 'Sem permissao para fechar o caixa'; end if;
 return public.close_cash_register_blind_legacy(p_cash_register_id,p_counted_breakdown,p_justification);
end; $$;

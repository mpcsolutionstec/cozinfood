-- Allow the waiter workflow to reuse the POS order writer, and let cashier accounts handle team calls.
create or replace function public.pos_save_order(p_order_type public.order_type,p_table_id uuid,p_order_id uuid,p_customer_name text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (public.has_staff_permission('pdv.access') or public.has_staff_permission('waiter.access')) then
    raise exception 'Seu usuario nao tem permissao para enviar pedidos';
  end if;
  return public.pos_save_order_legacy(p_order_type,p_table_id,p_order_id,p_customer_name,p_items);
end;
$$;

 drop policy if exists table_service_calls_admin_select on public.table_service_calls;
create policy table_service_calls_admin_select on public.table_service_calls for select to authenticated
  using (restaurant_id=public.current_restaurant_id() and (public.has_role(array['admin']::public.app_role[]) or public.has_staff_permission('finance.cash.access')));

create or replace function public.list_table_service_calls()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id(); v_calls jsonb;
begin
  if v_restaurant_id is null or not (public.has_role(array['admin']::public.app_role[]) or public.has_staff_permission('finance.cash.access')) then
    raise exception 'Sem permissao para consultar chamados';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'created_at',c.created_at,'table_number',t.number) order by c.created_at),'[]'::jsonb)
    into v_calls from public.table_service_calls c join public.tables t on t.id=c.table_id
    where c.restaurant_id=v_restaurant_id and c.status='pendente';
  return v_calls;
end;
$$;

create or replace function public.resolve_table_service_call(p_call_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null or not (public.has_role(array['admin']::public.app_role[]) or public.has_staff_permission('finance.cash.access')) then
    raise exception 'Sem permissao para encerrar chamados';
  end if;
  update public.table_service_calls set status='atendido' where id=p_call_id and restaurant_id=v_restaurant_id and status='pendente';
end;
$$;

-- Read only safe cash-register metadata through a controlled RPC.
-- Keeps expected_amount and audit fields inaccessible to the cashier before blind close.
create or replace function public.get_open_cash_register()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_register jsonb;
begin
  if v_restaurant_id is null
     or not public.has_role(array['admin','caixa']::public.app_role[]) then
    raise exception 'Sem permissao para consultar o caixa';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'restaurant_id', r.restaurant_id,
    'operator_id', r.operator_id,
    'opening_amount', r.opening_amount,
    'status', r.status,
    'opened_at', r.opened_at,
    'closed_at', r.closed_at,
    'created_at', r.created_at
  )
  into v_register
  from public.cash_registers r
  where r.restaurant_id = v_restaurant_id
    and r.status = 'aberto'
  limit 1;

  return v_register;
end;
$$;

revoke all on function public.get_open_cash_register() from public, anon;
grant execute on function public.get_open_cash_register() to authenticated;

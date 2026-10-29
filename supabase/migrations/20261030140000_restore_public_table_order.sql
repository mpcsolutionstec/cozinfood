-- Recupera a comanda aberta ao reabrir o mesmo QR Code da mesa.
create or replace function public.get_public_table_open_order(p_qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_table_id uuid;
  v_order_id uuid;
begin
  if p_qr_token is null or length(p_qr_token) < 32 then return null; end if;
  select t.id into v_table_id from public.tables t where t.qr_token = p_qr_token;
  if v_table_id is null then return null; end if;

  select o.id into v_order_id
  from public.orders o
  where o.table_id = v_table_id and o.status not in ('entregue','cancelado')
  order by o.created_at desc
  limit 1;
  if v_order_id is null then return null; end if;

  return public.get_public_table_order_status(p_qr_token, v_order_id);
end;
$$;
revoke all on function public.get_public_table_open_order(text) from public;
grant execute on function public.get_public_table_open_order(text) to anon, authenticated;

-- App mobile de atendimento: pedidos idempotentes, ocupacao de mesa e chamados.
alter table public.orders add column if not exists guest_count integer not null default 1 check (guest_count between 1 and 30);

create table if not exists public.table_service_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.tables(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  kind text not null default 'chamar_gerente' check (kind in ('chamar_gerente','dividir_conta')),
  status text not null default 'pendente' check (status in ('pendente','atendido','cancelado')),
  created_at timestamptz not null default now()
);
alter table public.table_service_calls enable row level security;
revoke all on public.table_service_calls from public, anon, authenticated;
grant select on public.table_service_calls to authenticated;
drop policy if exists table_service_calls_admin_select on public.table_service_calls;
create policy table_service_calls_admin_select on public.table_service_calls for select to authenticated
  using (restaurant_id = public.current_restaurant_id() and public.has_role(array['admin']::public.app_role[]));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_service_calls') then
    alter publication supabase_realtime add table public.table_service_calls;
  end if;
end;
$$;

create or replace function public.list_table_service_calls()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_calls jsonb;
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissao para consultar chamados';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'created_at',c.created_at,'table_number',t.number) order by c.created_at), '[]'::jsonb)
    into v_calls from public.table_service_calls c join public.tables t on t.id = c.table_id
    where c.restaurant_id = v_restaurant_id and c.status = 'pendente';
  return v_calls;
end;
$$;

create or replace function public.resolve_table_service_call(p_call_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
begin
  if v_restaurant_id is null or not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissao para encerrar chamados';
  end if;
  update public.table_service_calls set status = 'atendido'
  where id = p_call_id and restaurant_id = v_restaurant_id and status = 'pendente';
end;
$$;

create or replace function public.submit_waiter_order(
  p_table_id uuid,
  p_customer_name text,
  p_guest_count integer,
  p_items jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_table public.tables%rowtype;
  v_order_id uuid;
  v_item jsonb;
  v_saved jsonb;
  v_response jsonb;
  v_border public.pizza_borders%rowtype;
  v_item_id uuid;
  v_previous_item_ids uuid[];
  v_submission public.table_order_submissions%rowtype;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','garcom']::public.app_role[]) then
    raise exception 'Sem permissao para registrar pedido de garcom';
  end if;
  if p_request_id is null then raise exception 'Identificador do pedido ausente'; end if;
  if p_guest_count is null or p_guest_count not between 1 and 30 then raise exception 'Informe de 1 a 30 clientes'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 80 then
    raise exception 'Adicione de 1 a 80 itens ao pedido';
  end if;

  select * into v_table from public.tables where id = p_table_id and restaurant_id = v_restaurant_id for update;
  if not found then raise exception 'Mesa nao encontrada neste restaurante'; end if;
  if v_table.status = 'reservada' then raise exception 'Esta mesa esta reservada'; end if;

  select * into v_submission from public.table_order_submissions where request_id = p_request_id;
  if found then
    if v_submission.table_id <> p_table_id then raise exception 'Este pedido ja foi usado em outra mesa'; end if;
    return v_submission.response;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select coalesce(array_agg(id), '{}'::uuid[]) into v_previous_item_ids
      from public.order_items where order_id = v_order_id;
    v_saved := public.pos_save_order('salao'::public.order_type, p_table_id, v_order_id, p_customer_name,
      jsonb_build_array(v_item - 'border_id'));
    v_order_id := (v_saved->>'id')::uuid;

    if nullif(v_item->>'border_id','') is not null then
      select * into v_border from public.pizza_borders
      where id = (v_item->>'border_id')::uuid and restaurant_id = v_restaurant_id and active;
      if not found then raise exception 'A borda selecionada nao esta mais disponivel'; end if;
      select id into v_item_id from public.order_items
      where order_id = v_order_id and border_id is null and not (id = any(v_previous_item_ids))
      order by created_at desc limit 1;
      if v_item_id is null then raise exception 'Nao foi possivel localizar o item com borda'; end if;
      update public.order_items set border_id = v_border.id,
        unit_price = unit_price + v_border.price,
        line_total = round((unit_price + v_border.price) * quantity, 2)
      where id = v_item_id;
    end if;
  end loop;

  update public.orders set guest_count = p_guest_count where id = v_order_id;
  select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status, 'total', o.total, 'table_id', o.table_id)
    into v_response from public.orders o where o.id = v_order_id;
  insert into public.table_order_submissions(request_id, table_id, order_id, response)
  values (p_request_id, p_table_id, v_order_id, v_response);
  return v_response;
end;
$$;

create or replace function public.waiter_table_action(p_table_id uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_table public.tables%rowtype;
  v_open_order uuid;
begin
  if v_restaurant_id is null or not public.has_role(array['admin','garcom']::public.app_role[]) then
    raise exception 'Sem permissao para atualizar esta mesa';
  end if;
  select * into v_table from public.tables where id = p_table_id and restaurant_id = v_restaurant_id for update;
  if not found then raise exception 'Mesa nao encontrada'; end if;

  if p_action = 'pedir_conta' then
    if v_table.status = 'livre' then raise exception 'Esta mesa nao possui atendimento aberto'; end if;
    select id into v_open_order from public.orders where table_id = p_table_id and restaurant_id = v_restaurant_id
      and status not in ('entregue','cancelado') order by created_at desc limit 1;
    if v_open_order is null then raise exception 'Nenhuma comanda aberta nesta mesa'; end if;
    update public.tables set status = 'aguardando_conta' where id = p_table_id;
    return jsonb_build_object('ok', true, 'table_id', p_table_id, 'order_id', v_open_order);
  elsif p_action in ('chamar_gerente','dividir_conta') then
    insert into public.table_service_calls(restaurant_id, table_id, created_by, kind)
    values (v_restaurant_id, p_table_id, auth.uid(), p_action);
    return jsonb_build_object('ok', true, 'table_id', p_table_id);
  end if;
  raise exception 'Acao de mesa invalida';
end;
$$;

revoke all on function public.submit_waiter_order(uuid,text,integer,jsonb,uuid) from public, anon;
revoke all on function public.waiter_table_action(uuid,text) from public, anon;
revoke all on function public.list_table_service_calls() from public, anon;
revoke all on function public.resolve_table_service_call(uuid) from public, anon;
grant execute on function public.submit_waiter_order(uuid,text,integer,jsonb,uuid) to authenticated;
grant execute on function public.waiter_table_action(uuid,text) to authenticated;
grant execute on function public.list_table_service_calls() to authenticated;
grant execute on function public.resolve_table_service_call(uuid) to authenticated;

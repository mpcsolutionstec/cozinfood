-- Divisao segura da comanda e cobranca Pix por participante.
alter table public.order_splits
  add column if not exists customer_email text;

alter table public.payments
  add column if not exists split_id uuid unique references public.order_splits(id) on delete set null,
  add column if not exists pix_qr_code text,
  add column if not exists pix_qr_code_base64 text,
  add column if not exists pix_ticket_url text;

create or replace function public.create_order_splits(
  p_order_id uuid,
  p_mode text,
  p_people integer default 0,
  p_definitions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.orders%rowtype;
  v_role public.app_role;
  v_total numeric(12,2);
  v_index integer := 0;
  v_share numeric(12,2);
  v_split_id uuid;
  v_definition jsonb;
  v_allocation jsonb;
  v_item public.order_items%rowtype;
  v_qty numeric(10,2);
  v_amount numeric(12,2);
  v_sum numeric(12,2);
  v_result jsonb := '[]'::jsonb;
begin
  select role into v_role from public.profiles
  where id = auth.uid() and active and restaurant_id = (select restaurant_id from public.orders where id=p_order_id);
  if v_role is null or v_role not in ('admin','caixa','garcom') then
    raise exception 'Sem permissao para dividir esta comanda';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.table_id is null or v_order.status in ('entregue','cancelado') then
    raise exception 'Comanda de mesa aberta nao encontrada';
  end if;
  if exists(select 1 from public.order_splits where order_id=p_order_id and status in ('aguardando','pago')) then
    raise exception 'Ja existe Pix emitido ou pago. Nao e possivel alterar a divisao';
  end if;
  delete from public.order_splits where order_id=p_order_id;

  if p_mode = 'equal' then
    if p_people not between 2 and 20 then raise exception 'Divida entre 2 e 20 pessoas'; end if;
    v_total := coalesce(v_order.total,0);
    if v_total <= 0 then raise exception 'A comanda nao possui valor para dividir'; end if;
    for v_index in 1..p_people loop
      v_share := case when v_index < p_people then trunc((v_total/p_people)*100)/100 else v_total - trunc((v_total/p_people)*100)/100*(p_people-1) end;
      v_definition := coalesce(p_definitions->(v_index-1), '{}'::jsonb);
      insert into public.order_splits(order_id,split_number,amount,customer_label,customer_email)
      values(p_order_id,v_index,v_share,left(nullif(trim(v_definition->>'customer_label'),''),80),lower(nullif(trim(v_definition->>'customer_email'),'')))
      returning id into v_split_id;
    end loop;
  elsif p_mode = 'items' then
    if jsonb_typeof(p_definitions) <> 'array' or jsonb_array_length(p_definitions) not between 1 and 30 then
      raise exception 'Selecione de 1 a 30 itens para dividir';
    end if;
    for v_definition in select value from jsonb_array_elements(p_definitions) loop
      if length(trim(coalesce(v_definition->>'customer_email',''))) < 5 or position('@' in (v_definition->>'customer_email')) < 2 then
        raise exception 'Informe o e-mail do pagador para cada Pix';
      end if;
      v_amount := 0;
      for v_allocation in select value from jsonb_array_elements(coalesce(v_definition->'items','[]'::jsonb)) loop
        select * into v_item from public.order_items where id=(v_allocation->>'item_id')::uuid and order_id=p_order_id and status<>'cancelado' for update;
        if not found then raise exception 'Um item selecionado nao pertence a esta comanda'; end if;
        v_qty := coalesce(nullif(v_allocation->>'quantity','')::numeric,v_item.quantity);
        if v_qty <= 0 or v_qty > v_item.quantity then raise exception 'Quantidade invalida para o item %',v_item.name; end if;
        if exists(select 1 from public.order_split_items si join public.order_splits s on s.id=si.split_id where si.order_item_id=v_item.id) then
          raise exception 'O item % ja foi atribuido a outra parte da conta',v_item.name;
        end if;
        v_amount := v_amount + round(v_item.line_total*v_qty/v_item.quantity,2);
      end loop;
      if v_amount <= 0 then raise exception 'Cada parte precisa ter pelo menos um item'; end if;
      insert into public.order_splits(order_id,split_number,amount,customer_label,customer_email)
      values(p_order_id,100+v_index+1,v_amount,left(nullif(trim(v_definition->>'customer_label'),''),80),lower(trim(v_definition->>'customer_email')))
      returning id into v_split_id;
      for v_allocation in select value from jsonb_array_elements(coalesce(v_definition->'items','[]'::jsonb)) loop
        insert into public.order_split_items(split_id,order_item_id,quantity)
        values(v_split_id,(v_allocation->>'item_id')::uuid,coalesce(nullif(v_allocation->>'quantity','')::numeric,(select quantity from public.order_items where id=(v_allocation->>'item_id')::uuid)));
      end loop;
      v_index := v_index+1;
    end loop;
  else
    raise exception 'Modo de divisao invalido';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'token',token,'amount',amount,'customer_label',customer_label,'customer_email',customer_email) order by split_number),'[]'::jsonb)
  into v_result from public.order_splits where order_id=p_order_id;
  return v_result;
end;
$$;
revoke all on function public.create_order_splits(uuid,text,integer,jsonb) from public, anon;
grant execute on function public.create_order_splits(uuid,text,integer,jsonb) to authenticated;

create or replace function public.sync_split_payment_status()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_order_id uuid;
begin
  if new.split_id is null then return new; end if;
  update public.order_splits set status=new.status where id=new.split_id returning order_id into v_order_id;
  if v_order_id is not null then
    update public.orders set payment_state=case
      when (select coalesce(sum(amount),0) from public.order_splits where order_id=v_order_id and status='pago') >= (select total from public.orders where id=v_order_id) then 'pago'::public.payment_status
      else 'pendente'::public.payment_status
    end where id=v_order_id;
  end if;
  return new;
end;
$$;
drop trigger if exists payments_sync_split_status on public.payments;
create trigger payments_sync_split_status after insert or update of status on public.payments
for each row execute function public.sync_split_payment_status();
revoke execute on function public.sync_split_payment_status() from public, anon, authenticated;

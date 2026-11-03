-- Cadastro de produtos de venda rápida: bebidas, sucos, chocolates e similares.
do $$ begin
  create type public.item_unit_enum as enum ('un', 'g', 'kg', 'ml', 'l', 'cx', 'pct');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sector_enum as enum ('cozinha', 'bar', 'forno_pizza');
exception when duplicate_object then null;
end $$;

alter table public.products
  add column if not exists cost_price numeric(10,2) not null default 0.00 check (cost_price >= 0),
  add column if not exists sale_price numeric(10,2),
  add column if not exists stock_quantity numeric(10,2) not null default 0.00 check (stock_quantity >= 0),
  add column if not exists min_stock numeric(10,2) not null default 5.00 check (min_stock >= 0),
  add column if not exists unit_measure public.item_unit_enum not null default 'un',
  add column if not exists image_url text;

update public.products set sale_price = base_price where sale_price is null;
alter table public.products alter column sale_price set default 0.00;
alter table public.products alter column sale_price set not null;
alter table public.products add constraint products_sale_price_nonnegative check (sale_price >= 0) not valid;
alter table public.products validate constraint products_sale_price_nonnegative;

-- Keep destination_sector as text to preserve existing constraints and clients.
alter table public.products alter column destination_sector set default 'bar';

create or replace function public.sync_product_sale_price()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.sale_price is distinct from old.sale_price then
      new.base_price := new.sale_price;
    elsif new.base_price is distinct from old.base_price then
      new.sale_price := new.base_price;
    end if;
  elsif coalesce(new.sale_price, 0) = 0 and coalesce(new.base_price, 0) > 0 then
    new.sale_price := new.base_price;
  else
    new.base_price := new.sale_price;
  end if;
  return new;
end;
$$;

drop trigger if exists products_sync_sale_price on public.products;
create trigger products_sync_sale_price before insert or update of sale_price, base_price on public.products for each row execute function public.sync_product_sale_price();

create index if not exists products_restaurant_stock_alert_idx on public.products (restaurant_id, stock_quantity) where active;
-- Barcodes remain unique per restaurant so multiple units may use the same supplier barcode.
create unique index if not exists products_restaurant_barcode_uidx on public.products (restaurant_id, barcode) where barcode is not null and length(trim(barcode)) > 0;

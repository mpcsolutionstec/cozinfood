-- KDS delivery completes kitchen items only; payment in the POS closes table accounts.
drop trigger if exists order_items_close_table_order on public.order_items;
drop function if exists public.close_table_order_when_items_terminal();

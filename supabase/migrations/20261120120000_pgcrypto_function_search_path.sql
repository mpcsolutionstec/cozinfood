-- Make pgcrypto visible inside security-definer routines that hash manager passwords.
-- Supabase commonly installs pgcrypto in the extensions schema.
alter function public.set_finance_manager_password(text,numeric)
  set search_path = public, extensions, pg_temp;
alter function public.create_cash_movement_legacy(uuid,public.cash_movement_type,numeric,text,uuid,text)
  set search_path = public, extensions, pg_temp;

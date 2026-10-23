do $$ begin
  alter publication supabase_realtime add table public.stock_movements;
exception when duplicate_object then null;
end $$;

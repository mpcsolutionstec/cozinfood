alter table public.tables
  add column if not exists image_key text not null default 'round_2'
  check (image_key in ('round_2', 'square_4', 'rectangle_6', 'rectangle_8'));

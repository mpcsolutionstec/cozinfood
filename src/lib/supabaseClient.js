import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && publicKey ? createClient(url, publicKey, { auth:{persistSession:true,autoRefreshToken:true}, realtime:{params:{eventsPerSecond:10}} }) : null;
export const isSupabaseConfigured = Boolean(supabase);

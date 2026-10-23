import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const columns = 'id,number,status,current_total,capacity,image_key,qr_token,created_at';

export function useTableStatus() {
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase) return { error: new Error('Supabase não está configurado.') };
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('tables')
      .select(columns)
      .order('number');
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return { error: queryError };
    }
    setTables(data || []);
    setError('');
    setLoading(false);
    return { error: null };
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const load = async () => {
      const { data, error: queryError } = await supabase
        .from('tables')
        .select(columns)
        .order('number');
      if (!active) return;
      if (queryError) setError(queryError.message);
      else {
        setTables(data || []);
        setError('');
      }
      setLoading(false);
    };
    load();
    const channel = supabase
      .channel('tables-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, load)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return { tables, live: Boolean(supabase), loading, error, refresh };
}

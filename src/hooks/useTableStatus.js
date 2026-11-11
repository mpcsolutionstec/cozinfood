import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const columns = 'id,number,status,current_total,capacity,image_key,qr_token,created_at';
const timeoutMs = 15000;

async function fetchTables() {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const { data, error } = await supabase
      .from('tables')
      .select(columns)
      .order('number')
      .abortSignal(controller.signal);
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    return {
      data: null,
      error: timedOut ? new Error('A conexão com o salão demorou mais que 15 segundos. Verifique a internet e tente novamente.') : error,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function useTableStatus() {
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase) return { error: new Error('Supabase não está configurado.') };
    setLoading(true);
    const { data, error: queryError } = await fetchTables();
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
      const { data, error: queryError } = await fetchTables();
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

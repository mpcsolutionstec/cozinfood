import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const activeStatuses = ['pendente', 'em_preparo', 'pronto'];
const selectFields = 'id,name,product_id,quantity,destination_sector,status,created_at,started_at,ready_at,notes,fraction_label,flavors,additions,order_id,products(prep_minutes),orders(order_number,order_type,customer_name,table_id,tables(number))';

function presentItem(item) {
  const order = item.orders || {};
  const relatedTable = order.tables;
  return {
    ...item,
    order_number: order.order_number,
    order_type: order.order_type,
    customer_name: order.customer_name,
    table_number: Array.isArray(relatedTable) ? relatedTable[0]?.number : relatedTable?.number,
    prep_minutes: item.products?.prep_minutes || 15,
  };
}

export function useKDSOrders(sector = 'all', channelScope = 'screen') {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) return { error: new Error('Supabase não está configurado.') };
    setLoading(true);
    let query = supabase
      .from('order_items')
      .select(selectFields)
      .in('status', activeStatuses)
      .order('created_at', { ascending: true });
    if (sector !== 'all') query = query.eq('destination_sector', sector);
    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return { error: queryError };
    }
    setOrders((data || []).map(presentItem));
    setError('');
    setLoading(false);
    return { error: null };
  }, [sector]);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    setLoading(true);
    setOrders([]);
    const load = async () => {
      let query = supabase
        .from('order_items')
        .select(selectFields)
        .in('status', activeStatuses)
        .order('created_at', { ascending: true });
      if (sector !== 'all') query = query.eq('destination_sector', sector);
      const { data, error: queryError } = await query;
      if (!active) return;
      if (queryError) setError(queryError.message);
      else {
        setOrders((data || []).map(presentItem));
        setError('');
      }
      setLoading(false);
    };

    load();
    const channel = supabase
      .channel(`kds-${channelScope}-${sector}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, load)
      .subscribe(status => setConnected(status === 'SUBSCRIBED'));

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [channelScope, sector]);

  const changeStatus = useCallback(async (ids, status) => {
    if (!supabase) throw new Error('Supabase não está configurado.');
    const itemIds = Array.isArray(ids) ? ids : [ids];
    const updates = { status };
    const now = new Date().toISOString();
    if (status === 'em_preparo') updates.started_at = now;
    if (status === 'pronto') updates.ready_at = now;
    const { error: updateError } = await supabase
      .from('order_items')
      .update(updates)
      .in('id', itemIds);
    if (updateError) throw updateError;
    return refresh();
  }, [refresh]);

  return { orders, changeStatus, refresh, loading, error, live: connected };
}

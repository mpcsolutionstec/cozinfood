import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ClipboardList, Clock3, CircleDollarSign, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const orderStates = {
  pendente: ['Aguardando', 'yellow'],
  em_preparo: ['Em preparo', 'blue'],
  pronto: ['Pronto', 'green'],
  entregue: ['Entregue', 'green'],
  cancelado: ['Cancelado', ''],
  aguardando_conta: ['Aguardando conta', 'yellow'],
};

function dateAtLocalMidnight(daysAgo = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

async function fetchOrdersSince(restaurantId, start) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('orders')
      .select('id,order_number,order_type,customer_name,status,total,payment_state,created_at,table_id')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchReadyItems(orders) {
  if (!orders.length) return [];
  const byId = new Map(orders.map(order => [order.id, order]));
  const orderIds = [...byId.keys()];
  const items = [];
  for (let offset = 0; offset < orderIds.length; offset += 25) {
    const { data, error } = await supabase.from('order_items')
      .select('order_id,created_at,ready_at,status')
      .in('order_id', orderIds.slice(offset, offset + 25))
      .in('status', ['pronto', 'entregue'])
      .not('ready_at', 'is', null);
    if (error) throw error;
    for (const item of data || []) {
      if (byId.has(item.order_id)) items.push(item);
    }
  }
  return items;
}

function percentChange(current, previous) {
  if (!previous) return current ? 'Novo' : '0%';
  const percent = ((current - previous) / previous) * 100;
  return `${percent > 0 ? '+' : ''}${percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function minutesChange(current, previous) {
  if (current == null) return 'Sem dados';
  if (previous == null) return 'Sem base';
  const delta = Math.round(current - previous);
  return `${delta > 0 ? '+' : ''}${delta} min`;
}

function Stat({ label, value, delta, icon: Icon, color, lowerIsBetter = false }) {
  const deltaNumber = Number.parseFloat(String(delta).replace(',', '.'));
  const noComparison = delta === 'Sem dados' || delta === 'Sem base';
  const favorable = delta === 'Novo' ? !lowerIsBetter : lowerIsBetter ? deltaNumber <= 0 : deltaNumber >= 0;
  return <article className="stat">
    <div className="stat-top"><span>{label}</span><span className={`stat-icon ${color}`}><Icon size={18}/></span></div>
    <b className="stat-value">{value}</b>
    <div className="stat-foot"><span className={noComparison ? '' : favorable ? 'positive' : 'negative'}>{delta}</span> vs. ontem</div>
  </article>;
}

function relativeTime(value, now = Date.now()) {
  const elapsed = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (elapsed < 1) return 'agora';
  if (elapsed < 60) return `há ${elapsed} min`;
  const hours = Math.floor(elapsed / 60);
  return `há ${hours} h`;
}

function orderOrigin(order, tableMap) {
  if (order.table_id) return `Mesa ${tableMap.get(order.table_id)?.number ?? '—'}`;
  if (order.order_type === 'delivery') return 'Delivery';
  if (order.order_type === 'balcao') return 'Balcão';
  return order.customer_name || 'Pedido online';
}

function DashboardLoading() {
  return <div className="overview-loading" role="status" aria-live="polite">Atualizando dados da operação…</div>;
}

export default function OverviewDashboard({ tables = [], tablesLoading = false, tablesError = '', refreshTables, setTab, firstName, greeting, restaurantId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());

  const refresh = useCallback(async (showSpinner = true) => {
    if (!supabase || !restaurantId) {
      setData(null);
      setError(supabase ? 'Não foi possível identificar o restaurante deste usuário.' : 'O Supabase não está configurado.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (showSpinner) setRefreshing(true);
    try {
      const today = dateAtLocalMidnight();
      const yesterday = dateAtLocalMidnight(1);
      const now = new Date();
      const [ordersSinceYesterday, recentResult, paymentsResult] = await Promise.all([
        fetchOrdersSince(restaurantId, yesterday),
        supabase.from('orders').select('id,order_number,order_type,customer_name,status,total,payment_state,created_at,table_id')
          .eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(6),
        supabase.from('payments').select('id,order_id,amount,paid_at')
          .eq('restaurant_id', restaurantId).eq('status', 'pago')
          .gte('paid_at', yesterday.toISOString()).lte('paid_at', now.toISOString()),
      ]);
      if (recentResult.error) throw recentResult.error;
      if (paymentsResult.error) throw paymentsResult.error;

      const todayOrders = ordersSinceYesterday.filter(order => new Date(order.created_at) >= today && order.status !== 'cancelado');
      const yesterdayOrders = ordersSinceYesterday.filter(order => {
        const createdAt = new Date(order.created_at);
        return createdAt >= yesterday && createdAt < today && order.status !== 'cancelado';
      });
      const paidToday = (paymentsResult.data || []).filter(payment => new Date(payment.paid_at) >= today);
      const paidYesterday = (paymentsResult.data || []).filter(payment => {
        const paidAt = new Date(payment.paid_at);
        return paidAt >= yesterday && paidAt < today;
      });
      const sumPayments = rows => rows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const revenueToday = sumPayments(paidToday);
      const revenueYesterday = sumPayments(paidYesterday);
      const paidOrdersToday = new Set(paidToday.map(payment => payment.order_id).filter(Boolean)).size;
      const paidOrdersYesterday = new Set(paidYesterday.map(payment => payment.order_id).filter(Boolean)).size;
      const readyItems = await fetchReadyItems(ordersSinceYesterday);
      const prepMinutes = orderRows => {
        const orderIdSet = new Set(orderRows.map(order => order.id));
        const durations = readyItems.filter(item => orderIdSet.has(item.order_id) && item.ready_at && item.created_at)
          .map(item => (new Date(item.ready_at) - new Date(item.created_at)) / 60000)
          .filter(duration => Number.isFinite(duration) && duration >= 0);
        return durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : null;
      };
      const prepToday = prepMinutes(todayOrders);
      const prepYesterday = prepMinutes(yesterdayOrders);

      const hourlySales = Array.from({ length: 24 }, () => 0);
      for (const payment of paidToday) {
        hourlySales[new Date(payment.paid_at).getHours()] += Number(payment.amount || 0);
      }
      const recentOrders = recentResult.data || [];
      const recentIds = recentOrders.map(order => order.id);
      let recentItems = [];
      if (recentIds.length) {
        const { data: itemRows, error: itemsError } = await supabase.from('order_items')
          .select('order_id,quantity,status')
          .in('order_id', recentIds)
          .neq('status', 'cancelado');
        if (itemsError) throw itemsError;
        recentItems = itemRows || [];
      }
      const itemCountByOrder = new Map();
      for (const item of recentItems) itemCountByOrder.set(item.order_id, (itemCountByOrder.get(item.order_id) || 0) + Number(item.quantity || 0));
      const itemStatusesByOrder = new Map();
      for (const item of recentItems) {
        const statuses = itemStatusesByOrder.get(item.order_id) || [];
        statuses.push(item.status);
        itemStatusesByOrder.set(item.order_id, statuses);
      }

      setData({
        sales: revenueToday,
        salesYesterday: revenueYesterday,
        orderCount: todayOrders.length,
        orderCountYesterday: yesterdayOrders.length,
        ticket: paidOrdersToday ? revenueToday / paidOrdersToday : 0,
        ticketYesterday: paidOrdersYesterday ? revenueYesterday / paidOrdersYesterday : 0,
        prepMinutes: prepToday,
        prepMinutesYesterday: prepYesterday,
        hourlySales,
        recentOrders: recentOrders.map(order => {
          const statuses = itemStatusesByOrder.get(order.id) || [];
          const liveStatus = statuses.includes('pendente') ? 'pendente'
            : statuses.includes('em_preparo') ? 'em_preparo'
              : statuses.includes('pronto') ? 'pronto'
                : statuses.length && statuses.every(status => status === 'entregue') ? 'entregue'
                  : order.status;
          return { ...order, status: liveStatus, itemCount: itemCountByOrder.get(order.id) || 0 };
        }),
      });
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível carregar os indicadores do Supabase.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    setLoading(true);
    refresh(false);
    if (!supabase || !restaurantId) return undefined;
    const reload = () => refresh(false);
    const channel = supabase.channel(`overview-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `restaurant_id=eq.${restaurantId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [restaurantId, refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const tableMap = useMemo(() => new Map(tables.map(table => [table.id, table])), [tables]);
  const maxHourlySales = Math.max(1, ...(data?.hourlySales || []));
  const occupiedCount = tables.filter(table => table.status === 'ocupada').length;
  const awaitingCount = tables.filter(table => table.status === 'aguardando_conta').length;
  const freeCount = tables.filter(table => table.status === 'livre').length;

  return <>
    <div className="page-heading overview-heading">
      <div><h1>{greeting}, {firstName?.trim().split(/\s+/)[0] || 'equipe'} 👋</h1><p>Acompanhe a operação do seu restaurante em tempo real.</p></div>
      <div className="overview-heading-actions">
        <button type="button" className="overview-refresh" onClick={() => { refresh(); refreshTables?.(); }} disabled={refreshing} aria-label="Atualizar visão geral">
          <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''}/>{refreshing ? 'Atualizando…' : 'Atualizar'}
        </button>
        <button className="primary" onClick={() => setTab('Salão e mesas')}>＋ Novo pedido</button>
      </div>
    </div>
    {error && <div className="overview-error" role="alert"><span>Falha ao buscar os dados: {error}</span><button type="button" onClick={() => refresh()}>Tentar novamente</button></div>}
    <div className="stats">
      <Stat label="Vendas de hoje" value={loading ? '—' : money(data?.sales)} delta={loading ? '…' : percentChange(data?.sales || 0, data?.salesYesterday || 0)} icon={CircleDollarSign} color="green"/>
      <Stat label="Pedidos hoje" value={loading ? '—' : data?.orderCount || 0} delta={loading ? '…' : percentChange(data?.orderCount || 0, data?.orderCountYesterday || 0)} icon={ClipboardList} color="purple"/>
      <Stat label="Ticket médio pago" value={loading ? '—' : money(data?.ticket)} delta={loading ? '…' : percentChange(data?.ticket || 0, data?.ticketYesterday || 0)} icon={Activity} color="orange"/>
      <Stat label="Preparo médio" value={loading ? '—' : data?.prepMinutes == null ? 'Sem dados' : `${Math.round(data.prepMinutes)} min`} delta={loading ? '…' : minutesChange(data?.prepMinutes, data?.prepMinutesYesterday)} icon={Clock3} color="blue" lowerIsBetter/>
    </div>
    <div className="grid-main">
      <section className="panel">
        <div className="panel-head"><div><h2>Pedidos recentes</h2><p>Pedidos mais novos do restaurante</p></div><button className="text-button" type="button" onClick={() => setTab('PDV')}>Abrir PDV →</button></div>
        <div className="table-wrap"><table><thead><tr><th>PEDIDO</th><th>CLIENTE / ORIGEM</th><th>ITENS</th><th>VALOR</th><th>STATUS</th></tr></thead><tbody>
          {(data?.recentOrders || []).map(order => {
            const [label, tone] = order.payment_state === 'pago' ? ['Pago', 'green'] : orderStates[order.status] || [order.status || '—', ''];
            return <tr key={order.id}><td><b>#{order.order_number}</b><small>{relativeTime(order.created_at, clock)}</small></td><td>{order.customer_name || orderOrigin(order, tableMap)}<small>{orderOrigin(order, tableMap)}</small></td><td>{order.itemCount} {order.itemCount === 1 ? 'item' : 'itens'}</td><td>{money(order.total)}</td><td><span className={`badge ${tone}`}>{label}</span></td></tr>;
          })}
          {!loading && !(data?.recentOrders || []).length && <tr><td colSpan="5" className="overview-empty">Ainda não há pedidos cadastrados.</td></tr>}
          {loading && <tr><td colSpan="5" className="overview-empty">Carregando pedidos…</td></tr>}
        </tbody></table></div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Mapa de mesas</h2><p>{tablesLoading ? 'Atualizando salão…' : `${occupiedCount} ocupadas · ${awaitingCount} aguardando conta · ${freeCount} livres · ${tables.length} mesas`}</p></div><button className="text-button" type="button" onClick={() => setTab('Salão e mesas')}>Ver mapa →</button></div>
        {tablesError && <div className="overview-inline-error">{tablesError}</div>}
        <div className="table-grid">
          {tables.slice(0, 12).map(table => <button type="button" key={table.id} className={`mini-table ${table.status === 'ocupada' ? 'occupied' : table.status === 'aguardando_conta' ? 'awaiting' : table.status === 'reservada' ? 'reserved' : ''}`} onClick={() => setTab('Salão e mesas')} aria-label={`Mesa ${table.number}, ${table.status}`}>
            <span>{table.number}</span><small>{['ocupada', 'aguardando_conta'].includes(table.status) ? money(table.current_total) : table.status === 'reservada' ? 'Reservada' : 'Livre'}</small>
          </button>)}
          {!tablesLoading && !tables.length && <div className="overview-empty">Nenhuma mesa cadastrada.</div>}
          {tablesLoading && <div className="overview-empty">Carregando mesas…</div>}
        </div>
        <div className="legend"><span><i className="free-dot"/> Livre</span><span><i/> Ocupada</span><span><i className="awaiting-dot"/> Aguardando conta</span></div>
      </section>
    </div>
    <section className="panel bottom-panel">
      <div className="panel-head"><div><h2>Vendas por hora</h2><p>Recebimentos confirmados hoje no Supabase</p></div><span className="select">Hoje</span></div>
      {loading ? <DashboardLoading/> : <><div className="bars overview-bars" aria-label="Vendas por hora">
        {(data?.hourlySales || Array(24).fill(0)).map((value, hour) => <div key={hour} title={`${String(hour).padStart(2, '0')}:00 · ${money(value)}`} className={`bar ${value > 0 ? 'highlight' : ''}`} style={{ height: `${value > 0 ? Math.max(5, value / maxHourlySales * 100) : 2}%` }}/>) }
      </div><div className="bar-labels overview-bar-labels">{[0, 3, 6, 9, 12, 15, 18, 21].map(hour => <span key={hour}>{String(hour).padStart(2, '0')}h</span>)}</div></>}
    </section>
  </>;
}

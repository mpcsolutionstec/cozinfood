import { useEffect, useState } from 'react';
import { Armchair, ArrowUpRight, Clock3, RefreshCw, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useWaiterStore } from '../stores/useWaiterStore';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const statusText = { livre: 'Livre', ocupada: 'Ocupada', aguardando_conta: 'Aguardando conta', reservada: 'Reservada' };
const elapsed = value => {
  if (!value) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
};

function DiningTableIcon({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6V4.8a3 3 0 0 1 6 0V6M8 7h8v1.3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V7Z"/>
    <ellipse cx="12" cy="12" rx="5.2" ry="2.2"/>
    <path d="M12 14.2V19m-3 2h6m-8-9H4.5v2.2a2 2 0 0 0 2 2H8m8-4h1.5v2.2a2 2 0 0 1-2 2H16M9 19v2m6-2v2"/>
  </svg>;
}

export default function TableGrid({ tables, loading, error, onRefresh, onSelect, onAction }) {
  const [orders, setOrders] = useState({});
  const [guestTable, setGuestTable] = useState(null);
  const [guestCount, setGuestCount] = useState('2');
  const setGuests = useWaiterStore(state => state.setGuestCount);
  const [filter, setFilter] = useState('todas');

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('orders').select('id,table_id,created_at,total,status,order_number')
        .not('status', 'in', '(entregue,cancelado)').not('table_id', 'is', null).order('created_at', { ascending: false });
      if (!active) return;
      const next = {};
      (data || []).forEach(order => { if (!next[order.table_id]) next[order.table_id] = order; });
      setOrders(next);
    };
    load();
    const channel = supabase.channel('waiter-table-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, load).subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const choose = table => {
    if (table.status === 'reservada') return;
    if (table.status === 'livre') { setGuestTable(table); setGuestCount('2'); return; }
    onSelect(table);
  };
  const startService = event => { event.preventDefault(); setGuests(guestCount); onSelect(guestTable); setGuestTable(null); };
  const displayed = tables.filter(table => filter === 'todas' || table.status === filter);

  return <section className="waiter-floor">
    <div className="waiter-section-heading"><div><h1>Salão</h1><p>Toque em uma mesa para abrir ou continuar o atendimento.</p></div><button className="waiter-refresh" onClick={onRefresh}><RefreshCw size={16}/> Atualizar</button></div>
    <div className="waiter-status-strip">{[['todas','Todas',tables.length],['livre','Livres',tables.filter(t => t.status === 'livre').length],['ocupada','Ocupadas',tables.filter(t => t.status === 'ocupada').length],['aguardando_conta','Conta',tables.filter(t => t.status === 'aguardando_conta').length]].map(([id,label,count]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}<b>{count}</b></button>)}</div>
    {error && <div className="waiter-error" role="alert"><div><b>Falha ao carregar mesas.</b><small style={{ display: 'block', marginTop: 4, overflowWrap: 'anywhere', fontSize: 11, lineHeight: 1.45 }}>{error}</small></div><button onClick={onRefresh}>Tentar novamente</button></div>}
    {loading ? <div className="waiter-loading">Carregando salão…</div> : displayed.length === 0 ? <div className="waiter-empty"><Armchair size={32}/><b>Nenhuma mesa nesta lista</b><span>Altere o filtro ou cadastre mesas no painel.</span></div> : <div className="waiter-table-grid">{displayed.map(table => {
      const order = orders[table.id];
      const status = table.status || 'livre';
      return <button key={table.id} className={`waiter-table-card ${status}`} onClick={() => choose(table)} disabled={status === 'reservada'}>
        <div className="waiter-table-card-top"><span className="waiter-table-icon"><DiningTableIcon/></span><span className={`waiter-state-pill ${status}`}>{statusText[status] || 'Livre'}</span></div>
        <div className="waiter-table-card-title"><small>MESA</small><strong>{table.number}</strong></div>
        <div className="waiter-table-seats"><Users size={14}/><span>{table.capacity || 4} lugares</span></div>
        {status !== 'livre' && status !== 'reservada' && <div className="waiter-table-summary"><div><small>CONTA PARCIAL</small><b>{money(table.current_total)}</b></div><span className="waiter-elapsed"><Clock3 size={13}/>{elapsed(order?.created_at) || 'Em andamento'}</span></div>}
        {status === 'aguardando_conta' && <small className="waiter-checkout-hint">Caixa solicitado</small>}
        {status === 'reservada' && <small>Indisponível para atendimento</small>}
        {status !== 'reservada' && <span className="waiter-open-hint">{status === 'livre' ? 'Iniciar atendimento' : 'Abrir comanda'}<ArrowUpRight size={15}/></span>}
      </button>;
    })}</div>}
    {guestTable && <div className="waiter-modal-layer" onMouseDown={event => { if (event.target === event.currentTarget) setGuestTable(null); }}><form className="waiter-modal" onSubmit={startService}>
      <button type="button" className="waiter-modal-close" onClick={() => setGuestTable(null)} aria-label="Fechar"><X size={18}/></button><span className="waiter-modal-icon"><Armchair size={23}/></span><h2>Mesa {guestTable.number}</h2><p>Quantas pessoas estão na mesa? Você pode deixar o padrão.</p><label><Users size={17}/> Clientes<input type="number" min="1" max="30" value={guestCount} onChange={event => setGuestCount(event.target.value)} inputMode="numeric"/></label><button className="waiter-primary">Começar atendimento</button>
    </form></div>}
  </section>;
}

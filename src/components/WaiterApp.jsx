import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, ChefHat, CircleDollarSign, LogOut, Plus, RefreshCw, Search, ShoppingBag, Wifi, WifiOff, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import { supabase } from '../lib/supabaseClient';
import { useTableStatus } from '../hooks/useTableStatus';
import { useWaiterStore } from '../stores/useWaiterStore';
import TableGrid from './TableGrid';
import OrderCart from './OrderCart';
import '../waiter.css';

export default function WaiterApp({ onLogout }) {
  const { profile } = useAuth();
  const { tables, loading, error, refresh } = useTableStatus();
  const selectedTable = useWaiterStore(state => state.selectedTable);
  const selectTable = useWaiterStore(state => state.selectTable);
  const [online, setOnline] = useState(navigator.onLine);
  const [notice, setNotice] = useState('');
  const pendingCount = Object.keys(useWaiterStore(state => state.pendingByTable)).length;

  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);

  const syncPending = useCallback(async () => {
    if (!online || !profile?.restaurant_id || !supabase) return;
    const { pendingByTable, clearPendingOrder } = useWaiterStore.getState();
    for (const [tableId, request] of Object.entries(pendingByTable)) {
      try {
        const { error: syncError } = await supabase.rpc('submit_waiter_order', {
          p_table_id: tableId, p_customer_name: request.customerName || '', p_guest_count: request.guestCount || 1,
          p_items: request.items, p_request_id: request.requestId,
        });
        if (syncError) throw syncError;
        clearPendingOrder(tableId);
        setNotice(`Pedido da Mesa ${tables.find(table => table.id === tableId)?.number || ''} sincronizado.`);
      } catch { /* Mantém na fila para nova tentativa. */ }
    }
    refresh();
  }, [online, profile?.restaurant_id, refresh, tables]);

  useEffect(() => { syncPending(); }, [syncPending]);

  const action = async (kind, table, targetId) => {
    if (!supabase) return setNotice('Conexão com o sistema indisponível.');
    try {
      const { error: actionError } = kind === 'transferir'
        ? await supabase.rpc('manage_table_bulk_action', { p_action: 'transferir', p_source_table: table.id, p_target_table: targetId })
        : await supabase.rpc('waiter_table_action', { p_table_id: table.id, p_action: kind });
      if (actionError) throw actionError;
      const target = tables.find(item => item.id === targetId);
      setNotice(kind === 'pedir_conta' ? `Mesa ${table.number}: caixa avisado para fechar a conta.` : kind === 'chamar_gerente' ? `Gerente chamado na Mesa ${table.number}.` : kind === 'dividir_conta' ? `Pedido de divisão da conta da Mesa ${table.number} enviado ao caixa.` : `Comanda transferida da Mesa ${table.number} para a Mesa ${target?.number || ''}.`);
      refresh();
    } catch (actionError) { setNotice(actionError.message || 'Não foi possível enviar a solicitação.'); }
  };

  return <main className="waiter-app">
    <header className="waiter-topbar">
      <div className="waiter-brand"><span><ChefHat size={20}/></span><div><b>COZINFOOD</b><small>Atendimento do garçom</small></div></div>
      <div className="waiter-top-actions"><span className={`waiter-connection ${online ? 'online' : 'offline'}`}>{online ? <Wifi size={15}/> : <WifiOff size={15}/>}<span>{online ? 'Conectado' : 'Offline'}</span></span>{pendingCount > 0 && <span className="waiter-pending">{pendingCount} na fila</span>}<button onClick={refresh} aria-label="Atualizar mesas"><RefreshCw size={17}/></button><button onClick={onLogout} aria-label="Sair"><LogOut size={17}/></button></div>
    </header>
    {notice && <div className="waiter-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar"><X size={16}/></button></div>}
    {selectedTable
      ? <OrderCart table={tables.find(table => table.id === selectedTable.id) || selectedTable} tables={tables} profile={profile} onBack={() => selectTable(null)} onNotice={setNotice} onTableChanged={refresh} onAction={(kind, targetId) => action(kind, tables.find(table => table.id === selectedTable.id) || selectedTable, targetId)}/>
      : <TableGrid tables={tables} loading={loading} error={error} onRefresh={refresh} onSelect={table => selectTable(table)} onAction={action}/>}
  </main>;
}

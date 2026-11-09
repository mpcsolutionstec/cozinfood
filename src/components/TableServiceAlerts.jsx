import { useCallback, useEffect, useState } from 'react';
import { BellRing, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import './table-service-alerts.css';

export default function TableServiceAlerts({ role }) {
  const [calls, setCalls] = useState([]);
  const load = useCallback(async () => {
    if (!supabase || role !== 'admin') return;
    const { data } = await supabase.rpc('list_table_service_calls');
    if (Array.isArray(data)) setCalls(data);
  }, [role]);

  useEffect(() => {
    if (role !== 'admin' || !supabase) return undefined;
    load();
    const channel = supabase.channel('admin-table-service-calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_service_calls' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [role, load]);

  const resolve = async id => {
    const { error } = await supabase.rpc('resolve_table_service_call', { p_call_id: id });
    if (!error) setCalls(current => current.filter(call => call.id !== id));
  };

  if (!calls.length) return null;
  return <aside className="table-service-alerts" aria-label="Chamados do salão">{calls.map(call => <div className="table-service-alert" role="status" key={call.id}>
    <span className="table-service-alert-icon"><BellRing size={17}/></span><div><b>{call.kind === 'dividir_conta' ? 'Divisão de conta solicitada' : 'Gerente chamado'}</b><small>Mesa {call.table_number} · {new Date(call.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div><button onClick={() => resolve(call.id)} aria-label="Marcar chamado como atendido"><Check size={17}/></button><button onClick={() => setCalls(current => current.filter(item => item.id !== call.id))} aria-label="Dispensar"><X size={16}/></button>
  </div>)}</aside>;
}

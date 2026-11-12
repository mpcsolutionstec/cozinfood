import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import './table-service-alerts.css';

function playCallTone(context) {
  const startAt = context.currentTime + 0.02;
  [880, 660, 880].forEach((frequency, index) => {
    const start = startAt + index * 0.24;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(0.18, start + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  });
}

export default function TableServiceAlerts({ role }) {
  const [calls, setCalls] = useState([]);
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [inboxOpen, setInboxOpen] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const soundContext = useRef(null);
  const seenCallIds = useRef(new Set());
  const loadedOnce = useRef(false);
  const pendingTone = useRef(false);

  const getSoundContext = useCallback(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!soundContext.current) soundContext.current = new AudioContextClass();
    return soundContext.current;
  }, []);

  const alertForNewCall = useCallback(async () => {
    const context = getSoundContext();
    if (!context) { setSoundBlocked(true); pendingTone.current = true; return; }
    try {
      if (context.state !== 'running') await context.resume();
      if (context.state === 'running') {
        playCallTone(context);
        pendingTone.current = false;
        setSoundBlocked(false);
      } else {
        pendingTone.current = true;
        setSoundBlocked(true);
      }
    } catch {
      pendingTone.current = true;
      setSoundBlocked(true);
    }
  }, [getSoundContext]);

  const enableSound = async () => {
    try {
      const context = getSoundContext();
      if (!context) throw new Error('Áudio indisponível');
      await context.resume();
      if (context.state !== 'running') throw new Error('Áudio bloqueado');
      playCallTone(context);
      pendingTone.current = false;
      setSoundBlocked(false);
    } catch {
      setSoundBlocked(true);
    }
  };

  const load = useCallback(async () => {
    if (!supabase || role !== 'admin') return;
    const { data } = await supabase.rpc('list_table_service_calls');
    if (Array.isArray(data)) {
      const incoming = data.filter(call => !seenCallIds.current.has(call.id));
      if (loadedOnce.current && incoming.length) alertForNewCall();
      data.forEach(call => seenCallIds.current.add(call.id));
      loadedOnce.current = true;
      setCalls(data);
    }
  }, [alertForNewCall, role]);

  useEffect(() => {
    if (role !== 'admin' || !supabase) return undefined;
    const toggleInbox = () => setInboxOpen(open => !open);
    const closeOnEscape = event => { if (event.key === 'Escape') setInboxOpen(false); };
    window.addEventListener('cozinfood:toggle-service-inbox', toggleInbox);
    window.addEventListener('keydown', closeOnEscape);
    load();
    const channel = supabase.channel('admin-table-service-calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_service_calls' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('cozinfood:toggle-service-inbox', toggleInbox);
      window.removeEventListener('keydown', closeOnEscape);
      soundContext.current?.close();
      soundContext.current = null;
    };
  }, [role, load]);

  const resolve = async id => {
    const { error } = await supabase.rpc('resolve_table_service_call', { p_call_id: id });
    if (!error) setCalls(current => current.filter(call => call.id !== id));
  };

  const visibleCalls = calls.filter(call => !dismissedIds.has(call.id));
  return <>
    <aside className="table-service-alerts" aria-label="Chamados novos do salão" aria-live="assertive">
      {soundBlocked && <div className="table-service-sound-unlock"><BellRing size={16}/><span>Ative o som para ouvir os próximos chamados.</span><button onClick={enableSound}>Ativar som</button></div>}
      {visibleCalls.map(call => <div className="table-service-alert" role="status" key={call.id}>
        <span className="table-service-alert-icon"><BellRing size={17}/></span><div><b>{call.kind === 'dividir_conta' ? 'Divisão de conta solicitada' : 'Gerente chamado'}</b><small>Mesa {call.table_number} · {new Date(call.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div><button onClick={() => resolve(call.id)} aria-label="Marcar chamado como atendido"><Check size={17}/></button><button onClick={() => setDismissedIds(current => new Set([...current, call.id]))} aria-label="Dispensar aviso"><X size={16}/></button>
      </div>)}
    </aside>
    {inboxOpen && <div className="table-service-inbox-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setInboxOpen(false); }}>
      <section className="table-service-inbox" role="dialog" aria-modal="true" aria-labelledby="table-service-inbox-title">
        <header><div><span className="table-service-alert-icon"><BellRing size={17}/></span><div><h2 id="table-service-inbox-title">Chamados da equipe</h2><small>{calls.length ? `${calls.length} chamado(s) aguardando atendimento` : 'Nenhum chamado pendente'}</small></div></div><button type="button" onClick={() => setInboxOpen(false)} aria-label="Fechar chamados"><X size={18}/></button></header>
        <div className="table-service-inbox-list">{calls.length ? calls.map(call => <article className="table-service-inbox-item" key={call.id}><span className="table-service-alert-icon"><BellRing size={16}/></span><div><b>{call.kind === 'dividir_conta' ? 'Divisão de conta solicitada' : 'Gerente chamado'}</b><small>Mesa {call.table_number} · {new Date(call.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></div><button type="button" onClick={() => resolve(call.id)} aria-label="Marcar chamado como atendido" title="Marcar como atendido"><Check size={17}/></button></article>) : <p className="table-service-inbox-empty">Os chamados dispensados ou atendidos não aparecem nesta lista.</p>}</div>
      </section>
    </div>}
  </>;
}

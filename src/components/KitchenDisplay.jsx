import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, ChefHat, CircleCheck, Clock3, Flame, Layers, Pizza, RefreshCw, Truck, Utensils, Volume2, VolumeX, Wine } from 'lucide-react';
import { useKDSOrders } from '../hooks/useKDSOrders';

const sectors = [
  { key: 'all', label: 'Todos os setores', icon: Utensils },
  { key: 'cozinha', label: 'Cozinha', icon: ChefHat },
  { key: 'bar', label: 'Bar', icon: Wine },
  { key: 'forno_pizza', label: 'Forno de pizza', icon: Pizza },
];
const orderTypeLabel = { salao: 'Salão', qr: 'QR da mesa', delivery: 'Delivery', balcao: 'Balcão' };
const nextStatus = { pendente: 'em_preparo', em_preparo: 'pronto', pronto: 'entregue' };
const nextLabel = { pendente: 'Iniciar preparo', em_preparo: 'Marcar pronto', pronto: 'Entregar pedido' };
const statusLabel = { pendente: 'Na fila', em_preparo: 'Em preparo', pronto: 'Pronto para sair' };
const displayParts = value => Array.isArray(value) ? value.map(part => typeof part === 'string' ? part : part?.name || part?.label).filter(Boolean) : [];
const normalizedParts = value => JSON.stringify((Array.isArray(value) ? value : []).map(part => typeof part === 'string'
  ? part.trim().toLocaleLowerCase('pt-BR')
  : JSON.stringify(part)).sort());
const formatQuantity = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const formatTime = ms => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
function playAlertTone(context, test = false) {
  if (!context || context.state !== 'running') return;
  const sequence = test ? [{ frequency: 740, offset: 0, duration: 0.18 }] : [
    { frequency: 880, offset: 0, duration: 0.15 },
    { frequency: 660, offset: 0.21, duration: 0.15 },
    { frequency: 880, offset: 0.42, duration: 0.2 },
  ];
  const startAt = context.currentTime;
  sequence.forEach(({ frequency, offset, duration }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const toneStart = startAt + offset;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, toneStart);
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(0.3, toneStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + duration + 0.02);
  });
}

export default function KitchenDisplay() {
  const [sector, setSector] = useState('all');
  const { orders, changeStatus, refresh, loading, error, live } = useKDSOrders(sector, 'monitor');
  const [now, setNow] = useState(Date.now());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [busyIds, setBusyIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const audioContext = useRef(null);
  const alertedItems = useRef(new Set());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map();
    orders.forEach(item => {
      // Consolida itens de pedidos diferentes quando a produção é a mesma.
      // Observações e origem são mantidas no cartão, mas não impedem o agrupamento.
      const key = JSON.stringify([
        item.product_id || item.name?.trim().toLocaleLowerCase('pt-BR'),
        item.name?.trim().toLocaleLowerCase('pt-BR'),
        item.destination_sector,
        item.status,
        item.fraction_label?.trim().toLocaleLowerCase('pt-BR') || '',
        item.border_id || '',
        normalizedParts(item.flavors),
        normalizedParts(item.additions),
      ]);
      const group = grouped.get(key);
      const itemQuantity = Number(item.quantity || 0);
      const origin = item.table_number
        ? `Mesa ${item.table_number}`
        : item.order_type === 'delivery' && item.customer_name
          ? `Delivery · ${item.customer_name}`
          : orderTypeLabel[item.order_type] || 'Pedido';
      const note = item.notes?.trim();
      if (group) {
        group.ids.push(item.id);
        group.quantity += itemQuantity;
        group.lineCount += 1;
        group.created_at = new Date(item.created_at) < new Date(group.created_at) ? item.created_at : group.created_at;
        if (item.started_at && (!group.started_at || new Date(item.started_at) < new Date(group.started_at))) group.started_at = item.started_at;
        if (item.order_number) group.order_numbers.add(item.order_number);
        if (item.table_number) group.table_numbers.add(item.table_number);
        if (item.customer_name) group.customers.add(item.customer_name);
        group.origins.add(origin);
        if (note) group.noteGroups.set(note, (group.noteGroups.get(note) || 0) + itemQuantity);
        group.prep_minutes = Math.min(group.prep_minutes, Number(item.prep_minutes || 15));
      } else {
        grouped.set(key, {
          ...item,
          key,
          ids: [item.id],
          quantity: itemQuantity,
          lineCount: 1,
          order_numbers: new Set(item.order_number ? [item.order_number] : []),
          table_numbers: new Set(item.table_number ? [item.table_number] : []),
          customers: new Set(item.customer_name ? [item.customer_name] : []),
          origins: new Set([origin]),
          noteGroups: new Map(note ? [[note, itemQuantity]] : []),
          prep_minutes: Number(item.prep_minutes || 15),
        });
      }
    });
    return [...grouped.values()]
      .map(group => ({ ...group, notes: [...group.noteGroups].map(([text, quantity]) => ({ text, quantity })) }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [orders]);

  const lateItemIds = useMemo(() => orders
    .filter(item => item.status !== 'pronto')
    .filter(item => {
      const started = new Date(item.started_at || item.created_at).getTime();
      return now - started >= Math.max(1, Number(item.prep_minutes || 15)) * 60000;
    })
    .map(item => item.id), [orders, now]);

  useEffect(() => {
    const current = new Set(lateItemIds);
    const newlyLate = [...current].some(id => !alertedItems.current.has(id));
    if (soundEnabled && newlyLate) {
      const context = audioContext.current;
      if (context?.state === 'running') playAlertTone(context);
      else if (context) context.resume().then(() => {
        if (context.state === 'running') playAlertTone(context);
        else setActionError('O áudio continua bloqueado. Clique em “Testar som” e confira o volume do dispositivo.');
      }).catch(() => setActionError('O navegador bloqueou o áudio. Clique em “Testar som” e confira o volume do dispositivo.'));
    }
    alertedItems.current = current;
  }, [lateItemIds, soundEnabled]);

  const enableSound = async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setActionError('Este navegador não oferece suporte ao alerta sonoro.');
      return;
    }
    try {
      if (!audioContext.current || audioContext.current.state === 'closed') audioContext.current = new AudioContextClass();
      await audioContext.current.resume();
      if (audioContext.current.state !== 'running') throw new Error('AudioContext suspended');
      playAlertTone(audioContext.current, true);
      alertedItems.current = new Set();
      setSoundEnabled(true);
      setActionError('');
    } catch {
      setSoundEnabled(false);
      setActionError('Não foi possível iniciar o áudio. Verifique as permissões e o volume do navegador.');
    }
  };

  const testSound = async () => {
    try {
      const context = audioContext.current;
      if (!context) return enableSound();
      await context.resume();
      if (context.state !== 'running') throw new Error('AudioContext suspended');
      playAlertTone(context, true);
      setActionError('');
    } catch {
      setActionError('Não foi possível reproduzir o teste. Verifique o volume e as permissões de áudio do navegador.');
    }
  };

  const advance = async group => {
    setBusyIds(group.ids);
    setActionError('');
    setActionNotice('');
    try {
      await changeStatus(group.ids, nextStatus[group.status]);
      if (group.status === 'em_preparo') setActionNotice('Pedido marcado como pronto. O estoque das fichas técnicas foi atualizado.');
    } catch (updateError) {
      setActionError(`Não foi possível atualizar o pedido: ${updateError.message}`);
    } finally {
      setBusyIds([]);
    }
  };

  const formatOrigin = group => {
    const origins = [...group.origins];
    const ordersText = [...group.order_numbers].map(number => `#${number}`).join(', ');
    return `${origins.join(', ')} · ${ordersText || 'Pedido'}`;
  };

  const activeQuantity = groups.filter(group => group.status !== 'pronto').reduce((total, group) => total + group.quantity, 0);

  return <>
    <div className="page-heading kds-heading">
      <div><h1>Cozinha / KDS</h1><p>Fila de produção por setor, sincronizada com os pedidos do salão e delivery.</p></div>
      <div className={`kds-live-state ${live ? 'connected' : 'disconnected'}`}><i/>{live ? 'Conectado ao vivo' : 'Reconectando'}</div>
    </div>

    <div className="kds-toolbar">
      <div className="kds-sector-filters">{sectors.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setSector(key)} className={`kds-sector-button ${sector === key ? 'active' : ''}`}>
        <Icon size={15}/><span>{label}</span>{key === 'all' && <b>{groups.length}</b>}
      </button>)}</div>
      <div className="kds-toolbar-actions"><span className="kds-queue-count"><b>{formatQuantity(activeQuantity)}</b> itens na fila</span>
        <button className={`kds-tool-button ${soundEnabled ? 'sound-on' : ''}`} onClick={soundEnabled ? () => setSoundEnabled(false) : enableSound} title={soundEnabled ? 'Desativar alertas sonoros' : 'Ativar alertas sonoros'}>{soundEnabled ? <Volume2 size={16}/> : <VolumeX size={16}/>}<span>{soundEnabled ? 'Som ligado' : 'Ativar som'}</span></button>
        {soundEnabled && <button className="kds-tool-button sound-on" onClick={testSound} title="Reproduzir som de teste"><BellRing size={16}/><span>Testar som</span></button>}
        <button className="kds-tool-button refresh-kds" onClick={refresh} disabled={loading}><RefreshCw size={15} className={loading ? 'is-spinning' : ''}/><span>Atualizar</span></button>
      </div>
    </div>

    {!live && <div className="kds-connection-warning"><BellRing size={15}/> Tentando reconectar ao Supabase Realtime. Os pedidos continuam sendo atualizados manualmente.</div>}
    {error && <div className="kds-error" role="alert">Falha ao carregar os pedidos: {error}<button onClick={refresh}>Tentar novamente</button></div>}
    {actionError && <div className="kds-error" role="alert">{actionError}<button onClick={() => setActionError('')}>Fechar</button></div>}
    {actionNotice && <div className="kds-stock-notice" role="status"><CircleCheck size={15}/>{actionNotice}<button onClick={() => setActionNotice('')}>Fechar</button></div>}
    <div className="kds-board-meta"><span><i className="kds-dot pending-dot"/> Na fila <b>{groups.filter(item => item.status === 'pendente').length}</b></span><span><i className="kds-dot preparing-dot"/> Em preparo <b>{groups.filter(item => item.status === 'em_preparo').length}</b></span><span><i className="kds-dot ready-dot"/> Prontos <b>{groups.filter(item => item.status === 'pronto').length}</b></span><span className="kds-current-time"><Clock3 size={13}/>{new Date(now).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>

    {loading && groups.length === 0 ? <div className="kds-empty"><span className="auth-spinner"/>Carregando pedidos da cozinha...</div> : error && groups.length === 0 ? null : groups.length === 0 ? <div className="kds-empty-state"><span><ChefHat size={28}/></span><h2>Fila vazia</h2><p>Os novos pedidos deste setor aparecerão aqui assim que forem enviados.</p></div> : <div className="kds-ticket-grid">
      {groups.map(group => {
        const elapsed = now - new Date(group.started_at || group.created_at).getTime();
        const elapsedMinutes = elapsed / 60000;
        const prepTarget = Math.max(1, Number(group.prep_minutes || 15));
        const urgency = group.status === 'pronto' ? 'ready' : elapsedMinutes >= prepTarget ? 'late' : elapsedMinutes >= prepTarget * 0.8 ? 'warning' : 'on-time';
        const flavors = displayParts(group.flavors);
        const additions = displayParts(group.additions);
        const busy = group.ids.some(id => busyIds.includes(id));
        return <article className={`kds-ticket ${urgency} ${group.status}`} key={group.key}>
          <header className="kds-ticket-header"><div><span className="kds-ticket-order">{formatOrigin(group)}</span><span className={`kds-ticket-status ${group.status}`}>{statusLabel[group.status]}</span></div><div className={`kds-ticket-timer ${urgency}`}><Clock3 size={15}/><strong>{group.status === 'pronto' ? 'PRONTO' : formatTime(elapsed)}</strong></div></header>
          <div className="kds-ticket-main"><div className="kds-item-quantity">{formatQuantity(group.quantity)}<small>x</small></div><div className="kds-item-copy"><h2>{group.name}</h2>{group.fraction_label && <span className="kds-item-fraction">{group.fraction_label}</span>}
            {flavors.length > 0 && <p><b>Sabores:</b> {flavors.join(', ')}</p>}{additions.length > 0 && <p><b>Adicionais:</b> {additions.join(', ')}</p>}
            {(group.quantity > 1 || group.lineCount > 1) && <div className="kds-aggregate-badge"><Layers size={13}/><span>Total acumulado</span><b>{formatQuantity(group.quantity)} {group.quantity === 1 ? 'unidade' : 'unidades'}</b>{group.order_numbers.size > 1 && <small>em {group.order_numbers.size} pedidos</small>}</div>}
            {group.notes.map(note => <p className="kds-item-notes" key={note.text}>{note.quantity > 1 ? `${formatQuantity(note.quantity)}× ` : ''}{note.text}</p>)}
          </div></div>
          <footer className="kds-ticket-footer"><span className="kds-due-time">Prazo: {prepTarget} min</span><button className={`kds-action-button ${group.status}`} disabled={busy} onClick={() => advance(group)}>
            {busy ? 'Salvando...' : group.status === 'pronto' ? <><Truck size={15}/>{nextLabel[group.status]}</> : group.status === 'em_preparo' ? <><CircleCheck size={15}/>{nextLabel[group.status]}</> : <><Flame size={15}/>{nextLabel[group.status]}</>}
          </button></footer>
        </article>;
      })}
    </div>}
  </>;
}

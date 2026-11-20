import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, BadgeCheck, Banknote, Clock3, LockKeyhole, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useCashRegisterStore } from '../stores/useCashRegisterStore';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const methods = [['dinheiro','Dinheiro'],['pix','Pix'],['credito','Crédito'],['debito','Débito'],['voucher','Voucher']];
const methodLabels = Object.fromEntries(methods);
const emptyCount = () => Object.fromEntries(methods.map(([key]) => [key, '']));

export default function CashRegisterManager({ profile }) {
  const register = useCashRegisterStore(state => state.register);
  const movements = useCashRegisterStore(state => state.movements);
  const loading = useCashRegisterStore(state => state.loading);
  const storeError = useCashRegisterStore(state => state.error);
  const loadRegister = useCashRegisterStore(state => state.loadRegister);
  const loadMovements = useCashRegisterStore(state => state.loadMovements);
  const openRegister = useCashRegisterStore(state => state.openRegister);
  const recordMovement = useCashRegisterStore(state => state.recordMovement);
  const closeRegister = useCashRegisterStore(state => state.closeRegister);
  const [categories, setCategories] = useState([]);
  const [managerConfig, setManagerConfig] = useState({ configured: false, discrepancy_tolerance: 1 });
  const [openingAmount, setOpeningAmount] = useState('0');
  const [movement, setMovement] = useState({ type: 'sangria', amount: '', description: '', categoryId: '', managerPassword: '' });
  const [counts, setCounts] = useState(emptyCount);
  const [justification, setJustification] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [tolerance, setTolerance] = useState('1.00');
  const [audit, setAudit] = useState(null);
  const [history, setHistory] = useState([]);
  const [operatorName, setOperatorName] = useState('');
  const [openRegisters, setOpenRegisters] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isAdmin = profile?.role === 'admin';
  const can = permission => isAdmin || (profile?.permissions || []).includes(permission);
  const canOpen = can('finance.cash.open');
  const canClose = can('finance.cash.close');
  const canWithdraw = can('finance.cash.withdrawal');
  const canReinforce = can('finance.cash.reinforcement');
  const movementOptions = [['sangria','Sangria',canWithdraw],['reforco','Reforco',canReinforce]].filter(([, ,allowed]) => allowed);
  useEffect(() => { if (movementOptions.length && !movementOptions.some(([value]) => value === movement.type)) setMovement(current => ({ ...current, type: movementOptions[0][0] })); }, [movementOptions.map(([value]) => value).join(','), movement.type]);
  const countedTotal = useMemo(() => Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0), [counts]);

  const refresh = useCallback(async () => {
    if (!profile?.restaurant_id) return;
    setError('');
    try {
      const current = await loadRegister(profile.restaurant_id);
      if (current?.operator_id) {
        const { data: operator } = await supabase.from('profiles').select('full_name').eq('id', current.operator_id).maybeSingle();
        setOperatorName(operator?.full_name || 'Operador');
      } else setOperatorName('');
      if (isAdmin) {
        const { data: openRows, error: rowsError } = await supabase.from('cash_registers').select('id,operator_id,opened_at').eq('restaurant_id', profile.restaurant_id).eq('status', 'aberto').order('opened_at');
        if (rowsError) throw rowsError;
        const operatorIds = [...new Set((openRows || []).map(row => row.operator_id).filter(Boolean))];
        const { data: operators } = operatorIds.length ? await supabase.from('profiles').select('id,full_name').in('id', operatorIds) : { data: [] };
        const names = Object.fromEntries((operators || []).map(person => [person.id, person.full_name]));
        setOpenRegisters((openRows || []).map(row => ({ ...row, operator_name: names[row.operator_id] || 'Operador' })));
      }
      await Promise.all([
        loadMovements(current?.id, isAdmin),
        isAdmin ? supabase.rpc('list_cash_register_audits', { p_limit: 12 }).then(({ data, error: auditsError }) => {
          if (auditsError) throw auditsError;
          setHistory(Array.isArray(data) ? data : []);
        }) : Promise.resolve(setHistory([])),
        supabase.rpc('get_finance_manager_status').then(({ data, error: configError }) => {
          if (configError) throw configError;
          const next = data || { configured: false, discrepancy_tolerance: 1 };
          setManagerConfig(next); setTolerance(Number(next.discrepancy_tolerance || 0).toFixed(2));
        }),
        supabase.from('financial_categories').select('id,name').eq('restaurant_id', profile.restaurant_id)
          .eq('type', 'despesa').eq('active', true).order('name').then(({ data, error: categoryError }) => {
            if (categoryError) throw categoryError;
            setCategories(data || []);
          }),
      ]);
    } catch (loadError) { setError(loadError.message || 'Não foi possível carregar o caixa.'); }
  }, [isAdmin, loadMovements, loadRegister, profile?.restaurant_id]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!supabase || !profile?.restaurant_id) return undefined;
    const channel = supabase.channel(`finance-cash-${profile.restaurant_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_movements', filter: `restaurant_id=eq.${profile.restaurant_id}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.restaurant_id, refresh]);
  useEffect(() => {
    if (!profile?.restaurant_id) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [profile?.restaurant_id, refresh]);

  const submitOpen = async event => {
    event.preventDefault(); if (!canOpen) { setError('Seu usuario nao pode abrir o caixa.'); return; } setBusy(true); setError('');
    try { await openRegister(openingAmount); setNotice('Turno de caixa aberto.'); }
    catch (openError) { setError(openError.message || 'Não foi possível abrir o caixa.'); }
    finally { setBusy(false); }
  };
  const submitMovement = async event => {
    event.preventDefault(); if ((movement.type === 'sangria' && !canWithdraw) || (movement.type === 'reforco' && !canReinforce)) { setError('Seu usuario nao pode registrar esta movimentacao.'); return; } setBusy(true); setError(''); setNotice('');
    try {
      const targetRegisterId = isAdmin ? movement.registerId || register?.id : register?.id;
      if (!targetRegisterId) throw new Error('Selecione o caixa do operador para registrar a movimentação.');
      await recordMovement({ ...movement, registerId: targetRegisterId, isAdmin });
      setMovement(current => ({ ...current, amount: '', description: '', managerPassword: '' }));
      await refresh(); setNotice(movement.type === 'sangria' ? 'Sangria autorizada e registrada.' : 'Reforço registrado.');
    } catch (movementError) { setError(movementError.message || 'Não foi possível registrar a movimentaÃ§Ã£o.'); }
    finally { setBusy(false); }
  };
  const submitClose = async event => {
    event.preventDefault(); if (!canClose) { setError('Seu usuario nao pode fechar o caixa.'); return; } setBusy(true); setError(''); setNotice('');
    try {
      const result = await closeRegister({ registerId: register.id, countedBreakdown: counts, justification });
      setAudit(result); setCounts(emptyCount()); setJustification(''); setNotice('Turno fechado e auditado.');
    } catch (closeError) { setError(closeError.message || 'Não foi possível fechar o caixa.'); }
    finally { setBusy(false); }
  };
  const submitManagerPassword = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: passwordError } = await supabase.rpc('set_finance_manager_password', {
        p_password: managerPassword, p_tolerance: Number(tolerance || 0),
      });
      if (passwordError) throw passwordError;
      setManagerConfig(data || { configured: true, discrepancy_tolerance: Number(tolerance) });
      setManagerPassword(''); setNotice('Senha de gerente e tolerância salvas.');
    } catch (passwordError) { setError(passwordError.message || 'Não foi possível salvar a configuração.'); }
    finally { setBusy(false); }
  };

  return <section className="finance-page finance-cash-page">
    <div className="finance-page-heading"><div><span className="finance-eyebrow">TURNO E CONFERÃŠNCIA</span><h2>Controle de caixa</h2><p>Abra o turno, registre movimentações e feche com contagem cega por forma de pagamento.</p></div><button className="finance-quiet-button" onClick={refresh} disabled={loading}><RefreshCw size={16}/> Atualizar</button></div>
    {(error || storeError) && <div className="finance-alert error" role="alert">{error || storeError}</div>}
    {notice && <div className="finance-alert success" role="status"><BadgeCheck size={16}/>{notice}</div>}
    {!register && canOpen ? <form className="finance-open-card" onSubmit={submitOpen}>
      <span className="finance-icon-tile"><Wallet size={23}/></span><div className="finance-card-copy"><h3>Abrir turno de caixa</h3><p>Informe o fundo inicial disponível para troco. O saldo esperado não será mostrado durante o turno.</p></div>
      <label>Fundo de troco inicial<input type="number" min="0" step="0.01" value={openingAmount} onChange={event => setOpeningAmount(event.target.value)} required/></label>
      <button className="finance-primary-button" disabled={busy}>{busy ? 'Abrindoâ€¦' : 'Abrir caixa'}</button>
    </form> : !register ? <div className="finance-empty-inline">Nao ha caixa aberto. Solicite a um administrador ou operador autorizado que inicie o turno.</div> : <>
      <div className="finance-register-banner"><div className="finance-icon-tile active"><Wallet size={22}/></div><div><span className="finance-live-label"><i/> TURNO ABERTO</span><h3>Caixa em operação</h3><p>Aberto às {new Date(register.opened_at).toLocaleString('pt-BR')} · Fundo inicial {money(register.opening_amount)} · Operador: {operatorName || 'Carregando...'}</p></div></div>
      <div className="finance-cash-actions">
        {movementOptions.length > 0 && <form className="finance-panel" onSubmit={submitMovement}>
          <div className="finance-panel-title"><span className="finance-icon-tile"><ArrowDownToLine size={18}/></span><div><h3>Registrar retirada ou reforÃ§o</h3><p>Sangrias exigem autorizaÃ§Ã£o de gerente.</p></div></div>
          {isAdmin && <label>Caixa do operador<select value={movement.registerId || register?.id || ''} onChange={event => setMovement(current => ({ ...current, registerId: event.target.value }))} required><option value="">Selecione o turno</option>{openRegisters.map(row => <option key={row.id} value={row.id}>{row.operator_name} · aberto às {new Date(row.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</option>)}</select></label>}
          <div className="finance-inline-fields"><label>Movimentação<select value={movement.type} onChange={event => setMovement(current => ({ ...current, type: event.target.value, categoryId: '' }))}>{movementOptions.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Valor (R$)<input type="number" min="0.01" step="0.01" value={movement.amount} onChange={event => setMovement(current => ({ ...current, amount: event.target.value }))} required/></label></div>
          <label>Descrição<input value={movement.description} onChange={event => setMovement(current => ({ ...current, description: event.target.value }))} minLength={3} maxLength={240} placeholder="Ex.: retirada para o cofre" required/></label>
          {movement.type === 'sangria' && <><label>Categoria (opcional; classifica como despesa)<select value={movement.categoryId} onChange={event => setMovement(current => ({ ...current, categoryId: event.target.value }))}><option value="">Transferência/retirada, não despesa</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Senha de gerente<input type="password" value={movement.managerPassword} onChange={event => setMovement(current => ({ ...current, managerPassword: event.target.value }))} autoComplete="off" required/></label></>}
          <button className="finance-secondary-button" disabled={busy}>{movement.type === 'sangria' ? <ArrowUpFromLine size={16}/> : <ArrowDownToLine size={16}/>} Registrar {movement.type}</button>
        </form>}
        {canClose && <form className="finance-panel finance-blind-close" onSubmit={submitClose}>
          <div className="finance-panel-title"><span className="finance-icon-tile secure"><LockKeyhole size={18}/></span><div><h3>Fechamento cego</h3><p>Informe o que contou sem consultar o saldo calculado.</p></div></div>
          <div className="finance-count-grid">{methods.map(([key,label])=><label key={key}>{label}<input type="number" min="0" step="0.01" value={counts[key]} onChange={event => setCounts(current => ({ ...current, [key]: event.target.value }))} required/></label>)}</div>
          <div className="finance-count-total"><span>Total contado</span><b>{money(countedTotal)}</b></div>
          <label>Justificativa para diferença acima da tolerância<textarea value={justification} onChange={event => setJustification(event.target.value)} maxLength={500} placeholder={`Obrigatória se a diferença exceder ${money(managerConfig.discrepancy_tolerance)}.`}/></label>
          <button className="finance-danger-button" disabled={busy}>{busy ? 'Conferindo...' : 'Conferir e fechar turno'}</button>
        </form>}
      </div>
      {isAdmin && <div className="finance-panel finance-movements-panel"><div className="finance-panel-title"><span className="finance-icon-tile"><Clock3 size={18}/></span><div><h3>Movimentações do turno</h3><p>Vendas, sangrias e reforços registrados neste caixa.</p></div></div>{movements.length ? <div className="finance-movement-list">{movements.map(item=><div className="finance-movement-row" key={item.id}><span className={`finance-movement-mark ${item.type}`}>{item.type==='venda'?'V':item.type==='reforco'?'+':item.type==='estorno'?'E':'−'}</span><div><b>{item.description}</b><small>{item.type} · {methodLabels[item.payment_method] || item.payment_method} · {new Date(item.created_at).toLocaleString('pt-BR')} · Operador: {item.profiles?.full_name || 'Não identificado'}</small></div><strong className={['sangria','estorno'].includes(item.type)?'negative':''}>{['sangria','estorno'].includes(item.type)?'−':'+'}{money(item.amount)}</strong></div>)}</div> : <p className="finance-empty-inline">Nenhuma movimentação registrada para este turno.</p>}</div>}
      {isAdmin && <form className="finance-panel finance-security-panel" onSubmit={submitManagerPassword}><div className="finance-panel-title"><span className="finance-icon-tile secure"><ShieldCheck size={18}/></span><div><h3>Autorização e tolerância</h3><p>{managerConfig.configured ? 'Senha de gerente configurada. Salvar uma nova senha substitui a atual.' : 'Configure a senha que autoriza sangrias neste restaurante.'}</p></div></div><div className="finance-inline-fields"><label>Nova senha de gerente<input type="password" minLength={8} value={managerPassword} onChange={event => setManagerPassword(event.target.value)} placeholder="Mínimo 8 caracteres" required/></label><label>Tolerância de diferença (R$)<input type="number" min="0" max="100" step="0.01" value={tolerance} onChange={event => setTolerance(event.target.value)} required/></label></div><button className="finance-secondary-button" disabled={busy}>Salvar configuração</button></form>}
    </>}
    {!register && isAdmin && <form className="finance-panel finance-security-panel" onSubmit={submitManagerPassword}><div className="finance-panel-title"><span className="finance-icon-tile secure"><ShieldCheck size={18}/></span><div><h3>Autorização e tolerância</h3><p>{managerConfig.configured ? 'Senha de gerente configurada. Salvar uma nova senha substitui a atual.' : 'Configure a senha que autoriza sangrias neste restaurante.'}</p></div></div><div className="finance-inline-fields"><label>Nova senha de gerente<input type="password" minLength={8} value={managerPassword} onChange={event => setManagerPassword(event.target.value)} placeholder="Mínimo 8 caracteres" required/></label><label>TolerÃ¢ncia de diferença (R$)<input type="number" min="0" max="100" step="0.01" value={tolerance} onChange={event => setTolerance(event.target.value)} required/></label></div><button className="finance-secondary-button" disabled={busy}>Salvar configuração</button></form>}
    {isAdmin && <div className="finance-panel finance-audit-history"><div className="finance-panel-title"><span className="finance-icon-tile"><Clock3 size={18}/></span><div><h3>Auditorias recentes</h3><p>Fechamentos anteriores com contagem e diferença por forma de pagamento.</p></div></div>{history.length ? <div className="finance-history-list">{history.map(item=><details key={item.id} className="finance-history-item"><summary><span><b>{item.operator_name}</b><small>{new Date(item.closed_at).toLocaleString('pt-BR')}</small></span><span>Esperado {money(item.expected_amount)}<b className={Number(item.difference)<0?'negative':'positive'}>DiferenÃ§a {money(item.difference)}</b></span></summary><div className="finance-audit-methods">{methods.map(([key,label])=><span key={key}>{label}<b>{money(item.closing_breakdown?.[key])}</b></span>)}</div>{item.justification&&<p>Justificativa: {item.justification}</p>}</details>)}</div> : <p className="finance-empty-inline">Ainda não hÃ¡ fechamentos auditados neste restaurante.</p>}</div>}
    {audit && <div className="finance-audit-card"><div><span className="finance-icon-tile"><BadgeCheck size={21}/></span><div><span className="finance-eyebrow">AUDITORIA CONCLUÃDA</span><h3>Turno fechado</h3></div></div><div className="finance-audit-totals"><span>Contado <b>{money(audit.closing_amount)}</b></span><span>Esperado <b>{money(audit.expected_amount)}</b></span><span className={Number(audit.difference) < 0 ? 'negative' : 'positive'}>DiferenÃ§a <b>{money(audit.difference)}</b></span></div><div className="finance-audit-methods">{methods.map(([key,label])=><span key={key}>{label}<b>{money(audit.difference_breakdown?.[key])}</b></span>)}</div>{audit.justification && <p>Justificativa: {audit.justification}</p>}</div>}
  </section>;
}



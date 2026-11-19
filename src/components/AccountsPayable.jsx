import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, CircleAlert, Plus, ReceiptText, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
const methods = [['dinheiro','Dinheiro'],['pix','Pix'],['credito','Crédito'],['debito','Débito'],['voucher','Voucher']];
const effectiveStatus = row => row.status === 'pendente' && row.due_date < today() ? 'vencido' : row.status;

export default function AccountsPayable({ restaurantId }) {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filterStatus, setFilterStatus] = useState('todos');
  const [filterCategory, setFilterCategory] = useState('todas');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [paying, setPaying] = useState(null);
  const [createForm, setCreateForm] = useState({ categoryId: '', supplier: '', description: '', total: '', dueDate: today(), installments: '1' });
  const [paymentForm, setPaymentForm] = useState({ date: today(), method: 'dinheiro' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !restaurantId) return;
    setError('');
    const { error: statusError } = await supabase.rpc('refresh_accounts_payable_status');
    if (statusError) { setError(statusError.message || 'Falha ao atualizar vencimentos.'); return; }
    const [{ data, error: rowsError }, { data: categoryData, error: categoryError }] = await Promise.all([
      supabase.from('accounts_payable').select('id,category_id,installment_group_id,installment_number,installment_count,supplier_name,description,amount,due_date,payment_date,status,payment_method,created_at').eq('restaurant_id', restaurantId).order('due_date', { ascending: true }).limit(1000),
      supabase.from('financial_categories').select('id,name').eq('restaurant_id', restaurantId).eq('type', 'despesa').eq('active', true).order('name'),
    ]);
    if (rowsError || categoryError) { setError((rowsError || categoryError).message); return; }
    setRows(data || []); setCategories(categoryData || []);
    setCreateForm(current => ({ ...current, categoryId: current.categoryId || categoryData?.[0]?.id || '' }));
  }, [restaurantId]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const todayDate = today();
    const todayNextWeek = new Date(`${todayDate}T00:00:00`); todayNextWeek.setDate(todayNextWeek.getDate() + 7);
    const nextLimit = todayNextWeek.toISOString().slice(0, 10);
    const currentMonth = todayDate.slice(0, 7);
    return {
      today: rows.filter(row => !['pago','cancelado'].includes(row.status) && row.due_date === todayDate).reduce((sum,row)=>sum+Number(row.amount),0),
      upcoming: rows.filter(row => !['pago','cancelado'].includes(row.status) && row.due_date > todayDate && row.due_date <= nextLimit).reduce((sum,row)=>sum+Number(row.amount),0),
      overdue: rows.filter(row => effectiveStatus(row) === 'vencido').reduce((sum,row)=>sum+Number(row.amount),0),
      paid: rows.filter(row => row.status === 'pago' && row.payment_date?.slice(0,7) === currentMonth).reduce((sum,row)=>sum+Number(row.amount),0),
    };
  }, [rows]);

  const filtered = useMemo(() => rows.filter(row => {
    const status = effectiveStatus(row);
    const text = `${row.supplier_name} ${row.description}`.toLocaleLowerCase('pt-BR');
    return (filterStatus === 'todos' || status === filterStatus)
      && (filterCategory === 'todas' || row.category_id === filterCategory)
      && (!dateFrom || row.due_date >= dateFrom) && (!dateTo || row.due_date <= dateTo)
      && (!search.trim() || text.includes(search.trim().toLocaleLowerCase('pt-BR')));
  }), [rows, filterStatus, filterCategory, dateFrom, dateTo, search]);

  const createAccount = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { error: createError } = await supabase.rpc('create_accounts_payable_installments', {
        p_category_id: createForm.categoryId, p_supplier_name: createForm.supplier.trim(), p_description: createForm.description.trim(),
        p_total_amount: Number(createForm.total), p_first_due_date: createForm.dueDate, p_installment_count: Number(createForm.installments),
      });
      if (createError) throw createError;
      setShowCreate(false); setCreateForm(current => ({ ...current, supplier: '', description: '', total: '', installments: '1' }));
      await load(); setNotice('Conta cadastrada com sucesso.');
    } catch (saveError) { setError(saveError.message || 'Não foi possível cadastrar a conta.'); }
    finally { setBusy(false); }
  };
  const payAccount = async event => {
    event.preventDefault(); if (!paying) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: payError } = await supabase.rpc('pay_accounts_payable', {
        p_account_id: paying.id, p_payment_date: paymentForm.date, p_payment_method: paymentForm.method,
      });
      if (payError) throw payError;
      setPaying(null); await load(); setNotice('Pagamento baixado.');
    } catch (payError) { setError(payError.message || 'Não foi possível dar baixa na conta.'); }
    finally { setBusy(false); }
  };

  return <section className="finance-page finance-payables-page">
    <div className="finance-page-heading"><div><span className="finance-eyebrow">DESPESAS E PARCELAMENTOS</span><h2>Contas a pagar</h2><p>Controle vencimentos, fornecedores e baixas, incluindo compras parceladas.</p></div><button className="finance-primary-button" onClick={() => { setError(''); setShowCreate(true); }}><Plus size={16}/> Nova despesa</button></div>
    {error && <div className="finance-alert error" role="alert">{error}</div>}{notice && <div className="finance-alert success" role="status">{notice}</div>}
    <div className="finance-summary-grid"><article><span>Vencendo hoje</span><b>{money(counts.today)}</b><small>Contas com vencimento nesta data</small></article><article><span>A vencer em 7 dias</span><b>{money(counts.upcoming)}</b><small>Próximos vencimentos</small></article><article className={counts.overdue ? 'warning' : ''}><span>Contas atrasadas</span><b>{money(counts.overdue)}</b><small>Saldo pendente vencido</small></article><article className="positive"><span>Pago no mês</span><b>{money(counts.paid)}</b><small>Baixas deste mês</small></article></div>
    <div className="finance-panel finance-payables-panel"><div className="finance-panel-title"><span className="finance-icon-tile"><ReceiptText size={18}/></span><div><h3>Lançamentos</h3><p>{filtered.length} parcela(s) encontrada(s)</p></div></div>
      <div className="finance-filter-bar"><label className="finance-search"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Fornecedor ou descrição"/></label><select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="todos">Todos os status</option><option value="pendente">Pendente</option><option value="vencido">Vencido</option><option value="pago">Pago</option><option value="cancelado">Cancelado</option></select><select value={filterCategory} onChange={event => setFilterCategory(event.target.value)}><option value="todas">Todas as categorias</option>{categories.map(category=><option value={category.id} key={category.id}>{category.name}</option>)}</select><label>De<input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)}/></label><label>Até<input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)}/></label></div>
      {filtered.length ? <div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>Vencimento</th><th>Fornecedor / descrição</th><th>Categoria</th><th>Parcela</th><th>Status</th><th>Valor</th><th></th></tr></thead><tbody>{filtered.map(row=>{const status=effectiveStatus(row);return <tr key={row.id}><td>{new Date(`${row.due_date}T12:00:00`).toLocaleDateString('pt-BR')}</td><td><b>{row.supplier_name}</b><small>{row.description}</small></td><td>{categories.find(category=>category.id===row.category_id)?.name || '—'}</td><td>{row.installment_number}/{row.installment_count}</td><td><span className={`finance-status-pill ${status}`}>{status}</span></td><td className="finance-money-cell">{money(row.amount)}</td><td>{['pendente','vencido'].includes(status)&&<button className="finance-table-action" onClick={()=>{setPaying(row);setPaymentForm({date:today(),method:'dinheiro'});setError('');}}><Check size={14}/> Dar baixa</button>}</td></tr>;})}</tbody></table></div> : <div className="finance-empty-state"><CalendarClock size={28}/><b>Nenhuma conta neste filtro</b><span>Cadastre uma despesa ou ajuste o período selecionado.</span></div>}
    </div>
    {showCreate && <div className="finance-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setShowCreate(false);}}><form className="finance-modal" onSubmit={createAccount}><button type="button" className="finance-modal-close" onClick={()=>setShowCreate(false)} aria-label="Fechar"><X size={18}/></button><span className="finance-icon-tile"><ReceiptText size={20}/></span><h3>Nova conta a pagar</h3><p>Financiamento: informe o total da compra e a quantidade de parcelas mensais.</p><label>Fornecedor<input value={createForm.supplier} onChange={event=>setCreateForm(current=>({...current,supplier:event.target.value}))} minLength={2} maxLength={120} required/></label><label>Descrição<input value={createForm.description} onChange={event=>setCreateForm(current=>({...current,description:event.target.value}))} minLength={2} maxLength={240} placeholder="Ex.: Forno industrial" required/></label><div className="finance-inline-fields"><label>Categoria<select value={createForm.categoryId} onChange={event=>setCreateForm(current=>({...current,categoryId:event.target.value}))} required><option value="">Selecione</option>{categories.map(category=><option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Valor total (R$)<input type="number" min="0.01" step="0.01" value={createForm.total} onChange={event=>setCreateForm(current=>({...current,total:event.target.value}))} required/></label></div><div className="finance-inline-fields"><label>Primeiro vencimento<input type="date" value={createForm.dueDate} onChange={event=>setCreateForm(current=>({...current,dueDate:event.target.value}))} required/></label><label>Quantidade de parcelas<input type="number" min="1" max="120" value={createForm.installments} onChange={event=>setCreateForm(current=>({...current,installments:event.target.value}))} required/></label></div>{Number(createForm.total)>0&&Number(createForm.installments)>0&&<div className="finance-installment-preview"><CircleAlert size={15}/>{Number(createForm.installments)} parcela(s) mensais de aproximadamente {money(Number(createForm.total)/Number(createForm.installments))}. A última ajusta eventuais centavos.</div>}{error&&<div className="finance-alert error">{error}</div>}<div className="finance-modal-actions"><button type="button" className="finance-quiet-button" onClick={()=>setShowCreate(false)}>Cancelar</button><button className="finance-primary-button" disabled={busy}>{busy?'Salvando…':'Salvar conta'}</button></div></form></div>}
    {paying && <div className="finance-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setPaying(null);}}><form className="finance-modal" onSubmit={payAccount}><button type="button" className="finance-modal-close" onClick={()=>setPaying(null)} aria-label="Fechar"><X size={18}/></button><span className="finance-icon-tile positive"><Check size={20}/></span><h3>Dar baixa / pagar</h3><p>{paying.supplier_name} · {paying.description} · {money(paying.amount)}</p><label>Data do pagamento<input type="date" value={paymentForm.date} onChange={event=>setPaymentForm(current=>({...current,date:event.target.value}))} required/></label><label>Forma de pagamento<select value={paymentForm.method} onChange={event=>setPaymentForm(current=>({...current,method:event.target.value}))}>{methods.map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>{error&&<div className="finance-alert error">{error}</div>}<div className="finance-modal-actions"><button type="button" className="finance-quiet-button" onClick={()=>setPaying(null)}>Cancelar</button><button className="finance-primary-button" disabled={busy}>{busy?'Registrando…':'Confirmar pagamento'}</button></div></form></div>}
  </section>;
}

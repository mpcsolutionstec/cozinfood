import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarRange, RefreshCw, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const localISO = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const defaultStart = () => { const date = new Date(); date.setDate(1); return localISO(date); };
const tomorrow = value => { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate()+1); return localISO(date); };
const methodLabels = { cash:'Dinheiro', dinheiro:'Dinheiro', pix:'Pix', credit_card:'Crédito', credito:'Crédito', debit_card:'Débito', debito:'Débito', voucher:'Voucher' };

export default function FinancialDashboard({ restaurantId }) {
  const [dateFrom, setDateFrom] = useState(defaultStart);
  const [dateTo, setDateTo] = useState(() => localISO(new Date()));
  const [payments, setPayments] = useState([]);
  const [payables, setPayables] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!restaurantId) return;
    setBusy(true); setError('');
    const lower = `${dateFrom}T00:00:00`;
    const upper = `${tomorrow(dateTo)}T00:00:00`;
    const [paymentResult, payableResult, movementResult] = await Promise.all([
      supabase.from('payments').select('id,amount,method,paid_at').eq('restaurant_id',restaurantId).eq('status','pago').gte('paid_at',lower).lt('paid_at',upper),
      supabase.from('accounts_payable').select('id,amount,payment_date').eq('restaurant_id',restaurantId).eq('status','pago').gte('payment_date',dateFrom).lte('payment_date',dateTo),
      supabase.from('cash_movements').select('id,amount,created_at,category_id').eq('restaurant_id',restaurantId).eq('type','sangria').not('category_id','is',null).gte('created_at',lower).lt('created_at',upper),
    ]);
    const queryError = paymentResult.error || payableResult.error || movementResult.error;
    if (queryError) setError(queryError.message || 'Falha ao carregar os dados financeiros.');
    else { setPayments(paymentResult.data || []); setPayables(payableResult.data || []); setWithdrawals(movementResult.data || []); }
    setBusy(false);
  }, [restaurantId,dateFrom,dateTo]);
  useEffect(() => { load(); }, [load]);

  const report = useMemo(() => {
    const revenue = payments.reduce((sum,row)=>sum+Number(row.amount||0),0);
    const paidBills = payables.reduce((sum,row)=>sum+Number(row.amount||0),0);
    const categorizedWithdrawals = withdrawals.reduce((sum,row)=>sum+Number(row.amount||0),0);
    const byMethod = payments.reduce((result,row)=>{
      const label=methodLabels[row.method]||row.method||'Outro';
      result[label]=(result[label]||0)+Number(row.amount||0);
      return result;
    },{});
    return { revenue, expenses:paidBills+categorizedWithdrawals, paidBills, categorizedWithdrawals, byMethod };
  },[payments,payables,withdrawals]);
  const maxMethod = Math.max(1,...Object.values(report.byMethod));

  return <section className="finance-page finance-dashboard-page">
    <div className="finance-page-heading"><div><span className="finance-eyebrow">VISÃO EXECUTIVA</span><h2>Resultado financeiro</h2><p>Entradas liquidadas e despesas pagas no período selecionado.</p></div><div className="finance-date-range"><label>De<input type="date" value={dateFrom} max={dateTo} onChange={event=>setDateFrom(event.target.value)}/></label><label>Até<input type="date" value={dateTo} min={dateFrom} onChange={event=>setDateTo(event.target.value)}/></label><button className="finance-quiet-button" onClick={load} disabled={busy}><RefreshCw size={15}/>{busy?'Atualizando':'Atualizar'}</button></div></div>
    {error&&<div className="finance-alert error" role="alert">{error}</div>}
    <div className="finance-summary-grid finance-dre-summary"><article className="positive"><span><ArrowUpRight size={15}/> Total de entradas</span><b>{money(report.revenue)}</b><small>Vendas pagas no PDV e pedidos online</small></article><article className="warning"><span><ArrowDownRight size={15}/> Total de saídas</span><b>{money(report.expenses)}</b><small>{money(report.paidBills)} em contas + {money(report.categorizedWithdrawals)} em sangrias classificadas</small></article><article className={report.revenue - report.expenses >= 0 ? 'positive' : 'warning'}><span><Wallet size={15}/> Resultado estimado</span><b>{money(report.revenue - report.expenses)}</b><small>Entradas menos despesas pagas no período</small></article></div>
    <div className="finance-panel finance-payment-chart"><div className="finance-panel-title"><span className="finance-icon-tile"><CalendarRange size={18}/></span><div><h3>Vendas por forma de pagamento</h3><p>Distribuição do valor recebido entre os métodos.</p></div></div>{Object.keys(report.byMethod).length ? <div className="finance-method-bars">{Object.entries(report.byMethod).sort((a,b)=>b[1]-a[1]).map(([method,total])=><div className="finance-method-bar-row" key={method}><div><span>{method}</span><b>{money(total)}</b></div><i><span style={{width:`${Math.max(3,total/maxMethod*100)}%`}}/></i></div>)}</div> : <div className="finance-empty-state"><CalendarRange size={26}/><b>Sem vendas pagas neste período</b><span>Amplie o intervalo para consultar outros recebimentos.</span></div>}</div>
  </section>;
}

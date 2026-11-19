import { useState } from 'react';
import { Banknote, ChartNoAxesCombined, ReceiptText } from 'lucide-react';
import CashRegisterManager from './CashRegisterManager';
import AccountsPayable from './AccountsPayable';
import FinancialDashboard from './FinancialDashboard';

const tabs = [
  ['Resumo', ChartNoAxesCombined],
  ['Caixa e turnos', Banknote],
  ['Contas a pagar', ReceiptText],
];

export default function FinancialManager({ profile }) {
  const isAdmin = profile?.role === 'admin';
  const permissions = profile?.permissions || [];
  const availableTabs = isAdmin ? tabs : tabs.filter(([label]) => (label === 'Caixa e turnos' && permissions.includes('finance.cash.access')) || (label === 'Resumo' && permissions.includes('finance.dashboard.access')) || (label === 'Contas a pagar' && permissions.includes('finance.payables.access')));
  const [activeTab, setActiveTab] = useState(isAdmin ? 'Resumo' : availableTabs[0]?.[0] || '');
  return <div className="financial-module">
    {availableTabs.length > 1 && <div className="finance-module-tabs" role="tablist" aria-label="Seções financeiras">{availableTabs.map(([label,Icon])=><button type="button" role="tab" aria-selected={activeTab===label} className={activeTab===label?'active':''} key={label} onClick={()=>setActiveTab(label)}><Icon size={16}/>{label}</button>)}</div>}
    {activeTab==='Resumo'&&(isAdmin||permissions.includes('finance.dashboard.access'))?<FinancialDashboard restaurantId={profile.restaurant_id}/>:activeTab==='Contas a pagar'&&(isAdmin||permissions.includes('finance.payables.access'))?<AccountsPayable restaurantId={profile.restaurant_id}/>:activeTab==='Caixa e turnos'&&(isAdmin||permissions.includes('finance.cash.access'))?<CashRegisterManager profile={profile}/>:<div className="finance-empty-inline">Sem permissoes financeiras atribuidas a este usuario.</div>}
  </div>;
}

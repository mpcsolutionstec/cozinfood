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
  const [activeTab, setActiveTab] = useState(isAdmin ? 'Resumo' : 'Caixa e turnos');
  const availableTabs = isAdmin ? tabs : tabs.filter(([label]) => label === 'Caixa e turnos');
  return <div className="financial-module">
    {isAdmin && <div className="finance-module-tabs" role="tablist" aria-label="Seções financeiras">{availableTabs.map(([label,Icon])=><button type="button" role="tab" aria-selected={activeTab===label} className={activeTab===label?'active':''} key={label} onClick={()=>setActiveTab(label)}><Icon size={16}/>{label}</button>)}</div>}
    {activeTab==='Resumo'&&isAdmin?<FinancialDashboard restaurantId={profile.restaurant_id}/>:activeTab==='Contas a pagar'&&isAdmin?<AccountsPayable restaurantId={profile.restaurant_id}/>:<CashRegisterManager profile={profile}/>}
  </div>;
}

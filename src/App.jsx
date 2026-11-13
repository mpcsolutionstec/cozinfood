import {useEffect,useState} from 'react';
import {Activity,Bell,Bike,Box,ChefHat,ClipboardList,CircleDollarSign,Clock3,LayoutDashboard,LogOut,Pizza,QrCode,Settings,ShoppingCart,Utensils,Warehouse,Moon,Sun,UsersRound} from 'lucide-react';
import {useKDSOrders} from './hooks/useKDSOrders';import {useTableStatus} from './hooks/useTableStatus';
import {useAuth} from './components/AuthGate';
import {supabase} from './lib/supabaseClient';
import TablesManager from './components/TablesManager';
import WaiterApp from './components/WaiterApp';
import TableServiceAlerts from './components/TableServiceAlerts';
import StaffManager from './components/StaffManager';
import KitchenDisplay from './components/KitchenDisplay';
import PizzaMenuManager from './components/PizzaMenuManager';
import InventoryManager from './components/InventoryManager';
import DigitalMenuManager from './components/DigitalMenuManager';
import PointOfSale from './components/PointOfSale';
import ProductCatalogManager from './components/ProductCatalogManager';
import OverviewDashboard from './components/OverviewDashboard';
import { BRAND_LOGO } from './branding';
const money=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const getGreeting=()=>{const hour=new Date().getHours();if(hour>=5&&hour<12)return 'Bom dia';if(hour>=12&&hour<18)return 'Boa tarde';return 'Boa noite'};
const tabs=[['Visão geral',LayoutDashboard],['PDV',ShoppingCart],['Salão e mesas',Utensils],['Cozinha / KDS',ChefHat],['Pizzas e esfihas',Pizza],['Estoque e receitas',Warehouse],['Delivery',Bike],['Financeiro',CircleDollarSign],['Cardápio digital',QrCode],['Produtos',Box],['Equipe e acessos',UsersRound]];
const roleLabels={admin:'Administrador',garcom:'Garçom',caixa:'Caixa'};
function Sidebar({tab,setTab,name,initials,restaurantName,menuTabs,roleLabel}){return <aside className="sidebar"><div className="brand"><img className="brand-logo" src={BRAND_LOGO} alt="Logo COZINFOOD"/><div><b>COZINFOOD</b><small>RESTAURANTE</small></div></div><div className="restaurant"><span className="rest-icon">🍕</span><div><b>{restaurantName}</b><small>Restaurante conectado</small></div><span className="chevron">⌄</span></div><label className="nav-label">MENU PRINCIPAL</label><nav>{menuTabs.map(([n,I])=><button key={n} className={`nav-item ${tab===n?'selected':''}`} onClick={()=>setTab(n)}><I size={18}/><span>{n}</span>{n==='Cozinha / KDS'&&<i className="nav-dot"/>}</button>)}</nav><div className="sidebar-bottom">{menuTabs.length > 1 && <button className="nav-item"><Settings size={18}/><span>Configurações</span></button>}<div className="user"><div className="avatar">{initials}</div><div><b>{name}</b><small>{roleLabel}</small></div><span>···</span></div></div></aside>}
function Header({live,initials,onLogout,theme,onToggleTheme,role}){return <header className="topbar"><div className="crumb">COZINFOOD <span>/</span> Painel de operação</div><div className="top-actions"><span className="live"><i/>{live?'Conectado em tempo real':'Modo demonstração'}</span><button className="theme-toggle-top" type="button" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}<span>{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</span><i className={`theme-switch ${theme === 'dark' ? 'active' : ''}`} aria-hidden="true"/></button><button className="icon" type="button" disabled={role!=='admin'} onClick={()=>window.dispatchEvent(new Event('cozinfood:toggle-service-inbox'))} aria-label="Chamados da equipe" title="Chamados da equipe"><Bell size={18}/></button><button className="header-logout" onClick={onLogout} title="Sair da conta"><span className="avatar">{initials}</span><LogOut size={16}/><span>Sair</span></button></div></header>}
function Tables({tables}){return <><div className="page-heading"><div><h1>Salão e mesas</h1><p>Visualização do salão e comandas abertas.</p></div><button className="primary">＋ Abrir comanda</button></div><section className="panel"><div className="panel-head"><div><h2>Salão principal</h2><p>{tables.filter(x=>x.status==='ocupada').length} ocupadas · {tables.length} mesas</p></div><div className="legend"><span><i className="free-dot"/> Livre</span><span><i/> Ocupada</span></div></div><div className="full-table-grid">{tables.map(t=><article className={`floor-table ${t.status==='ocupada'?'occupied':''}`} key={t.id}><div><span className="table-number">{t.number}</span><span className="badge">{t.status==='ocupada'?'Ocupada':'Livre'}</span></div><b>{t.status==='ocupada'?money(t.current_total):'Disponível'}</b><small>{t.status==='ocupada'?'Comanda aberta':'Toque para iniciar'}</small></article>)}</div></section></>}
function KDS(){const [sector,setSector]=useState('all');const {orders,changeStatus,live}=useKDSOrders(sector);const sectors=['all','cozinha','bar','forno_pizza'];const labels={all:'Todos os setores',cozinha:'Cozinha',bar:'Bar',forno_pizza:'Forno de pizza'};return <><div className="page-heading"><div><h1>Cozinha / KDS</h1><p>Fila de produção sincronizada em tempo real.</p></div><span className="live"><i/>{live?'Ao vivo':'Demonstração'}</span></div><div className="filter-row">{sectors.map(s=><button key={s} onClick={()=>setSector(s)} className={`filter ${sector===s?'active':''}`}>{labels[s]}</button>)}</div><div className="kds-grid">{orders.map((o,i)=><article className="ticket" key={o.id}><div className="ticket-head"><b>#{o.order_id}</b><span className={`timer ${i===0?'late':''}`}>◷ {Math.max(1,Math.floor((Date.now()-new Date(o.created_at).getTime())/60000))} min</span></div><div className="ticket-origin">{labels[o.destination_sector]||'COZINHA'} · Mesa {i+3}</div><div className="ticket-item"><strong>{o.quantity}× {o.name}</strong><p>{o.notes||'Sem observações'}</p></div><div className="ticket-actions"><button onClick={()=>changeStatus(o.id,o.status==='pendente'?'em_preparo':'pronto')} className="primary">{o.status==='pendente'?'Iniciar preparo':'Marcar pronto'}</button></div></article>)}</div></>}
export default function App(){
 const {profile,signOut}=useAuth();
 if(profile?.role==='garcom')return <WaiterApp onLogout={signOut}/>;
 return <AdminApp/>;
}
function AdminApp(){
 const {session,profile,signOut}=useAuth();
 const [registeredRestaurantName,setRegisteredRestaurantName]=useState('');
 useEffect(()=>{const restaurantId=profile?.restaurant_id;if(!restaurantId||!supabase){setRegisteredRestaurantName(session?.user?.user_metadata?.restaurant_name||'');return}let active=true;supabase.from('restaurants').select('name').eq('id',restaurantId).maybeSingle().then(({data})=>{if(active)setRegisteredRestaurantName(data?.name||session?.user?.user_metadata?.restaurant_name||'')});return()=>{active=false}},[profile?.restaurant_id,session?.user?.id]);
 const restaurantName=registeredRestaurantName||session?.user?.user_metadata?.restaurant_name||'Meu restaurante';
 const name=profile?.full_name||session?.user?.user_metadata?.full_name||session?.user?.email||'Administrador';
 const initials=name.trim().split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase();
 const [greeting,setGreeting]=useState(getGreeting);
 useEffect(()=>{const timer=setInterval(()=>setGreeting(getGreeting()),60000);return()=>clearInterval(timer)},[]);
 const initialTab=profile?.role==='caixa'?'PDV':'Visão geral';
 const [tab,setTab]=useState(initialTab);
 useEffect(()=>setTab(initialTab),[initialTab]);
 const [theme,setTheme]=useState(()=>window.localStorage.getItem('cozinfood-theme')==='dark'?'dark':'light');
 useEffect(()=>{document.documentElement.dataset.theme=theme;window.localStorage.setItem('cozinfood-theme',theme)},[theme]);
 const {tables,live:tl,loading:tablesLoading,error:tablesError,refresh:refreshTables}=useTableStatus();
 const {live:ol}=useKDSOrders('all','dashboard');
 const live=tl||ol;
 const menuTabs=profile?.role==='caixa'?tabs.filter(([label])=>label==='PDV'):tabs;
 const toggleTheme=()=>setTheme(current=>current==='light'?'dark':'light');
 return <><TableServiceAlerts role={profile?.role}/><div className="app-shell"><Sidebar tab={tab} setTab={setTab} name={name} initials={initials} restaurantName={restaurantName} menuTabs={menuTabs} roleLabel={roleLabels[profile?.role]||'Administrador'}/><main className="main"><Header live={live} initials={initials} onLogout={signOut} theme={theme} onToggleTheme={toggleTheme} role={profile?.role}/><div className="content">{tab==='Visão geral'?<OverviewDashboard tables={tables} tablesLoading={tablesLoading} tablesError={tablesError} refreshTables={refreshTables} setTab={setTab} firstName={name} greeting={greeting} restaurantId={profile?.restaurant_id}/>:tab==='Produtos'?<ProductCatalogManager/>:tab==='PDV'?<PointOfSale/>:tab==='Salão e mesas'?<TablesManager tables={tables} loading={tablesLoading} loadError={tablesError} refresh={refreshTables}/>:tab==='Equipe e acessos'&&profile?.role==='admin'?<StaffManager profile={profile}/>:tab==='Cozinha / KDS'?<KitchenDisplay/>:tab==='Pizzas e esfihas'?<PizzaMenuManager/>:tab==='Estoque e receitas'?<InventoryManager/>:tab==='Delivery'?<Delivery/>:tab==='Cardápio digital'?<DigitalMenuManager/>:<div className="page-heading"><div><h1>{tab}</h1><p>Módulo preparado para configuração com Supabase.</p></div></div>}</div><footer className="foot"><span>© 2026 COZINFOOD · Gestão inteligente para food service</span><span>● Sistema operacional</span></footer></main></div></>;
}

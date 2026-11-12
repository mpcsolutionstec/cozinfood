import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, ChefHat, CircleDollarSign, Clock3, CreditCard, Minus, MoreHorizontal, Plus, Search, Send, ShoppingBag, Trash2, Users, WifiOff, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useWaiterStore } from '../stores/useWaiterStore';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const EMPTY_CART = Object.freeze([]);
const sameFractionSize = (fraction, selected) => selected?.name
  ? fraction?.name === selected.name
  : fraction?.serves === selected?.serves;
const fractionForProductSize = (product, selected) => (product.product_fractions || []).find(fraction => sameFractionSize(fraction, selected));
const imageFor = product => product?.image_url || (product?.image_path && supabase ? supabase.storage.from('product-images').getPublicUrl(product.image_path).data.publicUrl : '');
const statusText = { pendente: 'Na fila', em_preparo: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado' };

export default function OrderCart({ table, tables, profile, onBack, onNotice, onTableChanged, onAction }) {
  const cart = useWaiterStore(state => state.carts[table.id] || EMPTY_CART);
  const addItem = useWaiterStore(state => state.addItem);
  const setQuantity = useWaiterStore(state => state.setQuantity);
  const setItemNote = useWaiterStore(state => state.setItemNote);
  const clearCart = useWaiterStore(state => state.clearCart);
  const queueOrder = useWaiterStore(state => state.queueOrder);
  const clearPendingOrder = useWaiterStore(state => state.clearPendingOrder);
  const pending = useWaiterStore(state => state.pendingByTable[table.id]);
  const guestCount = useWaiterStore(state => state.guestCount);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [additions, setAdditions] = useState([]);
  const [borders, setBorders] = useState([]);
  const [fractionPricing, setFractionPricing] = useState('maior_valor');
  const [order, setOrder] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [category, setCategory] = useState('todas');
  const [search, setSearch] = useState('');
  const [customProduct, setCustomProduct] = useState(null);
  const [previewProduct, setPreviewProduct] = useState(null);
  const [customSize, setCustomSize] = useState('');
  const [flavorCount, setFlavorCount] = useState(1);
  const [flavorIds, setFlavorIds] = useState([]);
  const [borderId, setBorderId] = useState('');
  const [additionIds, setAdditionIds] = useState([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');

  const loadData = useCallback(async () => {
    if (!supabase || !profile?.restaurant_id) return;
    const [categoryResult, productResult, additionResult, borderResult, restaurantResult] = await Promise.all([
      supabase.from('categories').select('id,name,slug').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('sort_order'),
      supabase.from('products').select('id,name,description,base_price,category_id,destination_sector,image_url,image_path,accepts_fractions,categories(name,slug),product_fractions(id,name,price,serves,active)').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('name'),
      supabase.from('product_additions').select('id,name,price').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('name'),
      supabase.from('pizza_borders').select('id,name,price').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('name'),
      supabase.from('restaurants').select('fraction_pricing').eq('id', profile.restaurant_id).single(),
    ]);
    const fail = categoryResult.error || productResult.error || additionResult.error || borderResult.error || restaurantResult.error;
    if (fail) { setNotice(`Não foi possível carregar o cardápio: ${fail.message}`); setLoading(false); return; }
    setCategories(categoryResult.data || []);
    setProducts((productResult.data || []).map(product => ({ ...product, product_fractions: (product.product_fractions || []).filter(fraction => fraction.active).sort((a,b) => a.price-b.price) })));
    setAdditions(additionResult.data || []); setBorders(borderResult.data || []);
    setFractionPricing(restaurantResult.data?.fraction_pricing || 'maior_valor');
    setLoading(false);
  }, [profile?.restaurant_id]);

  const loadOrder = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('orders').select('id,order_number,status,total,created_at')
      .eq('table_id', table.id).not('status', 'in', '(entregue,cancelado)').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return;
    setOrder(data || null);
    if (!data) { setOrderItems([]); return; }
    const { data: items } = await supabase.from('order_items').select('id,name,quantity,unit_price,line_total,fraction_label,notes,status,created_at')
      .eq('order_id', data.id).order('created_at');
    setOrderItems(items || []);
  }, [table.id]);

  useEffect(() => { loadData(); loadOrder(); }, [loadData, loadOrder]);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    const channel = supabase?.channel(`waiter-order-${table.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `table_id=eq.${table.id}` }, loadOrder)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, loadOrder)
      .subscribe();
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); clearInterval(timer); if (channel) supabase.removeChannel(channel); };
  }, [table.id, loadOrder]);

  const productsFiltered = useMemo(() => products.filter(product => {
    const matchesCategory = category === 'todas' || product.category_id === category;
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    return matchesCategory && (!needle || `${product.name} ${product.description || ''}`.toLocaleLowerCase('pt-BR').includes(needle));
  }), [products, category, search]);
  const cartTotal = cart.reduce((sum, item) => sum + Number(item.unitPrice || item.fraction?.price || item.product.base_price || 0) * Number(item.quantity || 1), 0);
  const tableTotal = Number(order?.total || table.current_total || 0);
  const statusMessage = orderItems.filter(item => item.status !== 'cancelado').reduce((result,item) => {
    result[item.status] = (result[item.status] || 0) + 1; return result;
  }, {});

  const addProduct = product => {
    const fractions = product.product_fractions || [];
    const isPizza = product.categories?.slug === 'pizzas';
    if (fractions.length && isPizza) {
      setCustomProduct(product); setCustomSize(fractions[0].id); setFlavorCount(1); setFlavorIds([product.id]); setBorderId(''); setAdditionIds([]); setNotes(''); return;
    }
    if (fractions.length) {
      setCustomProduct(product); setCustomSize(fractions[0].id); setFlavorCount(1); setFlavorIds([product.id]); setBorderId(''); setAdditionIds([]); setNotes(''); return;
    }
    addItem(table.id, { product, unitPrice: Number(product.base_price), quantity: 1, notes: '', additions: [], flavors: [] });
  };

  const selectedFraction = customProduct?.product_fractions?.find(fraction => fraction.id === customSize);
  const eligibleFlavors = useMemo(() => products.filter(product => product.categories?.slug === (customProduct?.categories?.slug || 'pizzas') && fractionForProductSize(product, selectedFraction)), [products, customProduct, selectedFraction]);
  const selectedFlavors = flavorIds.map(id => eligibleFlavors.find(product => product.id === id)).filter(Boolean);
  const flavorBasePrice = selectedFlavors.length ? (fractionPricing === 'media_ponderada'
    ? selectedFlavors.reduce((sum,product) => sum + Number(fractionForProductSize(product, selectedFraction)?.price || 0),0) / selectedFlavors.length
    : Math.max(...selectedFlavors.map(product => Number(fractionForProductSize(product, selectedFraction)?.price || 0)))
  ) : Number(selectedFraction?.price || 0);
  const border = borders.find(item => item.id === borderId);
  const selectedAdditions = additions.filter(item => additionIds.includes(item.id));
  const customTotal = flavorBasePrice + Number(border?.price || 0) + selectedAdditions.reduce((sum,item) => sum + Number(item.price || 0),0);

  const saveCustom = event => {
    event.preventDefault();
    if (!customProduct || !selectedFraction || selectedFlavors.length !== flavorCount) return;
    const isPizza = customProduct.categories?.slug === 'pizzas';
    const flavors = isPizza ? selectedFlavors.map(product => ({ product, fraction: fractionForProductSize(product, selectedFraction), share: 1 / flavorCount })) : [];
    addItem(table.id, { product: customProduct, fraction: selectedFraction, flavors, border, additions: selectedAdditions.map(item => ({ ...item, quantity: 1 })), notes, unitPrice: customTotal, quantity: 1 });
    setCustomProduct(null);
  };

  const sendOrder = async () => {
    if (!cart.length || busy) return;
    const request = {
      requestId: crypto.randomUUID(), guestCount,
      items: cart.map(item => ({ product_id: item.product.id, fraction_id: item.flavors?.length ? null : item.fraction?.id || null,
        quantity: item.quantity, notes: item.notes || '', border_id: item.border?.id || null,
        additions: (item.additions || []).map(addition => ({ id: addition.id, quantity: addition.quantity || 1 })),
        flavors: (item.flavors || []).map(flavor => ({ product_id: flavor.product.id, product_fraction_id: flavor.fraction.id, fraction: flavor.share })) })),
      customerName: '',
    };
    setBusy(true); setNotice('');
    queueOrder(table.id, request);
    try {
      if (!navigator.onLine) throw new Error('offline');
      const { data, error } = await supabase.rpc('submit_waiter_order', { p_table_id: table.id, p_customer_name: '', p_guest_count: guestCount, p_items: request.items, p_request_id: request.requestId });
      if (error) throw error;
      clearPendingOrder(table.id); clearCart(table.id);
      setNotice(`Pedido #${data?.order_number || ''} enviado para produção.`);
      await Promise.all([loadOrder(), onTableChanged()]);
    } catch (sendError) {
      if (!navigator.onLine || sendError.message === 'offline' || /fetch|network/i.test(sendError.message || '')) {
        clearCart(table.id);
        setNotice('Sem conexão. Pedido salvo neste aparelho e será enviado automaticamente quando a rede voltar.');
      } else {
        clearPendingOrder(table.id);
        setNotice(`Não foi possível enviar: ${sendError.message}`);
      }
    } finally { setBusy(false); }
  };

  const retryPending = async () => {
    if (!pending || !online) return;
    setBusy(true);
    const { error } = await supabase.rpc('submit_waiter_order', { p_table_id: table.id, p_customer_name: pending.customerName || '', p_guest_count: pending.guestCount || 1, p_items: pending.items, p_request_id: pending.requestId });
    if (error) setNotice(`Pedido ainda na fila: ${error.message}`);
    else { clearPendingOrder(table.id); setNotice('Pedido pendente sincronizado com a cozinha.'); await loadOrder(); onTableChanged(); }
    setBusy(false);
  };

  const elapsedText = order?.created_at ? (() => { const mins = Math.floor((now - new Date(order.created_at).getTime()) / 60000); return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`; })() : '';

  return <div className="waiter-service">
    <header className="waiter-service-head"><button className="waiter-back" onClick={onBack}><ArrowLeft size={19}/><span>Salão</span></button><div><h1>Mesa {table.number}</h1><p><Users size={14}/> {guestCount} lugares{elapsedText && <> · <Clock3 size={14}/> aberta há {elapsedText}</>}</p></div><span className={`waiter-connection ${online ? 'online' : 'offline'}`}>{online ? 'Online' : <><WifiOff size={14}/> Offline</>}</span></header>
    {notice && <div className="waiter-inline-notice" role="status">{notice}{pending && online && <button onClick={retryPending} disabled={busy}>Tentar enviar</button>}</div>}
    {order && <section className="waiter-open-order"><div className="waiter-order-title"><div><b>Comanda #{order.order_number}</b><span>Conta parcial</span></div><strong>{money(tableTotal)}</strong></div>{Object.entries(statusMessage).map(([status,count]) => <span className={`waiter-item-status ${status}`} key={status}>{count} {statusText[status]?.toLowerCase() || status}</span>)}<div className="waiter-order-items">{orderItems.map(item => <div className="waiter-existing-item" key={item.id}><div><b>{item.quantity}× {item.name}</b>{item.fraction_label && <small>{item.fraction_label}</small>}{item.notes && <small>Obs.: {item.notes}</small>}</div><span className={`waiter-item-status ${item.status}`}>{statusText[item.status] || item.status}</span><strong>{money(item.line_total)}</strong></div>)}</div></section>}
    <section className="waiter-catalog">
      <div className="waiter-catalog-top"><div><h2>Cardápio</h2><p>Toque no item para adicionar rapidamente</p></div><label className="waiter-search"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar produto"/></label></div>
      <div className="waiter-categories"><button className={category === 'todas' ? 'active' : ''} onClick={() => setCategory('todas')}>Tudo</button>{categories.map(item => <button className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>
      {loading ? <div className="waiter-loading">Carregando cardápio…</div> : <div className="waiter-product-grid">{productsFiltered.map(product => <article className="waiter-product" key={product.id}><div className="waiter-product-main">{imageFor(product) ? <button type="button" className="waiter-product-image" onClick={event => { event.preventDefault(); event.stopPropagation(); setPreviewProduct(product); }} aria-label={`Ampliar foto de ${product.name}`}><img src={imageFor(product)} alt={product.name} loading="lazy"/></button> : <span className="waiter-product-placeholder"><ShoppingBag size={22}/></span>}<button type="button" className="waiter-product-info" onClick={() => addProduct(product)}><b>{product.name}</b><small>{product.description || product.categories?.name || 'Produto'}</small><strong>A partir de {money(product.product_fractions?.[0]?.price || product.base_price)}</strong></button><button type="button" className="waiter-product-add" onClick={() => addProduct(product)} aria-label={`Adicionar ${product.name}`}><Plus size={18}/></button></div></article>)}</div>}
    </section>
    {cart.length > 0 && <section className="waiter-cart"><div className="waiter-cart-title"><div><h2>Rascunho do pedido</h2><span>{cart.reduce((sum,item) => sum + Number(item.quantity || 1),0)} item(ns) · {money(cartTotal)}</span></div><button onClick={() => clearCart(table.id)} aria-label="Limpar pedido"><Trash2 size={17}/></button></div>{cart.map(item => <div className="waiter-cart-item" key={item.key}><div className="waiter-cart-item-label"><b>{item.product.name}</b><small>{item.flavors?.length ? item.flavors.map(flavor => flavor.product.name).join(' / ') : item.fraction?.name || ''}{item.border ? ` · Borda ${item.border.name}` : ''}</small><input value={item.notes || ''} maxLength={300} onChange={event => setItemNote(table.id,item.key,event.target.value)} placeholder="Observação (ex.: sem cebola)"/></div><div className="waiter-quantity"><button onClick={() => setQuantity(table.id,item.key,item.quantity - 1)} aria-label="Diminuir"><Minus size={15}/></button><b>{item.quantity}</b><button onClick={() => setQuantity(table.id,item.key,item.quantity + 1)} aria-label="Aumentar"><Plus size={15}/></button></div><strong>{money(Number(item.unitPrice || 0) * item.quantity)}</strong></div>)}</section>}
    <div className="waiter-bottom-bar">{pending && <span className="waiter-queued-label"><WifiOff size={15}/> Pedido aguardando conexão</span>}<button type="button" className="waiter-action-secondary" onClick={() => setActionsOpen(true)} aria-label="Ações da mesa" title="Ações"><MoreHorizontal size={19}/><span className="waiter-action-label">Ações</span></button><button type="button" className="waiter-action-secondary" onClick={() => onAction('pedir_conta')} aria-label="Pedir conta" title="Pedir conta"><CircleDollarSign size={17}/><span className="waiter-action-label">Pedir conta</span></button><button type="button" className="waiter-send" disabled={!cart.length || busy || Boolean(pending)} onClick={sendOrder}><Send size={18}/><span>{busy ? 'Enviando…' : online ? 'Enviar para produção' : 'Guardar e enviar depois'}</span><b>{money(cartTotal)}</b></button></div>
    {actionsOpen && <div className="waiter-modal-layer" onMouseDown={event => { if(event.target===event.currentTarget)setActionsOpen(false); }}><section className="waiter-modal waiter-actions-modal" role="dialog" aria-modal="true" aria-labelledby="waiter-actions-title"><button className="waiter-modal-close" onClick={() => setActionsOpen(false)} aria-label="Fechar"><X size={18}/></button><span className="waiter-modal-icon"><MoreHorizontal size={22}/></span><h2 id="waiter-actions-title">Ações da Mesa {table.number}</h2><p>Chame a equipe, solicite divisão da conta ou mova a comanda.</p><button className="waiter-menu-action" onClick={() => { setActionsOpen(false); onAction('chamar_gerente'); }}><ChefHat size={18}/><span><b>Chamar gerente</b><small>Solicitar apoio no atendimento</small></span></button><button className="waiter-menu-action" onClick={() => { setActionsOpen(false); onAction('dividir_conta'); }}><CreditCard size={18}/><span><b>Solicitar divisão da conta</b><small>Enviar pedido para o caixa</small></span></button><label className="waiter-transfer-label">Transferir comanda<select value={targetTableId} onChange={event => setTargetTableId(event.target.value)}><option value="">Escolher mesa livre</option>{tables.filter(item => item.id !== table.id && item.status === 'livre').map(item => <option value={item.id} key={item.id}>Mesa {item.number}</option>)}</select></label><button className="waiter-primary" disabled={!targetTableId} onClick={() => { setActionsOpen(false); onAction('transferir',targetTableId); }}> <ArrowRightLeft size={17}/> Transferir comanda</button></section></div>}
    {previewProduct && <div className="waiter-modal-layer waiter-image-preview-layer" onMouseDown={event => { if(event.target===event.currentTarget)setPreviewProduct(null); }}><section className="waiter-image-preview" role="dialog" aria-modal="true" aria-label={`Foto de ${previewProduct.name}`}><button className="waiter-modal-close" onClick={() => setPreviewProduct(null)} aria-label="Fechar foto"><X size={18}/></button>{imageFor(previewProduct) && <img src={imageFor(previewProduct)} alt={previewProduct.name}/>}<h2>{previewProduct.name}</h2></section></div>}
    {customProduct && <div className="waiter-modal-layer" onMouseDown={event => { if(event.target===event.currentTarget)setCustomProduct(null); }}><form className="waiter-modal waiter-custom-modal" onSubmit={saveCustom}><button type="button" className="waiter-modal-close" onClick={() => setCustomProduct(null)} aria-label="Fechar"><X size={18}/></button><span className="waiter-modal-icon"><ShoppingBag size={22}/></span><h2>{customProduct.name}</h2><p>Personalize o item antes de incluir no pedido.</p><label>Tamanho<select required value={customSize} onChange={event => { setCustomSize(event.target.value); setFlavorIds([customProduct.id]); }}>{customProduct.product_fractions.map(fraction => <option key={fraction.id} value={fraction.id}>{fraction.name} · {money(fraction.price)}</option>)}</select></label>
      {customProduct.categories?.slug === 'pizzas' && <><label>Quantidade de sabores<select value={flavorCount} onChange={event => { const count=Number(event.target.value); setFlavorCount(count); setFlavorIds(ids => ids.slice(0,count)); }}>{[1,2,3,4].map(count => <option key={count} value={count}>{count} {count===1?'sabor':'sabores'}</option>)}</select></label><fieldset><legend>Sabores ({flavorIds.length}/{flavorCount})</legend><div className="waiter-flavor-list">{eligibleFlavors.map(product => <label key={product.id}><input type="checkbox" checked={flavorIds.includes(product.id)} disabled={!flavorIds.includes(product.id) && flavorIds.length >= flavorCount} onChange={event => setFlavorIds(ids => event.target.checked ? [...ids,product.id] : ids.filter(id=>id!==product.id))}/><span>{product.name}</span><small>{money(fractionForProductSize(product, selectedFraction)?.price)}</small></label>)}</div></fieldset></>}
      {borders.length>0 && <label>Borda recheada<select value={borderId} onChange={event=>setBorderId(event.target.value)}><option value="">Sem borda</option>{borders.map(item=><option key={item.id} value={item.id}>{item.name} · {money(item.price)}</option>)}</select></label>}
      {additions.length>0 && <fieldset><legend>Adicionais</legend><div className="waiter-flavor-list">{additions.map(item=><label key={item.id}><input type="checkbox" checked={additionIds.includes(item.id)} onChange={event=>setAdditionIds(ids=>event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/><span>{item.name}</span><small>+ {money(item.price)}</small></label>)}</div></fieldset>}
      <label>Observação<textarea maxLength={300} value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Ex.: sem cebola"/></label><div className="waiter-custom-total"><span>Valor unitário</span><b>{money(customTotal)}</b></div><button className="waiter-primary" disabled={selectedFlavors.length!==flavorCount}>Adicionar ao pedido</button>
    </form></div>}
  </div>;
}

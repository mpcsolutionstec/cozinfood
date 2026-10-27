import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChefHat, Minus, Plus, ReceiptText, RefreshCw, Send, ShoppingBag, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const productImageUrl = imagePath => imagePath ? supabase.storage.from('product-images').getPublicUrl(imagePath).data.publicUrl : '';

export default function TableService({ table, profile, onClose, onChanged }) {
  const draftKey = `cozinfood:table-draft:${table.id}`;
  const pendingKey = `cozinfood:table-pending:${table.id}`;
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem(draftKey) || '{}').cart || []; } catch { return []; }
  });
  const [categoryId, setCategoryId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [orderNote, setOrderNote] = useState(() => {
    try { return JSON.parse(localStorage.getItem(draftKey) || '{}').orderNote || ''; } catch { return ''; }
  });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const loadOrder = async () => {
    const { data, error: orderError } = await supabase
      .from('orders')
      .select('id,order_number,status,total,created_at,order_items(id,name,quantity,line_total,fraction_label,status,notes)')
      .eq('table_id', table.id)
      .not('status', 'in', '(entregue,cancelado)')
      .order('created_at', { ascending: false })
      .limit(1);
    if (orderError) setError(`Não foi possível carregar a comanda: ${orderError.message}`);
    else setActiveOrder(data?.[0] || null);
  };

  const loadMenu = async () => {
    setLoading(true);
    setError('');
    const [categoryResult, productResult] = await Promise.all([
      supabase.from('categories').select('id,name,slug,sort_order').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('sort_order').order('name'),
      supabase.from('products').select('id,name,description,base_price,image_path,accepts_fractions,destination_sector,category_id,categories(name),product_fractions(id,name,serves,price,active)').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('name'),
    ]);
    const queryError = categoryResult.error || productResult.error;
    if (queryError) setError(`Não foi possível carregar o cardápio: ${queryError.message}`);
    else {
      setCategories(categoryResult.data || []);
      setProducts(productResult.data || []);
    }
    await loadOrder();
    setLoading(false);
  };

  useEffect(() => { loadMenu(); }, [table.id]);
  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify({ cart, orderNote })); } catch { /* armazenamento local indisponivel */ }
  }, [draftKey, cart, orderNote]);
  useEffect(() => {
    const channel = supabase.channel(`table-service-${table.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `table_id=eq.${table.id}` }, loadOrder)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, loadOrder)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [table.id]);

  const visibleProducts = useMemo(() => products.filter(product => categoryId === 'all' || product.category_id === categoryId), [products, categoryId]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.quantity * Number(item.fraction?.price ?? item.product.base_price), 0), [cart]);

  const addProduct = (product, fraction = null) => {
    const key = `${product.id}:${fraction?.id || 'base'}`;
    setCart(items => {
      const existing = items.find(item => item.key === key);
      if (existing) return items.map(item => item.key === key ? { ...item, quantity: item.quantity + 1 } : item);
      return [...items, { key, product, fraction, quantity: 1, notes: '' }];
    });
  };
  const changeQuantity = (key, amount) => setCart(items => items.map(item => item.key === key ? { ...item, quantity: Math.max(0, item.quantity + amount) } : item).filter(item => item.quantity > 0));
  const changeNote = (key, notes) => setCart(items => items.map(item => item.key === key ? { ...item, notes } : item));

  const sendDraft = useCallback(async draft => {
    if (!draft?.cart?.length || !navigator.onLine) return;
    setSending(true);
    setError('');
    setNotice('');
    const { data, error: submitError } = await supabase.rpc('submit_table_order', {
      p_qr_token: table.qr_token,
      p_customer_name: profile.full_name,
      p_items: draft.cart.map(item => ({ product_id: item.product.id, fraction_id: item.fraction?.id || null, quantity: item.quantity, notes: item.notes })),
      p_notes: draft.orderNote,
      p_request_id: draft.requestId,
    });
    if (submitError) setError(`Não foi possível enviar o pedido: ${submitError.message}`);
    else {
      localStorage.removeItem(pendingKey);
      localStorage.removeItem(draftKey);
      setCart([]);
      setOrderNote('');
      setNotice(`Pedido #${data.order_number} enviado para a cozinha.`);
      await loadOrder();
      onChanged?.();
    }
    setSending(false);
  }, [draftKey, onChanged, pendingKey, profile.full_name, table.qr_token]);

  useEffect(() => {
    const sendPending = () => {
      if (!navigator.onLine) return;
      try {
        const pending = JSON.parse(localStorage.getItem(pendingKey) || 'null');
        if (pending) sendDraft(pending);
      } catch { setError('Não foi possível recuperar o pedido salvo neste dispositivo.'); }
    };
    sendPending();
    window.addEventListener('online', sendPending);
    return () => window.removeEventListener('online', sendPending);
  }, [pendingKey, sendDraft]);

  const submitOrder = event => {
    event.preventDefault();
    if (!cart.length) return;
    const draft = { cart, orderNote, requestId: crypto.randomUUID() };
    try { localStorage.setItem(pendingKey, JSON.stringify(draft)); }
    catch { setError('Ative o armazenamento do navegador para salvar pedidos sem conexão.'); return; }
    if (!navigator.onLine) {
      setNotice('Pedido salvo neste dispositivo. Será enviado automaticamente quando a conexão voltar.');
      return;
    }
    sendDraft(draft);
  };

  const requestBill = async () => {
    const { error: billError } = await supabase.from('tables').update({ status: 'aguardando_conta' }).eq('id', table.id).eq('restaurant_id', profile.restaurant_id);
    if (billError) setError(`Não foi possível solicitar a conta: ${billError.message}`);
    else { setNotice('Mesa marcada como aguardando conta.'); onChanged?.(); }
  };

  const closeOrder = async () => {
    if (!activeOrder) return;
    setSending(true);
    setError('');
    const { error: itemError } = await supabase.from('order_items').update({ status: 'entregue' }).eq('order_id', activeOrder.id).not('status', 'in', '(entregue,cancelado)');
    if (itemError) { setError(`Não foi possível finalizar os itens: ${itemError.message}`); setSending(false); return; }
    const { error: closeError } = await supabase.from('orders').update({ status: 'entregue' }).eq('id', activeOrder.id);
    if (closeError) setError(`Não foi possível fechar a comanda: ${closeError.message}`);
    else { setActiveOrder(null); setNotice('Comanda finalizada e mesa liberada.'); onChanged?.(); }
    setSending(false);
  };

  return <div className="service-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose(); }}>
    <section className="service-panel" role="dialog" aria-modal="true" aria-labelledby="service-title">
      <header className="service-header"><div><span className="service-icon"><ChefHat size={19}/></span><div><h2 id="service-title">Atendimento · Mesa {table.number}</h2><p>{table.capacity} lugares · {activeOrder ? `Comanda #${activeOrder.order_number}` : 'Nova comanda'}</p></div></div><button type="button" className="service-close" onClick={onClose} aria-label="Fechar"><X size={20}/></button></header>
      {error && <div className="service-alert error" role="alert">{error}</div>}
      {notice && <div className="service-alert success" role="status">{notice}</div>}
      {loading ? <div className="service-loading"><RefreshCw size={17}/> Carregando cardápio...</div> : <div className="service-layout">
        <section className="service-menu">
          <div className="service-category-list"><button className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>Tudo</button>{categories.map(category => <button key={category.id} className={categoryId === category.id ? 'active' : ''} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div>
          <div className="service-products">{visibleProducts.map(product => <article className="service-product" key={product.id}><img className="service-product-photo" src={productImageUrl(product.image_path) || undefined} alt={product.name} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/><div className="service-product-details"><b>{product.name}</b><p>{product.description || product.categories?.name || 'Item do cardápio'}</p></div>{product.product_fractions?.filter(fraction => fraction.active).length > 0 ? <div className="service-variants">{product.product_fractions.filter(fraction => fraction.active).map(fraction => <button key={fraction.id} onClick={() => addProduct(product, fraction)}><span>{fraction.name}</span><b>{money(fraction.price)} <Plus size={13}/></b></button>)}</div> : <button className="service-add" onClick={() => addProduct(product)}><span>{money(product.base_price)}</span><Plus size={16}/></button>}</article>)}{visibleProducts.length === 0 && <div className="service-empty">Nenhum produto ativo nesta categoria.</div>}</div>
        </section>
        <aside className="service-cart"><div className="service-cart-heading"><div><h3><ShoppingBag size={16}/> Novo pedido</h3><span>{cart.length} produto(s)</span></div><b>{money(cartTotal)}</b></div>
          {activeOrder && <div className="service-open-order"><div><ReceiptText size={15}/><b>Comanda aberta · #{activeOrder.order_number}</b></div>{activeOrder.order_items?.map(item => <div className="service-existing-item" key={item.id}><span>{item.quantity}× {item.name}{item.fraction_label ? ` · ${item.fraction_label}` : ''}</span><span>{money(item.line_total)}</span></div>)}<div className="service-existing-total"><span>Acumulado</span><b>{money(activeOrder.total)}</b></div></div>}
          <div className="service-cart-items">{cart.map(item => <article className="service-cart-item" key={item.key}><img className="service-cart-photo" src={productImageUrl(item.product.image_path) || undefined} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/><div><b>{item.product.name}{item.fraction ? ` · ${item.fraction.name}` : ''}</b><small>{money(item.fraction?.price ?? item.product.base_price)} cada</small><input value={item.notes} onChange={event => changeNote(item.key, event.target.value)} placeholder="Observação (opcional)" maxLength={300}/></div><div className="service-quantity"><button onClick={() => changeQuantity(item.key, -1)} aria-label="Diminuir"><Minus size={13}/></button><b>{item.quantity}</b><button onClick={() => changeQuantity(item.key, 1)} aria-label="Aumentar"><Plus size={13}/></button></div></article>)}{cart.length === 0 && <div className="service-cart-empty">Toque em um item para adicioná-lo ao pedido.</div>}</div>
          <form onSubmit={submitOrder} className="service-submit-form"><label>Observação do pedido<input value={orderNote} onChange={event => setOrderNote(event.target.value)} placeholder="Ex.: enviar primeiro as bebidas" maxLength={1000}/></label><button className="primary" disabled={sending || cart.length === 0}><Send size={15}/>{sending ? 'Enviando...' : activeOrder ? 'Adicionar à comanda' : 'Enviar para preparo'}</button>{activeOrder && <div className="service-bottom-actions"><button type="button" onClick={requestBill} disabled={sending}>Pedir conta</button><button type="button" onClick={closeOrder} disabled={sending}>Finalizar comanda</button></div>}</form>
        </aside>
      </div>}
    </section>
  </div>;
}

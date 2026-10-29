import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChefHat, Copy, CreditCard, Minus, Plus, QrCode, ReceiptText, RefreshCw, Send, ShoppingBag, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { QRCodeSVG } from 'qrcode.react';

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
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitMode, setSplitMode] = useState('equal');
  const [splitCount, setSplitCount] = useState(2);
  const [splitPeople, setSplitPeople] = useState([{ customer_label: 'Pessoa 1', customer_email: '' }, { customer_label: 'Pessoa 2', customer_email: '' }]);
  const [selectedSplitItems, setSelectedSplitItems] = useState({});
  const [splitPayments, setSplitPayments] = useState([]);
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitError, setSplitError] = useState('');

  const loadOrder = async () => {
    const { data, error: orderError } = await supabase
      .from('orders')
      .select('id,order_number,status,total,created_at,order_items(id,name,quantity,unit_price,line_total,fraction_label,status,notes)')
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
  useEffect(() => {
    if (!splitOpen || !splitPayments.some(split => split.status === 'aguardando' || split.status === 'pendente')) return;
    const timer = window.setInterval(async () => {
      const updated = await Promise.all(splitPayments.map(async split => {
        if (!split.token || split.status === 'pago' || split.status === 'falhou' || split.status === 'cancelado') return split;
        const { data } = await supabase.functions.invoke('create-split-pix', { body: { token: split.token, action: 'status' } });
        return data?.status ? { ...split, status: data.status } : split;
      }));
      setSplitPayments(updated);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [splitOpen, splitPayments]);

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

  const changeSplitCount = count => {
    const next = Math.min(20, Math.max(2, Number(count) || 2));
    setSplitCount(next);
    setSplitPeople(people => Array.from({ length: next }, (_, index) => people[index] || { customer_label: `Pessoa ${index + 1}`, customer_email: '' }));
  };
  const setPersonField = (index, field, value) => setSplitPeople(people => people.map((person, i) => i === index ? { ...person, [field]: value } : person));
  const generatePixForSplits = async (splits, suppliedEmails = null) => {
    const results = await Promise.all(splits.map(async (split, index) => {
      const payer_email = suppliedEmails?.[index] || split.customer_email;
      const { data, error: pixError } = await supabase.functions.invoke('create-split-pix', { body: { token: split.token, payer_email } });
      return { ...split, ...(data || {}), error: pixError?.message || data?.error || '' };
    }));
    setSplitPayments(results);
    const failures = results.filter(result => result.error);
    if (failures.length) setSplitError(`Pix gerado para ${results.length - failures.length} de ${results.length} partes. ${failures[0].error}`);
    else setSplitError('');
  };
  const createSplitPix = async event => {
    event.preventDefault();
    if (!activeOrder || splitLoading) return;
    setSplitLoading(true);
    setSplitError('');
    setSplitPayments([]);
    const definitions = splitMode === 'equal'
      ? splitPeople.map(person => ({ customer_label: person.customer_label.trim(), customer_email: person.customer_email.trim() }))
      : activeOrder.order_items.filter(item => selectedSplitItems[item.id]).map(item => ({ customer_label: selectedSplitItems[item.id].customer_label.trim() || item.name, customer_email: selectedSplitItems[item.id].customer_email.trim(), items: [{ item_id: item.id, quantity: Number(item.quantity) }] }));
    if (definitions.some(person => !person.customer_email || !person.customer_email.includes('@'))) {
      setSplitError('Informe um e-mail válido para cada pagador. O Mercado Pago exige o e-mail do comprador para criar o Pix.');
      setSplitLoading(false);
      return;
    }
    const { data, error: rpcError } = await supabase.rpc('create_order_splits', {
      p_order_id: activeOrder.id,
      p_mode: splitMode,
      p_people: splitMode === 'equal' ? splitCount : 0,
      p_definitions: definitions,
    });
    if (rpcError) {
      setSplitError(rpcError.message);
      setSplitLoading(false);
      return;
    }
    await generatePixForSplits(data || [], definitions.map(person => person.customer_email));
    setSplitLoading(false);
  };
  const retryPix = async split => {
    setSplitLoading(true);
    const { data, error: pixError } = await supabase.functions.invoke('create-split-pix', { body: { token: split.token, payer_email: split.customer_email } });
    setSplitPayments(current => current.map(item => item.id === split.id ? { ...item, ...(data || {}), error: pixError?.message || data?.error || '' } : item));
    if (pixError || data?.error) setSplitError(pixError?.message || data?.error);
    else setSplitError('');
    setSplitLoading(false);
  };
  const copyPix = async code => {
    try { await navigator.clipboard.writeText(code); setNotice('Código Pix copiado.'); }
    catch { setSplitError('Não foi possível copiar automaticamente. Selecione e copie o código Pix.'); }
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
          <form onSubmit={submitOrder} className="service-submit-form"><label>Observação do pedido<input value={orderNote} onChange={event => setOrderNote(event.target.value)} placeholder="Ex.: enviar primeiro as bebidas" maxLength={1000}/></label><button className="primary" disabled={sending || cart.length === 0}><Send size={15}/>{sending ? 'Enviando...' : activeOrder ? 'Adicionar à comanda' : 'Enviar para preparo'}</button>{activeOrder && <div className="service-bottom-actions"><button type="button" onClick={requestBill} disabled={sending}>Pedir conta</button><button type="button" className="service-split-action" onClick={() => { setSplitOpen(true); setSplitError(''); }} disabled={sending}><CreditCard size={14}/>Dividir conta / Pix</button><button type="button" onClick={closeOrder} disabled={sending}>Finalizar comanda</button></div>}</form>
        </aside>
      </div>}
    </section>
    {splitOpen && <div className="split-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !splitLoading) setSplitOpen(false); }}><section className="split-dialog" role="dialog" aria-modal="true" aria-labelledby="split-title">
      <header><div className="split-title-icon"><CreditCard size={20}/></div><div><h2 id="split-title">Dividir conta · Mesa {table.number}</h2><p>Comanda #{activeOrder?.order_number} · Total {money(activeOrder?.total)}</p></div><button type="button" onClick={() => setSplitOpen(false)} aria-label="Fechar"><X size={19}/></button></header>
      {!splitPayments.length ? <form onSubmit={createSplitPix} className="split-form">
        <div className="split-mode-tabs"><button type="button" className={splitMode === 'equal' ? 'active' : ''} onClick={() => setSplitMode('equal')}>Dividir por pessoas</button><button type="button" className={splitMode === 'items' ? 'active' : ''} onClick={() => setSplitMode('items')}>Selecionar itens</button></div>
        {splitMode === 'equal' ? <><label className="split-count-field">Quantidade de pessoas<input type="number" min="2" max="20" value={splitCount} onChange={event => changeSplitCount(event.target.value)}/></label><div className="split-people-list">{splitPeople.map((person, index) => <div className="split-person" key={index}><b>Pessoa {index + 1} · {money(Math.floor((Number(activeOrder?.total || 0) / splitCount) * 100) / 100 + (index === splitCount - 1 ? (Number(activeOrder?.total || 0) - Math.floor((Number(activeOrder?.total || 0) / splitCount) * 100) / 100 * (splitCount - 1)) : 0))}</b><div><input aria-label={`Nome da pessoa ${index + 1}`} placeholder={`Nome da pessoa ${index + 1}`} value={person.customer_label} onChange={event => setPersonField(index, 'customer_label', event.target.value)}/><input type="email" required aria-label={`E-mail da pessoa ${index + 1}`} placeholder="E-mail para o Pix" value={person.customer_email} onChange={event => setPersonField(index, 'customer_email', event.target.value)}/></div></div>)}</div></> : <div className="split-item-list">{(activeOrder?.order_items || []).filter(item => item.status !== 'cancelado').map(item => <label className="split-item-row" key={item.id}><input type="checkbox" checked={Boolean(selectedSplitItems[item.id])} onChange={event => setSelectedSplitItems(current => ({ ...current, [item.id]: event.target.checked ? { customer_label: item.name, customer_email: '' } : undefined }))}/><span><b>{item.quantity}× {item.name}</b><small>{money(item.line_total)} · {item.fraction_label || 'item'}</small></span>{selectedSplitItems[item.id] && <span className="split-item-fields"><input placeholder="Quem paga este item?" value={selectedSplitItems[item.id].customer_label} onChange={event => setSelectedSplitItems(current => ({ ...current, [item.id]: { ...current[item.id], customer_label: event.target.value } }))}/><input type="email" required placeholder="E-mail para o Pix" value={selectedSplitItems[item.id].customer_email} onChange={event => setSelectedSplitItems(current => ({ ...current, [item.id]: { ...current[item.id], customer_email: event.target.value } }))}/></span>}</label>)}<p className="split-help">Cada item selecionado vira uma cobrança Pix pelo valor correspondente. Itens não selecionados continuam na comanda.</p></div>}
        {splitError && <div className="split-error" role="alert">{splitError}</div>}<button className="split-create" disabled={splitLoading || (splitMode === 'items' && !Object.values(selectedSplitItems).some(Boolean))}><QrCode size={17}/>{splitLoading ? 'Gerando Pix individuais…' : 'Gerar QR Codes Pix'}</button><small className="split-secure-note">A chave do Mercado Pago fica protegida no Supabase. Cada pessoa recebe um Pix no valor da sua parte.</small>
      </form> : <div className="split-results">{splitError && <div className="split-error" role="alert">{splitError}</div>}{splitPayments.map((split, index) => <article className="split-result" key={split.id || index}><div className="split-result-copy"><b>{split.customer_label || `Pessoa ${index + 1}`}</b><strong>{money(split.amount)}</strong><span>{split.status === 'pago' ? 'Pix pago' : split.status === 'aguardando' ? 'Aguardando pagamento' : 'Pix pronto para pagar'}</span></div>{split.qr_code_base64 ? <img className="split-qr-image" src={`data:image/png;base64,${split.qr_code_base64}`} alt={`QR Code Pix de ${split.customer_label || `Pessoa ${index + 1}`}`}/> : split.qr_code ? <QRCodeSVG value={split.qr_code} size={150} level="M" includeMargin/> : <div className="split-qr-placeholder"><QrCode size={28}/><span>{split.error || 'QR indisponível'}</span></div>}{split.qr_code && <><button type="button" className="split-copy" onClick={() => copyPix(split.qr_code)}><Copy size={14}/>Copiar código Pix</button><textarea readOnly value={split.qr_code} aria-label="Código Pix copia e cola"/></>}{split.error && <button className="split-retry" type="button" onClick={() => retryPix(split)} disabled={splitLoading}>Tentar novamente</button>}</article>)}<button className="split-done" type="button" onClick={() => setSplitOpen(false)}>Concluir</button></div>}
    </section></div>}
  </div>;
}

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChefHat, CircleCheck, Clock3, CookingPot, PackageCheck, Send, ShoppingCart, Trash2, Utensils, X, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import QuantityControl from './QuantityControl';
import PizzaFlavorPicker from './PizzaFlavorPicker';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const productImageUrl = product => {
  if (product?.image_url?.trim()) return product.image_url.trim();
  return product?.image_path && supabase ? supabase.storage.from('product-images').getPublicUrl(product.image_path).data.publicUrl : '';
};
const orderStatusLabel = { pendente: 'Recebido pelo restaurante', em_preparo: 'Em preparo', pronto: 'Pronto para servir', entregue: 'Finalizado', cancelado: 'Cancelado' };
const orderStatusMeta = {
  pendente: { label: orderStatusLabel.pendente, tone: 'pending', icon: Clock3 },
  em_preparo: { label: orderStatusLabel.em_preparo, tone: 'preparing', icon: CookingPot },
  pronto: { label: orderStatusLabel.pronto, tone: 'ready', icon: PackageCheck },
  entregue: { label: orderStatusLabel.entregue, tone: 'done', icon: CircleCheck },
  cancelado: { label: orderStatusLabel.cancelado, tone: 'cancelled', icon: XCircle },
};
const getCustomerVisibleStatus = order => {
  const statuses = (order?.items || []).map(item => item.status).filter(status => status && status !== 'cancelado');
  if (!statuses.length) return order?.status;
  if (statuses.includes('pendente')) return 'pendente';
  if (statuses.includes('em_preparo')) return 'em_preparo';
  if (statuses.includes('pronto')) return 'pronto';
  if (statuses.every(status => status === 'entregue')) return 'entregue';
  return order?.status;
};

export default function PublicTableOrder({ qrToken }) {
  const storageKey = `cozinfood:public-table-order:${qrToken}`;
  const readSavedOrder = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; }
    catch { return {}; }
  };
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [cart, setCart] = useState(() => readSavedOrder().cart || []);
  const [customerName, setCustomerName] = useState(() => readSavedOrder().customerName || '');
  const [orderNote, setOrderNote] = useState(() => readSavedOrder().orderNote || '');
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(() => readSavedOrder().receipt || null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [cartVisible, setCartVisible] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [pizzaSelection, setPizzaSelection] = useState(null);

  const loadMenu = async () => {
    setLoading(true);
    setError('');
    if (!supabase) {
      setError('O cardápio ainda não está conectado ao Supabase. Avise o restaurante.');
      setLoading(false);
      return;
    }
    const { data, error: menuError } = await supabase.rpc('get_public_table_menu', { p_qr_token: qrToken });
    if (menuError) setError(`Não foi possível abrir o cardápio: ${menuError.message}`);
    else if (!data) setError('Este QR Code não é válido. Peça ajuda a um atendente.');
    else {
      setMenu(data);
      const { data: openOrder, error: openOrderError } = await supabase.rpc('get_public_table_open_order', { p_qr_token: qrToken });
      if (openOrder) {
        setReceipt({ order_id: openOrder.order_id, order_number: openOrder.order_number, total: openOrder.total, table_number: data.table_number });
        setLiveStatus(openOrder);
      } else if (!openOrderError) {
        // The previous comanda was closed; don't show its cached receipt to
        // the next customer opening this table's QR code.
        setReceipt(null);
        setLiveStatus(null);
      } else if (openOrderError) {
        // Keep the local fallback when the database recovery migration has not been applied yet.
        console.warn('Unable to recover the open table order:', openOrderError.message);
      }
    }
    setLoading(false);
  };

  useEffect(() => { loadMenu(); }, [qrToken]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ cart, customerName, orderNote, receipt }));
    } catch {
      setError('NÃ£o foi possÃ­vel salvar este pedido no navegador. Verifique o armazenamento do site.');
    }
  }, [storageKey, cart, customerName, orderNote, receipt]);
  useEffect(() => {
    if (!menu || cart.length === 0) return;
    const catalog = new Map((menu.categories || []).flatMap(category => category.products || []).map(product => [product.id, product]));
    setCart(current => {
      let changed = false;
      const hydrated = current.map(item => {
        const product = catalog.get(item.product?.id);
        if (!product || item.product === product) return item;
        changed = true;
        const fraction = item.fraction?.id ? product.fractions?.find(option => option.id === item.fraction.id) || item.fraction : null;
        return { ...item, product, fraction };
      });
      return changed ? hydrated : current;
    });
  }, [menu, cart.length]);
  useEffect(() => {
    if (!supabase || !receipt?.order_id) return undefined;
    let active = true;
    const refreshStatus = async () => {
      const { data } = await supabase.rpc('get_public_table_order_status', { p_qr_token: qrToken, p_order_id: receipt.order_id });
      if (active && data) setLiveStatus(data);
    };
    refreshStatus();
    const channel = supabase
      .channel(`qr-order:${qrToken}`, { config: { private: false } })
      .on('broadcast', { event: 'order_status_updated' }, message => {
        if (message.payload?.order_id === receipt.order_id) refreshStatus();
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') refreshStatus();
      });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshStatus();
    };
    const timer = window.setInterval(refreshStatus, 4000);
    window.addEventListener('focus', refreshStatus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshStatus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [qrToken, receipt?.order_id]);

  const allProducts = useMemo(() => (menu?.categories || []).flatMap(category => (category.products || []).map(product => ({
    ...product,
    categories: { ...(product.categories || {}), name: category.name, slug: category.slug },
  }))), [menu]);
  const products = useMemo(() => allProducts.filter(product => categoryId === 'all' || product.categories?.slug === menu?.categories?.find(category => category.id === categoryId)?.slug), [allProducts, menu, categoryId]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.quantity * Number(item.unitPrice ?? item.fraction?.price ?? item.product.base_price), 0), [cart]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    const cartElement = document.getElementById('qr-cart');
    if (!cartElement || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => setCartVisible(entry.isIntersecting), { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
    observer.observe(cartElement);
    return () => observer.disconnect();
  }, [menu, cartCount]);

  const itemKey = (product, fraction = null) => `${product.id}:${fraction?.id || 'base'}`;
  const quantityFor = (product, fraction = null) => cart.find(item => item.key === itemKey(product, fraction))?.quantity || 0;
  const setItemQuantity = (product, fraction, quantity) => {
    const key = itemKey(product, fraction);
    setCart(items => {
      const existing = items.some(item => item.key === key);
      if (quantity <= 0) return items.filter(item => item.key !== key);
      return existing
        ? items.map(item => item.key === key ? { ...item, quantity } : item)
        : [...items, { key, product, fraction, quantity, notes: '' }];
    });
  };
  const changeQuantity = (key, quantity) => setCart(items => quantity <= 0
    ? items.filter(item => item.key !== key)
    : items.map(item => item.key === key ? { ...item, quantity } : item));
  const addPizzaSelection = selection => {
    const flavorKey = selection.flavors.map(item => item.product.id).sort().join(',');
    const key = `${selection.product.id}:${selection.fraction.id}:flavors:${flavorKey}`;
    setCart(items => {
      const existing = items.find(item => item.key === key);
      return existing
        ? items.map(item => item.key === key ? { ...item, quantity: item.quantity + 1 } : item)
        : [...items, { ...selection, key, quantity: 1, notes: '' }];
    });
    setPizzaSelection(null);
  };
  const removeItem = key => setCart(items => items.filter(item => item.key !== key));
  const changeNote = (key, notes) => setCart(items => items.map(item => item.key === key ? { ...item, notes } : item));

  const submitOrder = async event => {
    event.preventDefault();
    if (!cart.length) return;
    setSending(true);
    setError('');
    const { data, error: submitError } = await supabase.rpc('submit_table_order', {
      p_qr_token: qrToken,
      p_customer_name: customerName,
      p_items: cart.map(item => ({ product_id: item.product.id, fraction_id: item.flavors?.length ? null : item.fraction?.id || null, quantity: item.quantity, notes: item.notes,
        flavors: (item.flavors || []).map(flavor => ({ product_id: flavor.product.id, product_fraction_id: flavor.fraction.id, fraction: flavor.share })) })),
      p_notes: orderNote,
    });
    if (submitError) setError(`Não foi possível enviar. ${submitError.message}`);
    else {
      const savedReceipt = { ...data, table_number: menu?.table_number ?? data.table_number };
      try {
        localStorage.setItem(storageKey, JSON.stringify({ cart: [], customerName, orderNote: '', receipt: savedReceipt }));
      } catch {
        setError('O pedido foi enviado, mas não foi possível salvá-lo neste navegador.');
      }
      setReceipt(savedReceipt);
      setLiveStatus(null);
      setCart([]);
      setOrderNote('');
    }
    setSending(false);
  };

  if (loading) return <main className="qr-order-page"><div className="qr-loading"><span className="auth-spinner"/> Abrindo cardápio...</div></main>;

  return <main className="qr-order-page"><header className="qr-order-header"><div className="qr-brand"><span><ChefHat size={21}/></span><div><b>{menu?.restaurant_name || 'COZINFOOD'}</b><small>Cardápio digital</small></div></div>{menu && <div className="qr-table-badge"><Utensils size={15}/> Mesa {menu.table_number}</div>}</header>
    {error && !menu ? <section className="qr-error"><h1>Não conseguimos abrir este cardápio</h1><p>{error}</p><button className="primary" onClick={loadMenu}>Tentar novamente</button></section> : menu && <>
      <section className="qr-welcome"><span>SEJA BEM-VINDO</span><h1>Faça seu pedido à mesa</h1><p>Escolha os itens. A equipe recebe seu pedido na hora.</p></section>
      {error && <div className="qr-inline-error" role="alert">{error}</div>}
      {receipt && (() => {
        const progressStatus = getCustomerVisibleStatus(liveStatus);
        const current = orderStatusMeta[progressStatus] || { label: 'Aguardando confirmação da cozinha', tone: 'pending', icon: Clock3 };
        const CurrentIcon = current.icon;
        return <section className={`qr-receipt status-${current.tone}`} aria-live="polite">
          <div className="qr-receipt-heading"><span className="qr-receipt-success-icon"><CheckCircle2 size={22}/></span><div><b>Pedido #{receipt.order_number} enviado</b><span>Mesa {menu.table_number} · Acompanhe o preparo abaixo</span></div></div>
          <div className={`qr-order-status ${current.tone}`}><CurrentIcon size={25}/><span><small>STATUS DO PEDIDO</small><b>{current.label}</b></span></div>
          <strong className="qr-receipt-total">Total do pedido <span>{money(liveStatus?.total ?? receipt.total)}</span></strong>
          {liveStatus?.items?.length > 0 && <ul>{liveStatus.items.map((item,index) => {
            const itemMeta = orderStatusMeta[item.status] || { label: item.status || 'Aguardando', tone: 'pending', icon: Clock3 };
            const ItemIcon = itemMeta.icon;
            return <li key={`${item.name}-${index}`}><span className="qr-receipt-item-name">{item.quantity}× {item.name}{item.fraction_label ? ` · ${item.fraction_label}` : ''}</span><small className={`qr-item-status ${itemMeta.tone}`}><ItemIcon size={14}/>{itemMeta.label}</small></li>;
          })}</ul>}
          <button onClick={() => { setReceipt(null); setLiveStatus(null); }}>Fazer outro pedido</button>
        </section>;
      })()}
      {menu.table_status === 'reservada' ? <div className="qr-inline-error">Esta mesa está reservada. Chame um atendente para fazer o pedido.</div> : <div className="qr-order-layout"><section className="qr-menu-section" id="qr-menu"><nav className="qr-category-list"><button className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>Tudo</button>{menu.categories.map(category => <button className={categoryId === category.id ? 'active' : ''} onClick={() => setCategoryId(category.id)} key={category.id}>{category.name}</button>)}</nav><div className="qr-products">{products.map(product => { const imageUrl = productImageUrl(product); return <article className="qr-product-card" key={product.id}>{imageUrl && <button type="button" className="qr-product-photo-button" onClick={event => { event.preventDefault(); event.stopPropagation(); setImagePreview({ name: product.name, url: imageUrl }); }} aria-label={`Ampliar foto de ${product.name}`}><img className="qr-product-photo" src={imageUrl} alt={product.name} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/></button>}<div className="qr-product-copy"><b>{product.name}</b><p>{product.description || product.categories?.name || ''}</p></div>{product.fractions?.length ? <div className="qr-product-fractions">{product.fractions.map(fraction => <div className={`qr-product-fraction-option ${product.categories?.slug === 'pizzas' && menu?.pizza_flavors_enabled ? 'is-pizza-option' : ''}`} key={fraction.id}><span>{fraction.name}{fraction.serves > 1 ? ` · serve ${fraction.serves}` : ''}</span><b>{money(fraction.price)}</b>{product.categories?.slug === 'pizzas' && menu?.pizza_flavors_enabled ? <button type="button" className="qr-pizza-config-button" onClick={() => setPizzaSelection({ product, fraction })}>Escolher sabores</button> : <QuantityControl compact label={`${product.name} ${fraction.name}`} value={quantityFor(product, fraction)} onChange={quantity => setItemQuantity(product, fraction, quantity)}/>}</div>)}</div> : <div className="qr-product-add"><b>{money(product.base_price)}</b><QuantityControl compact label={product.name} value={quantityFor(product)} onChange={quantity => setItemQuantity(product, null, quantity)}/></div>}</article>; })}{products.length === 0 && <div className="qr-empty">Ainda não há itens nesta categoria.</div>}</div></section>
        <aside className="qr-cart" id="qr-cart">
          <header className="qr-cart-header">
            <div><span className="qr-cart-title"><ShoppingCart size={19}/> Seu pedido</span><small>Confira os itens antes de enviar</small></div>
            <span className="qr-cart-count">{cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
          </header>
          <div className="qr-cart-items">
            {cart.length ? cart.map(item => {
              const unitPrice = Number(item.unitPrice ?? item.fraction?.price ?? item.product.base_price);
              const imageUrl = productImageUrl(item.product);
              return <article className="qr-cart-item" key={item.key}>
                {imageUrl ? <img className="qr-cart-photo" src={imageUrl} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/> : <span className="qr-cart-item-photo-placeholder"><ShoppingCart size={18}/></span>}
                <div className="qr-cart-item-content">
                  <div className="qr-cart-item-heading"><b>{item.flavors?.length ? item.flavors.map(flavor => flavor.product.name).join(' / ') : item.product.name}</b><button type="button" className="qr-cart-remove" onClick={() => removeItem(item.key)} aria-label="Remover item" title="Remover item"><Trash2 size={16}/></button></div>
                  {item.fraction && <span className="qr-cart-item-variant">{item.flavors?.length ? item.fractionLabel : `Tamanho · ${item.fraction.name}`}</span>}
                  <div className="qr-cart-item-pricing"><span>{money(unitPrice)} <small>cada</small></span><strong>{money(unitPrice * item.quantity)}</strong></div>
                  <div className="qr-cart-item-bottom">
                    <QuantityControl label={item.product.name} value={item.quantity} onChange={quantity => changeQuantity(item.key, quantity)}/>
                    <label className="qr-cart-item-note"><span>Observa&ccedil;&atilde;o deste item</span><input value={item.notes} onChange={event => changeNote(item.key, event.target.value)} placeholder="Ex.: sem cebola" maxLength={300}/></label>
                  </div>
                </div>
              </article>;
            }) : <div className="qr-cart-empty"><span><ShoppingCart size={23}/></span><b>Seu pedido est&aacute; vazio</b><p>Adicione pizzas, bebidas ou outros itens para continuar.</p><button type="button" onClick={() => document.getElementById('qr-menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Ver card&aacute;pio</button></div>}
          </div>
          <form onSubmit={submitOrder}>
            <div className="qr-cart-details-title"><b>Detalhes para a equipe</b><span>Opcional</span></div>
            <label>Seu nome<input value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Como podemos chamar voc&ecirc;?" maxLength={80}/></label>
            <label>Observa&ccedil;&atilde;o geral<input value={orderNote} onChange={event => setOrderNote(event.target.value)} placeholder="Ex.: trazer guardanapos" maxLength={1000}/></label>
            <div className="qr-cart-total"><span>Total do pedido</span><b>{money(cartTotal)}</b></div>
            <button className="primary" disabled={sending || cart.length === 0}><Send size={17}/>{sending ? 'Enviando...' : 'Enviar pedido'}</button>
            <small>O pagamento ser&aacute; feito com a equipe do restaurante.</small>
          </form>
        </aside></div>}
      {!cartVisible && menu.table_status !== 'reservada' && <button type="button" className="qr-mobile-cart-button" onClick={() => document.getElementById('qr-cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label="Abrir meu pedido"><ShoppingCart size={20}/><span>Meu pedido</span><b>{cartCount}</b><strong>{money(cartTotal)}</strong></button>}
    </>}
    {pizzaSelection && <PizzaFlavorPicker products={allProducts} product={pizzaSelection.product} fraction={pizzaSelection.fraction} fractionPricing={menu?.fraction_pricing} onCancel={() => setPizzaSelection(null)} onConfirm={addPizzaSelection}/>}
    {imagePreview && <div className="public-product-image-preview-layer" onMouseDown={event => { if (event.target === event.currentTarget) setImagePreview(null); }}><section className="public-product-image-preview" role="dialog" aria-modal="true" aria-label={`Foto de ${imagePreview.name}`}><button type="button" className="public-product-image-preview-close" onClick={() => setImagePreview(null)} aria-label="Fechar foto"><X size={20}/></button><img src={imagePreview.url} alt={imagePreview.name}/><h2>{imagePreview.name}</h2></section></div>}
    <footer className="qr-order-footer">COZINFOOD · Atendimento digital à mesa</footer>
  </main>;
}

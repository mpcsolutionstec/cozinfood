import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChefHat, CircleCheck, Clock3, CookingPot, Minus, PackageCheck, Plus, Send, ShoppingCart, Trash2, Utensils, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const productImageUrl = imagePath => imagePath ? supabase.storage.from('product-images').getPublicUrl(imagePath).data.publicUrl : '';
const orderStatusLabel = { pendente: 'Recebido pelo restaurante', em_preparo: 'Em preparo', pronto: 'Pronto para servir', entregue: 'Finalizado', cancelado: 'Cancelado' };
const orderStatusMeta = {
  pendente: { label: orderStatusLabel.pendente, tone: 'pending', icon: Clock3 },
  em_preparo: { label: orderStatusLabel.em_preparo, tone: 'preparing', icon: CookingPot },
  pronto: { label: orderStatusLabel.pronto, tone: 'ready', icon: PackageCheck },
  entregue: { label: orderStatusLabel.entregue, tone: 'done', icon: CircleCheck },
  cancelado: { label: orderStatusLabel.cancelado, tone: 'cancelled', icon: XCircle },
};

export default function PublicTableOrder({ qrToken }) {
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [cartVisible, setCartVisible] = useState(false);

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
    else setMenu(data);
    setLoading(false);
  };

  useEffect(() => { loadMenu(); }, [qrToken]);
  useEffect(() => {
    if (!receipt?.order_id) return undefined;
    let active = true;
    const refreshStatus = async () => {
      const { data } = await supabase.rpc('get_public_table_order_status', { p_qr_token: qrToken, p_order_id: receipt.order_id });
      if (active && data) setLiveStatus(data);
    };
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, [qrToken, receipt?.order_id]);

  const products = useMemo(() => (menu?.categories || []).filter(category => categoryId === 'all' || category.id === categoryId).flatMap(category => category.products || []), [menu, categoryId]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.quantity * Number(item.fraction?.price ?? item.product.base_price), 0), [cart]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    const cartElement = document.getElementById('qr-cart');
    if (!cartElement || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => setCartVisible(entry.isIntersecting), { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
    observer.observe(cartElement);
    return () => observer.disconnect();
  }, [menu, cartCount]);

  const addProduct = (product, fraction = null) => {
    const key = `${product.id}:${fraction?.id || 'base'}`;
    setCart(items => {
      const existing = items.find(item => item.key === key);
      if (existing) return items.map(item => item.key === key ? { ...item, quantity: item.quantity + 1 } : item);
      return [...items, { key, product, fraction, quantity: 1, notes: '' }];
    });
  };
  const changeQuantity = (key, amount) => setCart(items => items.map(item => item.key === key ? { ...item, quantity: Math.max(0, item.quantity + amount) } : item).filter(item => item.quantity > 0));
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
      p_items: cart.map(item => ({ product_id: item.product.id, fraction_id: item.fraction?.id || null, quantity: item.quantity, notes: item.notes })),
      p_notes: orderNote,
    });
    if (submitError) setError(`Não foi possível enviar. ${submitError.message}`);
    else {
      setReceipt(data);
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
        const current = orderStatusMeta[liveStatus?.status] || { label: 'Aguardando confirmação da cozinha', tone: 'pending', icon: Clock3 };
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
      {menu.table_status === 'reservada' ? <div className="qr-inline-error">Esta mesa está reservada. Chame um atendente para fazer o pedido.</div> : <div className="qr-order-layout"><section className="qr-menu-section" id="qr-menu"><nav className="qr-category-list"><button className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>Tudo</button>{menu.categories.map(category => <button className={categoryId === category.id ? 'active' : ''} onClick={() => setCategoryId(category.id)} key={category.id}>{category.name}</button>)}</nav><div className="qr-products">{products.map(product => <article className="qr-product-card" key={product.id}><img className="qr-product-photo" src={productImageUrl(product.image_path) || undefined} alt={product.name} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/><div className="qr-product-copy"><b>{product.name}</b><p>{product.description || product.categories?.name || ''}</p></div>{product.fractions?.length ? <div className="qr-product-fractions">{product.fractions.map(fraction => <button key={fraction.id} onClick={() => addProduct(product, fraction)}><span>{fraction.name}{fraction.serves > 1 ? ` · serve ${fraction.serves}` : ''}</span><b>{money(fraction.price)} <Plus size={13}/></b></button>)}</div> : <button className="qr-product-add" onClick={() => addProduct(product)}><b>{money(product.base_price)}</b><span><Plus size={16}/></span></button>}</article>)}{products.length === 0 && <div className="qr-empty">Ainda não há itens nesta categoria.</div>}</div></section>
        <aside className="qr-cart" id="qr-cart">
          <header className="qr-cart-header">
            <div><span className="qr-cart-title"><ShoppingCart size={19}/> Seu pedido</span><small>Confira os itens antes de enviar</small></div>
            <span className="qr-cart-count">{cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
          </header>
          <div className="qr-cart-items">
            {cart.length ? cart.map(item => {
              const unitPrice = Number(item.fraction?.price ?? item.product.base_price);
              const imageUrl = productImageUrl(item.product.image_path);
              return <article className="qr-cart-item" key={item.key}>
                {imageUrl ? <img className="qr-cart-photo" src={imageUrl} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/> : <span className="qr-cart-item-photo-placeholder"><ShoppingCart size={18}/></span>}
                <div className="qr-cart-item-content">
                  <div className="qr-cart-item-heading"><b>{item.product.name}</b><button type="button" className="qr-cart-remove" onClick={() => removeItem(item.key)} aria-label="Remover item" title="Remover item"><Trash2 size={16}/></button></div>
                  {item.fraction && <span className="qr-cart-item-variant">Tamanho &middot; {item.fraction.name}</span>}
                  <div className="qr-cart-item-pricing"><span>{money(unitPrice)} <small>cada</small></span><strong>{money(unitPrice * item.quantity)}</strong></div>
                  <div className="qr-cart-item-bottom">
                    <div className="qr-quantity"><button type="button" onClick={() => changeQuantity(item.key, -1)} aria-label="Diminuir quantidade"><Minus size={14}/></button><b>{item.quantity}</b><button type="button" onClick={() => changeQuantity(item.key, 1)} aria-label="Aumentar quantidade"><Plus size={14}/></button></div>
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
    <footer className="qr-order-footer">COZINFOOD · Atendimento digital à mesa</footer>
  </main>;
}

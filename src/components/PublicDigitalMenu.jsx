import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChefHat, ChevronDown, Clock3, Search, ShoppingCart, Sparkles, Utensils, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import QuantityControl from './QuantityControl';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const productImageUrl = product => {
  if (product?.image_url?.trim()) return product.image_url.trim();
  return product?.image_path && supabase ? supabase.storage.from('product-images').getPublicUrl(product.image_path).data.publicUrl : '';
};

export default function PublicDigitalMenu({ slug }) {
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!supabase) {
        setError('Este cardápio ainda não está conectado. Tente novamente mais tarde.');
        setLoading(false);
        return;
      }
      const { data, error: loadError } = await supabase.rpc('get_public_digital_menu', { p_slug: slug });
      if (!alive) return;
      if (loadError) setError(`Não foi possível abrir o cardápio: ${loadError.message}`);
      else if (!data) setError('Este cardápio não está disponível. Confira o link ou fale com o restaurante.');
      else setMenu(data);
      setLoading(false);
    };
    load();
    return () => { alive = false; };
  }, [slug]);

  const visibleProducts = useMemo(() => (menu?.categories || [])
    .filter(item => category === 'all' || item.id === category)
    .flatMap(item => item.products || [])
    .filter(item => item.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [menu, category, search]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.quantity * Number(item.fraction?.price ?? item.product.base_price), 0);

  const itemKey = (product, fraction = null) => `${product.id}:${fraction?.id || 'base'}`;
  const quantityFor = (product, fraction = null) => cart.find(item => item.key === itemKey(product, fraction))?.quantity || 0;
  const setItemQuantity = (product, fraction, quantity) => {
    const key = itemKey(product, fraction);
    setCart(items => {
      const existing = items.some(item => item.key === key);
      if (quantity <= 0) return items.filter(item => item.key !== key);
      return existing
        ? items.map(item => item.key === key ? { ...item, quantity } : item)
        : [...items, { key, product, fraction, quantity }];
    });
  };
  const updateQuantity = (key, quantity) => setCart(items => quantity <= 0
    ? items.filter(item => item.key !== key)
    : items.map(item => item.key === key ? { ...item, quantity } : item));

  const submitOrder = async event => {
    event.preventDefault();
    if (!cart.length) return;
    setSending(true);
    setError('');
    const { data, error: submitError } = await supabase.rpc('submit_digital_menu_order', {
      p_slug: slug,
      p_customer_name: customer.name.trim(),
      p_customer_phone: customer.phone.replace(/\D/g, ''),
      p_items: cart.map(item => ({ product_id: item.product.id, fraction_id: item.fraction?.id || null, quantity: item.quantity })),
      p_notes: notes.trim(),
      p_request_id: crypto.randomUUID(),
    });
    if (submitError) setError(`Não foi possível enviar o pedido: ${submitError.message}`);
    else {
      setReceipt(data);
      setCart([]);
      setNotes('');
      setCartOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setSending(false);
  };

  if (loading) return <main className="digital-public"><div className="digital-loading"><span className="auth-spinner"/> Abrindo o cardápio...</div></main>;
  if (error && !menu) return <main className="digital-public"><section className="digital-unavailable"><span className="digital-brand-mark"><ChefHat size={23}/></span><h1>Cardápio temporariamente indisponível</h1><p>{error}</p><button onClick={() => window.location.reload()}>Tentar novamente</button></section></main>;

  return <main className="digital-public">
    <header className="digital-public-header"><a className="digital-logo" href="#top"><span><ChefHat size={20}/></span><b>{menu.restaurant_name}</b></a><div className="digital-header-status"><i/> Aberto para pedidos</div><button className="digital-cart-top" onClick={() => setCartOpen(true)}><ShoppingCart size={17}/> <span>Meu pedido</span><b>{cartCount}</b></button></header>

    <section className="digital-hero" id="top"><div className="digital-hero-copy"><span className="digital-overline"><Sparkles size={13}/> FEITO NA HORA, COM CARINHO</span><h1>O sabor que você ama,<br/><em>do seu jeito.</em></h1><p>{menu.description || 'Explore nosso cardápio e escolha seus favoritos. Preparamos cada pedido com ingredientes selecionados.'}</p><a href="#menu" className="digital-explore">Explorar cardápio <ArrowRight size={15}/></a><div className="digital-proof"><span><CheckCircle2 size={14}/> Ingredientes selecionados</span><span><Clock3 size={14}/> Retirada no restaurante</span></div></div><div className="digital-hero-visual" aria-hidden="true"><div className="digital-blob"/><div className="digital-plate"><div className="digital-pizza"><i/><i/><i/><i/><i/><i/></div></div><div className="digital-food-note">feito na hora <Sparkles size={13}/></div><div className="digital-floating-leaf">✦</div></div></section>

    {receipt && <section className="digital-confirmation" role="status"><span><CheckCircle2 size={21}/></span><div><b>Pedido recebido! Nº {receipt.order_number}</b><p>{customer.name}, seu pedido foi enviado para o restaurante. O pagamento será feito na retirada.</p></div><strong>{money(receipt.total)}</strong><button onClick={() => setReceipt(null)} aria-label="Fechar"><X size={17}/></button></section>}
    {error && menu && <div className="digital-error">{error}<button onClick={() => setError('')}>Fechar</button></div>}

    <section className="digital-menu-section" id="menu"><div className="digital-section-heading"><div><span className="digital-overline">NOSSO CARDÁPIO</span><h2>Escolha seus favoritos</h2><p>Preparados com cuidado, para deixar seu dia mais gostoso.</p></div><label className="digital-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar no cardápio"/></label></div>
      <div className="digital-menu-content"><nav className="digital-category-nav"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Todos</button>{menu.categories.map(item => <button className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)} key={item.id}>{item.name}</button>)}</nav>
        <div className="digital-catalog-grid">{visibleProducts.map((product, index) => { const imageUrl = productImageUrl(product); return <article className="digital-product-card" key={product.id}><div className={`digital-product-art product-art-${index % 6} ${imageUrl ? 'has-product-photo' : ''}`} aria-hidden="true">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }}/> : <><span>{product.categories?.name?.slice(0, 1) || '✦'}</span><i>✦</i><i>✦</i><i>✦</i></>}</div><div className="digital-product-body"><div className="digital-product-title"><div><small>{product.categories?.name || 'Especialidade'}</small><h3>{product.name}</h3></div><span className="digital-rating">★ 4,9</span></div><p>{product.description || 'Uma das especialidades da casa, preparada na hora.'}</p>{product.fractions?.length ? <div className="digital-size-options">{product.fractions.map(fraction => <div className="digital-size-option" key={fraction.id}><span>{fraction.name}</span><b>{money(fraction.price)}</b><QuantityControl compact label={`${product.name} ${fraction.name}`} value={quantityFor(product, fraction)} onChange={quantity => setItemQuantity(product, fraction, quantity)}/></div>)}</div> : <div className="digital-add-product"><span>A partir de <b>{money(product.base_price)}</b></span><QuantityControl compact label={product.name} value={quantityFor(product)} onChange={quantity => setItemQuantity(product, null, quantity)}/></div>}</div></article>; })}{visibleProducts.length === 0 && <div className="digital-no-products"><Search size={20}/><b>Nenhum item encontrado</b><span>Tente outra busca ou escolha outra categoria.</span></div>}</div>
      </div>
    </section>
    <footer className="digital-public-footer"><a className="digital-logo" href="#top"><span><ChefHat size={17}/></span><b>{menu.restaurant_name}</b></a><span>Cardápio digital · COZINFOOD</span></footer>

    <button className="digital-mobile-cart" onClick={() => setCartOpen(true)}><ShoppingCart size={17}/><span>Ver pedido</span><b>{cartCount}</b><strong>{money(cartTotal)}</strong></button>
    {cartOpen && <div className="digital-cart-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCartOpen(false); }}><aside className="digital-cart-panel"><header><div><span className="digital-overline">SEU PEDIDO</span><h2>Quase lá!</h2></div><button onClick={() => setCartOpen(false)} aria-label="Fechar carrinho"><X size={19}/></button></header><div className="digital-cart-items">{cart.length ? cart.map(item => <article key={item.key}><img className="digital-cart-photo" src={productImageUrl(item.product) || undefined} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/> <div><b>{item.product.name}{item.fraction ? ` · ${item.fraction.name}` : ''}</b><span>{money(item.fraction?.price ?? item.product.base_price)} cada</span></div><QuantityControl label={item.product.name} value={item.quantity} onChange={quantity => updateQuantity(item.key, quantity)}/></article>) : <div className="digital-cart-empty"><ShoppingCart size={23}/><b>Seu carrinho está vazio</b><span>Adicione algo gostoso do cardápio.</span></div>}</div><form className="digital-checkout" onSubmit={submitOrder}><label>Seu nome<input required maxLength={80} value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} placeholder="Como podemos chamar você?"/></label><label>Telefone<input required type="tel" inputMode="tel" maxLength={20} value={customer.phone} onChange={event => setCustomer({ ...customer, phone: event.target.value })} placeholder="(11) 99999-9999"/></label><label>Observação <span>(opcional)</span><textarea maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Alguma preferência para seu pedido?"/></label><div className="digital-total"><span>Total</span><b>{money(cartTotal)}</b></div><button className="digital-submit" disabled={sending || !cart.length}>{sending ? 'Enviando pedido...' : 'Confirmar pedido'} <ArrowRight size={16}/></button><small>Retire no restaurante e pague no local.</small></form></aside></div>}
  </main>;
}

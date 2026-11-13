import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, Clock3, Search, ShoppingCart, Sparkles, Utensils, X } from 'lucide-react';
import { BRAND_LOGO } from '../branding';
import { supabase } from '../lib/supabaseClient';
import QuantityControl from './QuantityControl';
import PizzaFlavorPicker from './PizzaFlavorPicker';

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
  const [pizzaSelection, setPizzaSelection] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

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

  const allProducts = useMemo(() => (menu?.categories || []).flatMap(item => (item.products || []).map(product => ({
    ...product,
    categories: { ...(product.categories || {}), name: item.name, slug: item.slug },
  }))), [menu]);
  const visibleProducts = useMemo(() => allProducts
    .filter(item => category === 'all' || item.categories?.slug === menu?.categories?.find(entry => entry.id === category)?.slug)
    .filter(item => item.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [allProducts, menu, category, search]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.quantity * Number(item.unitPrice ?? item.fraction?.price ?? item.product.base_price), 0);

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
  const updateItemNote = (key, itemNote) => setCart(items => items.map(item => item.key === key ? { ...item, notes: itemNote } : item));

  const addPizzaSelection = selection => {
    const flavorKey = selection.flavors.map(item => item.product.id).sort().join(',');
    const borderKey = selection.border?.id || 'no-border';
    const additionKey = selection.additions.map(item => item.id).sort().join(',') || 'no-additions';
    const key = `${selection.product.id}:${selection.fraction.id}:flavors:${flavorKey}:border:${borderKey}:additions:${additionKey}`;
    setCart(items => {
      const existing = items.find(item => item.key === key);
      return existing
        ? items.map(item => item.key === key ? { ...item, quantity: item.quantity + 1 } : item)
        : [...items, { ...selection, key, quantity: 1 }];
    });
    setPizzaSelection(null);
  };

  const submitOrder = async event => {
    event.preventDefault();
    if (!cart.length) return;
    setSending(true);
    setError('');
    const { data, error: submitError } = await supabase.rpc('submit_digital_menu_order', {
      p_slug: slug,
      p_customer_name: customer.name.trim(),
      p_customer_phone: customer.phone.replace(/\D/g, ''),
      p_items: cart.map(item => ({ product_id: item.product.id, fraction_id: item.flavors?.length ? null : item.fraction?.id || null, quantity: item.quantity, notes: item.notes || '',
        border_id: item.border?.id || null, additions: (item.additions || []).map(addition => ({ id: addition.id, quantity: addition.quantity || 1 })),
        flavors: (item.flavors || []).map(flavor => ({ product_id: flavor.product.id, product_fraction_id: flavor.fraction.id, fraction: flavor.share })) })),
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
  if (error && !menu) return <main className="digital-public"><section className="digital-unavailable"><span className="digital-brand-mark"><img src={BRAND_LOGO} alt="Logo COZINFOOD"/></span><h1>Cardápio temporariamente indisponível</h1><p>{error}</p><button onClick={() => window.location.reload()}>Tentar novamente</button></section></main>;

  return <main className="digital-public">
    <header className="digital-public-header"><a className="digital-logo" href="#top"><img className="digital-logo-image" src={BRAND_LOGO} alt=""/><b>{menu.restaurant_name}</b></a><div className="digital-header-status"><i/> Aberto para pedidos</div><button className="digital-cart-top" onClick={() => setCartOpen(true)}><ShoppingCart size={17}/> <span>Meu pedido</span><b>{cartCount}</b></button></header>

    <section className="digital-hero" id="top"><div className="digital-hero-copy"><span className="digital-overline"><Sparkles size={13}/> FEITO NA HORA, COM CARINHO</span><h1>O sabor que você ama,<br/><em>do seu jeito.</em></h1><p>{menu.description || 'Explore nosso cardápio e escolha seus favoritos. Preparamos cada pedido com ingredientes selecionados.'}</p><a href="#menu" className="digital-explore">Explorar cardápio <ArrowRight size={15}/></a><div className="digital-proof"><span><CheckCircle2 size={14}/> Ingredientes selecionados</span><span><Clock3 size={14}/> Retirada no restaurante</span></div></div><div className="digital-hero-visual" aria-hidden="true"><div className="digital-blob"/><div className="digital-plate"><div className="digital-pizza"><i/><i/><i/><i/><i/><i/></div></div><div className="digital-food-note">feito na hora <Sparkles size={13}/></div><div className="digital-floating-leaf">✦</div></div></section>

    {receipt && <section className="digital-confirmation" role="status"><span><CheckCircle2 size={21}/></span><div><b>Pedido recebido! Nº {receipt.order_number}</b><p>{customer.name}, seu pedido foi enviado para o restaurante. O pagamento será feito na retirada.</p></div><strong>{money(receipt.total)}</strong><button onClick={() => setReceipt(null)} aria-label="Fechar"><X size={17}/></button></section>}
    {error && menu && <div className="digital-error">{error}<button onClick={() => setError('')}>Fechar</button></div>}

    <section className="digital-menu-section" id="menu"><div className="digital-section-heading"><div><span className="digital-overline">NOSSO CARDÁPIO</span><h2>Escolha seus favoritos</h2><p>Preparados com cuidado, para deixar seu dia mais gostoso.</p></div><label className="digital-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar no cardápio"/></label></div>
      <div className="digital-menu-content"><nav className="digital-category-nav"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Todos</button>{menu.categories.map(item => <button className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)} key={item.id}>{item.name}</button>)}</nav>
        <div className="digital-catalog-grid">{visibleProducts.map((product, index) => { const imageUrl = productImageUrl(product); return <article className="digital-product-card" key={product.id}>
          {imageUrl ? <button type="button" className={`digital-product-art digital-photo-trigger product-art-${index % 6} has-product-photo`} aria-label={`Ampliar foto de ${product.name}`} onClick={event => { event.preventDefault(); event.stopPropagation(); setImagePreview({ name: product.name, url: imageUrl }); }}><img src={imageUrl} alt={product.name} loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }}/></button> : <div className={`digital-product-art product-art-${index % 6}`} aria-hidden="true"><span>{product.categories?.name?.slice(0, 1) || '✦'}</span><i>✦</i><i>✦</i><i>✦</i></div>}
          <div className="digital-product-body"><div className="digital-product-title"><div><small>{product.categories?.name || 'Especialidade'}</small><h3>{product.name}</h3></div><span className="digital-rating">★ 4,9</span></div><p>{product.description || 'Uma das especialidades da casa, preparada na hora.'}</p>
            {product.fractions?.length ? <div className={`digital-size-options ${product.categories?.slug === 'pizzas' && menu?.pizza_flavors_enabled ? 'digital-pizza-sizes' : ''}`}>{product.fractions.map(fraction => <div className={`digital-size-option ${product.categories?.slug === 'pizzas' && menu?.pizza_flavors_enabled ? 'is-pizza-option' : ''}`} key={fraction.id}>
              <span>{fraction.name}</span><b>{money(fraction.price)}</b>
              {product.categories?.slug === 'pizzas' && menu?.pizza_flavors_enabled
                ? <button type="button" className="digital-pizza-config-button" onClick={() => setPizzaSelection({ product, fraction })}>Escolher sabores</button>
                : <QuantityControl compact label={`${product.name} ${fraction.name}`} value={quantityFor(product, fraction)} onChange={quantity => setItemQuantity(product, fraction, quantity)}/>}
            </div>)}</div> : <div className="digital-add-product"><span>A partir de <b>{money(product.base_price)}</b></span><QuantityControl compact label={product.name} value={quantityFor(product)} onChange={quantity => setItemQuantity(product, null, quantity)}/></div>}
          </div></article>; })}{visibleProducts.length === 0 && <div className="digital-no-products"><Search size={20}/><b>Nenhum item encontrado</b><span>Tente outra busca ou escolha outra categoria.</span></div>}</div>
      </div>
    </section>
    <footer className="digital-public-footer"><a className="digital-logo" href="#top"><img className="digital-logo-image digital-logo-image-small" src={BRAND_LOGO} alt=""/><b>{menu.restaurant_name}</b></a><span>Cardápio digital · COZINFOOD</span></footer>

    <button className="digital-mobile-cart" onClick={() => setCartOpen(true)}><ShoppingCart size={17}/><span>Ver pedido</span><b>{cartCount}</b><strong>{money(cartTotal)}</strong></button>
    {cartOpen && <div className="digital-cart-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCartOpen(false); }}><aside className="digital-cart-panel"><header><div><span className="digital-overline">SEU PEDIDO</span><h2>Quase lá!</h2></div><button onClick={() => setCartOpen(false)} aria-label="Fechar carrinho"><X size={19}/></button></header><div className="digital-cart-items">{cart.length ? cart.map(item => <article key={item.key}><img className="digital-cart-photo" src={productImageUrl(item.product) || undefined} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/> <div><b>{item.flavors?.length ? item.flavors.map(flavor => flavor.product.name).join(' / ') : item.product.name}{item.fraction ? ` · ${item.fraction.name}` : ''}</b>{(item.border || item.additions?.length > 0) && <small>{[item.border && `Borda: ${item.border.name}`, ...(item.additions || []).map(addition => `Adicional: ${addition.name}`)].filter(Boolean).join(' · ')}</small>}<textarea className="digital-cart-item-note" value={item.notes || ''} onChange={event => updateItemNote(item.key, event.target.value)} maxLength={300} placeholder="Observação deste item (opcional)"/><span>{money(item.unitPrice ?? item.fraction?.price ?? item.product.base_price)} cada</span></div><QuantityControl label={item.product.name} value={item.quantity} onChange={quantity => updateQuantity(item.key, quantity)}/></article>) : <div className="digital-cart-empty"><ShoppingCart size={23}/><b>Seu carrinho está vazio</b><span>Adicione algo gostoso do cardápio.</span></div>}</div><form className="digital-checkout" onSubmit={submitOrder}><label>Seu nome<input required maxLength={80} value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} placeholder="Como podemos chamar você?"/></label><label>Telefone<input required type="tel" inputMode="tel" maxLength={20} value={customer.phone} onChange={event => setCustomer({ ...customer, phone: event.target.value })} placeholder="(11) 99999-9999"/></label><label>Observação <span>(opcional)</span><textarea maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Alguma preferência para seu pedido?"/></label><div className="digital-total"><span>Total</span><b>{money(cartTotal)}</b></div><button className="digital-submit" disabled={sending || !cart.length}>{sending ? 'Enviando pedido...' : 'Confirmar pedido'} <ArrowRight size={16}/></button><small>Retire no restaurante e pague no local.</small></form></aside></div>}
    {pizzaSelection && <PizzaFlavorPicker products={allProducts} product={pizzaSelection.product} fraction={pizzaSelection.fraction} borders={menu?.pizza_borders || []} additions={menu?.product_additions || []} fractionPricing={menu?.fraction_pricing} onCancel={() => setPizzaSelection(null)} onConfirm={addPizzaSelection}/>}
    {imagePreview && <div className="public-product-image-preview-layer" onMouseDown={event => { if (event.target === event.currentTarget) setImagePreview(null); }}><section className="public-product-image-preview" role="dialog" aria-modal="true" aria-label={`Foto de ${imagePreview.name}`}><button type="button" className="public-product-image-preview-close" onClick={() => setImagePreview(null)} aria-label="Fechar foto"><X size={20}/></button><img src={imagePreview.url} alt={imagePreview.name}/><h2>{imagePreview.name}</h2></section></div>}
  </main>;
}

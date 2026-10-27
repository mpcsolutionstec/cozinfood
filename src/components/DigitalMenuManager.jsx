import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Eye, Globe2, LoaderCircle, Menu as MenuIcon, PackageCheck, Search, Share2, Smartphone, Sparkles, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAuth } from './AuthGate';
import { supabase } from '../lib/supabaseClient';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function DigitalMenuManager() {
  const { profile } = useAuth();
  const [restaurant, setRestaurant] = useState(null);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyProduct, setBusyProduct] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!profile?.restaurant_id || !supabase) return;
    setLoading(true);
    setError('');
    const [restaurantResult, categoryResult, productResult] = await Promise.all([
      supabase.from('restaurants').select('id,name,slug,public_menu_enabled,public_menu_description,public_menu_phone').eq('id', profile.restaurant_id).single(),
      supabase.from('categories').select('id,name,slug,sort_order,active').eq('restaurant_id', profile.restaurant_id).order('sort_order').order('name'),
      supabase.from('products').select('id,name,description,base_price,active,category_id,categories(name),product_fractions(id,name,price,active)').eq('restaurant_id', profile.restaurant_id).order('name'),
    ]);
    const failed = restaurantResult.error || categoryResult.error || productResult.error;
    if (failed) setError(`Não foi possível carregar o cardápio: ${failed.message}`);
    else {
      setRestaurant(restaurantResult.data);
      setEnabled(restaurantResult.data.public_menu_enabled);
      setDescription(restaurantResult.data.public_menu_description || '');
      setPhone(restaurantResult.data.public_menu_phone || '');
      setCategories(categoryResult.data || []);
      setProducts(productResult.data || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile?.restaurant_id]);

  const publicUrl = useMemo(() => {
    if (!restaurant?.slug) return '';
    const url = new URL(import.meta.env.BASE_URL, window.location.origin);
    url.searchParams.set('cardapio', restaurant.slug);
    return url.toString();
  }, [restaurant?.slug]);

  const visibleProducts = products.filter(product =>
    (selectedCategory === 'all' || product.category_id === selectedCategory) &&
    product.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))
  );
  const activeProducts = products.filter(product => product.active).length;
  const activeCategories = categories.filter(category => category.active).length;

  const saveSettings = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const { error: saveError } = await supabase.from('restaurants').update({
      public_menu_enabled: enabled,
      public_menu_description: description.trim(),
      public_menu_phone: phone.replace(/\D/g, '').slice(0, 15),
    }).eq('id', profile.restaurant_id);
    if (saveError) setError(`Não foi possível salvar: ${saveError.message}`);
    else setNotice('Configurações do cardápio salvas.');
    setSaving(false);
  };

  const toggleProduct = async product => {
    setBusyProduct(product.id);
    setError('');
    const { error: updateError } = await supabase.from('products').update({ active: !product.active }).eq('id', product.id).eq('restaurant_id', profile.restaurant_id);
    if (updateError) setError(`Não foi possível atualizar ${product.name}: ${updateError.message}`);
    else {
      setProducts(current => current.map(item => item.id === product.id ? { ...item, active: !item.active } : item));
      setNotice(product.active ? `${product.name} foi ocultado do cardápio.` : `${product.name} está disponível no cardápio.`);
    }
    setBusyProduct('');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setError('Não foi possível copiar. Selecione o endereço do cardápio para copiar.'); }
  };

  if (loading) return <div className="dm-loading"><LoaderCircle className="dm-spinner" size={20}/> Carregando o cardápio digital...</div>;

  return <div className="dm-admin">
    <section className="dm-admin-hero">
      <div className="dm-hero-copy"><span className="dm-eyebrow"><Sparkles size={13}/> VITRINE DIGITAL</span><h1>Seu cardápio, pronto para compartilhar.</h1><p>Apresente seus produtos com clareza e receba pedidos online em um link simples.</p><div className="dm-hero-actions"><a className="dm-primary-link" href={publicUrl} target="_blank" rel="noreferrer"><Eye size={16}/> Ver cardápio <ExternalLink size={13}/></a><button className="dm-ghost-link" onClick={copyLink}><Copy size={15}/>{copied ? 'Link copiado' : 'Copiar link'}</button></div></div>
      <div className="dm-hero-art" aria-hidden="true"><div className="dm-art-sun"/><div className="dm-art-plate"><span>✦</span><span>✦</span><span>✦</span></div><div className="dm-art-tag">feito com carinho</div></div>
    </section>

    <div className="dm-summary-grid">
      <article><span className="dm-summary-icon violet"><Globe2 size={17}/></span><div><small>PUBLICAÇÃO</small><b>{enabled ? 'Cardápio no ar' : 'Pausado'}</b></div><i className={enabled ? 'dm-live-dot' : 'dm-off-dot'}/></article>
      <article><span className="dm-summary-icon orange"><PackageCheck size={17}/></span><div><small>PRODUTOS VISÍVEIS</small><b>{activeProducts} de {products.length}</b></div></article>
      <article><span className="dm-summary-icon green"><MenuIcon size={17}/></span><div><small>CATEGORIAS</small><b>{activeCategories} ativas</b></div></article>
      <article><span className="dm-summary-icon blue"><Smartphone size={17}/></span><div><small>FORMATO</small><b>Otimizado para celular</b></div></article>
    </div>

    {notice && <div className="dm-flash success"><Check size={15}/>{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso">×</button></div>}
    {error && <div className="dm-flash error">{error}<button onClick={() => setError('')} aria-label="Fechar aviso">×</button></div>}

    <div className="dm-admin-layout">
      <section className="dm-panel dm-catalog-panel">
        <div className="dm-panel-heading"><div><span className="dm-section-kicker">CATÁLOGO</span><h2>O que aparece para seus clientes</h2><p>Ative os itens que quer vender agora.</p></div><span className="dm-count-pill">{activeProducts} ativos</span></div>
        <div className="dm-catalog-tools"><div className="dm-filters">{[{ id: 'all', name: 'Todos' }, ...categories].map(category => <button key={category.id} className={selectedCategory === category.id ? 'selected' : ''} onClick={() => setSelectedCategory(category.id)}>{category.name}</button>)}</div><label className="dm-search"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar produto"/></label></div>
        <div className="dm-product-list">{visibleProducts.map((product, index) => <article className={`dm-product-row ${!product.active ? 'muted' : ''}`} key={product.id}>
          <div className={`dm-product-mark mark-${index % 5}`}><span>{product.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span></div>
          <div className="dm-product-info"><b>{product.name}</b><span>{product.categories?.name || 'Sem categoria'}{product.description ? ` · ${product.description}` : ''}</span></div>
          <div className="dm-product-price">{product.product_fractions?.some(size => size.active) ? `a partir de ${money(Math.min(...product.product_fractions.filter(size => size.active).map(size => Number(size.price))))}` : money(product.base_price)}</div>
          <button className={`dm-visibility ${product.active ? 'on' : ''}`} disabled={busyProduct === product.id} onClick={() => toggleProduct(product)} title={product.active ? 'Ocultar do cardápio' : 'Exibir no cardápio'} aria-label={product.active ? `Ocultar ${product.name}` : `Exibir ${product.name}`}>{busyProduct === product.id ? <LoaderCircle size={19} className="dm-spinner"/> : product.active ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>}</button>
        </article>)}{visibleProducts.length === 0 && <div className="dm-empty"><Search size={20}/><b>Nenhum produto encontrado</b><span>Cadastre produtos em Pizzas e esfihas e mantenha-os ativos.</span></div>}</div>
      </section>

      <aside className="dm-side-column">
        <form className="dm-panel dm-settings" onSubmit={saveSettings}>
          <div className="dm-panel-heading"><div><span className="dm-section-kicker">CONFIGURAÇÃO</span><h2>Identidade e publicação</h2></div></div>
          <div className="dm-publish-toggle"><div><b>{enabled ? 'Cardápio publicado' : 'Publicação pausada'}</b><span>{enabled ? 'Seus clientes podem abrir o link.' : 'O link ficará temporariamente indisponível.'}</span></div><button type="button" className={`dm-switch ${enabled ? 'enabled' : ''}`} onClick={() => setEnabled(value => !value)} role="switch" aria-checked={enabled}><i/></button></div>
          <label className="dm-field">Mensagem de apresentação<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={180} placeholder="Ex.: Receitas artesanais feitas na hora, com ingredientes selecionados."/></label>
          <label className="dm-field">WhatsApp do restaurante<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" maxLength={20} placeholder="Ex.: (11) 99999-9999"/></label>
          <div className="dm-field"><span>Link público</span><div className="dm-public-link"><input readOnly value={publicUrl}/><button type="button" onClick={copyLink} aria-label="Copiar link"><Copy size={14}/></button></div></div>
          <button className="dm-save-button" disabled={saving}>{saving ? <><LoaderCircle size={15} className="dm-spinner"/> Salvando...</> : 'Salvar configurações'}</button>
        </form>
        <div className="dm-tip-card"><span><Share2 size={16}/></span><div><b>Divulgue onde seus clientes estão</b><p>Compartilhe o link no Instagram, WhatsApp, Google ou imprima um QR Code para o balcão.</p></div></div>
      </aside>
    </div>
  </div>;
}

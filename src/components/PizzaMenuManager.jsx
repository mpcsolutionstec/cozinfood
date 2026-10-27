import { useEffect, useMemo, useState } from 'react';
import { Check, ChefHat, CircleDollarSign, Edit3, ImagePlus, Plus, Pizza, Search, Trash2, Upload, Wheat, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import { supabase } from '../lib/supabaseClient';

const sizeDefinitions = [
  { name: 'Broto', serves: 1 },
  { name: 'Média', serves: 2 },
  { name: 'Grande', serves: 3 },
  { name: 'Gigante', serves: 4 },
];
const categoryDefinitions = [
  { name: 'Pizzas', slug: 'pizzas', sort_order: 1 },
  { name: 'Esfihas', slug: 'esfihas', sort_order: 2 },
];
const ruleDescriptions = {
  maior_valor: 'O preço da pizza fracionada será o maior preço entre os sabores escolhidos.',
  media_ponderada: 'O preço será a média dos sabores, ponderada pelo tamanho de cada fração.',
};
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatError = error => error?.code === '23505' ? 'Já existe um item com esse nome. Use outro nome.' : error?.message || 'Não foi possível concluir a operação.';

function emptyProduct() {
  return {
    category_slug: 'pizzas', name: '', description: '', accepts_fractions: true,
    prep_minutes: 15, active: true, image_path: '',
    sizes: Object.fromEntries(sizeDefinitions.map(size => [size.name, { price: '', active: true }])),
  };
}

export default function PizzaMenuManager() {
  const { profile } = useAuth();
  const restaurantId = profile?.restaurant_id;
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [borders, setBorders] = useState([]);
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState('catalog');
  const [categoryFilter, setCategoryFilter] = useState('pizzas');
  const [search, setSearch] = useState('');
  const [productDialog, setProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [productImageFile, setProductImageFile] = useState(null);
  const [productImagePreview, setProductImagePreview] = useState('');
  const [borderDialog, setBorderDialog] = useState(false);
  const [editingBorder, setEditingBorder] = useState(null);
  const [borderForm, setBorderForm] = useState({ name: '', price: '', active: true });
  const [ruleBusy, setRuleBusy] = useState(false);
  const [simulationCategory, setSimulationCategory] = useState('pizzas');
  const [simulationSize, setSimulationSize] = useState('Grande');
  const [flavorCount, setFlavorCount] = useState(2);
  const [flavorIds, setFlavorIds] = useState(['', '', '', '']);
  const [borderId, setBorderId] = useState('');

  useEffect(() => () => {
    if (productImagePreview.startsWith('blob:')) URL.revokeObjectURL(productImagePreview);
  }, [productImagePreview]);

  const loadCatalog = async () => {
    if (!restaurantId) {
      setError('Não encontramos o restaurante vinculado à sua conta. Entre novamente e tente outra vez.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const { data: savedCategories, error: categoriesError } = await supabase
      .from('categories')
      .upsert(categoryDefinitions.map(category => ({ ...category, restaurant_id: restaurantId, active: true })), { onConflict: 'restaurant_id,slug' })
      .select('id,name,slug,sort_order,active');
    if (categoriesError) {
      setError(`Falha ao carregar as categorias: ${categoriesError.message}`);
      setLoading(false);
      return;
    }
    const [productsResult, bordersResult, restaurantResult] = await Promise.all([
      supabase.from('products').select('id,restaurant_id,category_id,name,description,base_price,image_path,accepts_fractions,prep_minutes,destination_sector,active,categories(name,slug),product_fractions(id,name,serves,price,active)').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('pizza_borders').select('id,name,price,active').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('restaurants').select('id,name,fraction_pricing').eq('id', restaurantId).single(),
    ]);
    const loadFailure = productsResult.error || bordersResult.error || restaurantResult.error;
    if (loadFailure) setError(`Falha ao carregar o catálogo: ${loadFailure.message}`);
    else {
      setCategories(savedCategories || []);
      setProducts(productsResult.data || []);
      setBorders(bordersResult.data || []);
      setRestaurant(restaurantResult.data);
    }
    setLoading(false);
  };

  useEffect(() => { loadCatalog(); }, [restaurantId]);

  const filteredProducts = useMemo(() => products.filter(product => {
    const matchesCategory = product.categories?.slug === categoryFilter;
    const matchesSearch = product.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));
    return matchesCategory && matchesSearch;
  }), [products, categoryFilter, search]);

  const availableFlavors = useMemo(() => products.filter(product => product.active && product.accepts_fractions && product.categories?.slug === simulationCategory && product.product_fractions?.some(size => size.active && size.name === simulationSize)), [products, simulationCategory, simulationSize]);
  const chosenFlavors = flavorIds.slice(0, flavorCount).map(id => availableFlavors.find(product => product.id === id)).filter(Boolean);
  const hasAllFlavors = chosenFlavors.length === Number(flavorCount);
  const fractionPrice = product => Number(product.product_fractions.find(size => size.name === simulationSize && size.active)?.price || 0);
  const flavorPrices = chosenFlavors.map(fractionPrice);
  const flavorCharge = hasAllFlavors && flavorPrices.length
    ? restaurant?.fraction_pricing === 'media_ponderada'
      ? flavorPrices.reduce((total, price) => total + price / flavorPrices.length, 0)
      : Math.max(...flavorPrices)
    : 0;
  const selectedBorder = borders.find(border => border.id === borderId && border.active);
  const finalPrice = flavorCharge + Number(selectedBorder?.price || 0);

  const setProductField = (field, value) => setProductForm(current => ({ ...current, [field]: value }));
  const setSizeField = (name, field, value) => setProductForm(current => ({ ...current, sizes: { ...current.sizes, [name]: { ...current.sizes[name], [field]: value } } }));

  const openCreateProduct = () => {
    setEditingProduct(null);
    setProductForm(emptyProduct());
    setProductImageFile(null);
    setProductImagePreview('');
    setProductDialog(true);
  };

  const openEditProduct = product => {
    const sizes = Object.fromEntries(sizeDefinitions.map(size => {
      const saved = product.product_fractions?.find(fraction => fraction.name === size.name);
      return [size.name, { price: saved?.price ?? '', active: saved?.active ?? false }];
    }));
    setEditingProduct(product);
    setProductForm({
      category_slug: product.categories?.slug || 'pizzas',
      name: product.name,
      description: product.description || '',
      accepts_fractions: product.accepts_fractions,
      prep_minutes: product.prep_minutes,
      active: product.active,
      image_path: product.image_path || '',
      sizes,
    });
    setProductImageFile(null);
    setProductImagePreview(product.image_path ? supabase.storage.from('product-images').getPublicUrl(product.image_path).data.publicUrl : '');
    setProductDialog(true);
  };

  const chooseProductImage = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Use uma imagem JPG, PNG ou WEBP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('A foto deve ter no máximo 5 MB.');
      return;
    }
    setError('');
    setProductImageFile(file);
    setProductImagePreview(URL.createObjectURL(file));
  };

  const removeProductImage = () => {
    setProductImageFile(null);
    setProductImagePreview('');
    setProductForm(current => ({ ...current, image_path: '' }));
  };

  const saveProduct = async event => {
    event.preventDefault();
    setNotice('');
    const category = categories.find(item => item.slug === productForm.category_slug);
    if (!category) { setError('A categoria selecionada não está disponível. Atualize a página e tente novamente.'); return; }
    const activeSizes = sizeDefinitions.filter(size => productForm.sizes[size.name].active);
    if (!activeSizes.length) { setError('Ative pelo menos um tamanho e informe seu preço.'); return; }
    if (activeSizes.some(size => productForm.sizes[size.name].price === '' || !Number.isFinite(Number(productForm.sizes[size.name].price)) || Number(productForm.sizes[size.name].price) < 0)) {
      setError('Informe um preço válido para cada tamanho ativo.'); return;
    }
    setBusy(true);
    setError('');
    const basePrice = Math.min(...activeSizes.map(size => Number(productForm.sizes[size.name].price)));
    const productValues = {
      restaurant_id: restaurantId,
      category_id: category.id,
      name: productForm.name.trim(),
      description: productForm.description.trim() || null,
      image_path: productForm.image_path || null,
      base_price: basePrice,
      accepts_fractions: productForm.accepts_fractions,
      prep_minutes: Number(productForm.prep_minutes),
      destination_sector: 'forno_pizza',
      active: productForm.active,
    };
    let savedProduct;
    if (editingProduct) {
      const result = await supabase.from('products').update(productValues).eq('id', editingProduct.id).eq('restaurant_id', restaurantId).select('id').single();
      savedProduct = result.data;
      if (result.error) { setError(`Não foi possível atualizar o produto: ${formatError(result.error)}`); setBusy(false); return; }
    } else {
      const result = await supabase.from('products').insert(productValues).select('id').single();
      savedProduct = result.data;
      if (result.error) { setError(`Não foi possível cadastrar o produto: ${formatError(result.error)}`); setBusy(false); return; }
    }
    const previousImagePath = editingProduct?.image_path || null;
    let savedImagePath = productForm.image_path || null;
    if (productImageFile) {
      const extension = productImageFile.type === 'image/png' ? 'png' : productImageFile.type === 'image/webp' ? 'webp' : 'jpg';
      const objectPath = `${restaurantId}/${savedProduct.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(objectPath, productImageFile, { contentType: productImageFile.type, cacheControl: '3600', upsert: false });
      if (uploadError) {
        setBusy(false);
        await loadCatalog();
        setError(`O produto foi salvo, mas a foto não pôde ser enviada: ${formatError(uploadError)}`);
        return;
      }
      const { error: imageSaveError } = await supabase.from('products').update({ image_path: objectPath }).eq('id', savedProduct.id).eq('restaurant_id', restaurantId);
      if (imageSaveError) {
        await supabase.storage.from('product-images').remove([objectPath]);
        setBusy(false);
        await loadCatalog();
        setError(`O produto foi salvo, mas não foi possível vincular a foto: ${formatError(imageSaveError)}`);
        return;
      }
      savedImagePath = objectPath;
    }
    if (previousImagePath && previousImagePath !== savedImagePath) {
      const { error: removeError } = await supabase.storage.from('product-images').remove([previousImagePath]);
      if (removeError) setNotice('Produto salvo. A foto antiga não pôde ser removida do armazenamento.');
    }
    const fractionRows = sizeDefinitions.map(size => ({
      product_id: savedProduct.id,
      name: size.name,
      serves: size.serves,
      price: Number(productForm.sizes[size.name].price || 0),
      active: productForm.sizes[size.name].active,
    }));
    const { error: fractionError } = await supabase.from('product_fractions').upsert(fractionRows, { onConflict: 'product_id,name' });
    if (fractionError) {
      setError(`O produto foi salvo, mas não foi possível salvar seus tamanhos: ${fractionError.message}`);
      setBusy(false);
      await loadCatalog();
      return;
    }
    setBusy(false);
    setProductDialog(false);
    setProductImageFile(null);
    setProductImagePreview('');
    setNotice(editingProduct ? 'Produto atualizado.' : 'Produto cadastrado.');
    await loadCatalog();
  };

  const deleteProduct = async product => {
    if (!window.confirm(`Excluir “${product.name}”? Os itens já lançados em pedidos manterão o nome e o preço registrados.`)) return;
    setError('');
    const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id).eq('restaurant_id', restaurantId);
    if (deleteError) setError(`Não foi possível excluir: ${deleteError.message}`);
    else { setNotice(`“${product.name}” foi excluído do catálogo.`); await loadCatalog(); }
  };

  const savePricingRule = async event => {
    const fractionPricing = event.target.value;
    setRuleBusy(true);
    setError('');
    const { error: ruleError } = await supabase.from('restaurants').update({ fraction_pricing: fractionPricing }).eq('id', restaurantId);
    if (ruleError) setError(`Não foi possível salvar a regra de preço: ${ruleError.message}`);
    else {
      setRestaurant(current => ({ ...current, fraction_pricing: fractionPricing }));
      setNotice('Regra de preço do restaurante atualizada.');
    }
    setRuleBusy(false);
  };

  const openCreateBorder = () => { setEditingBorder(null); setBorderForm({ name: '', price: '', active: true }); setBorderDialog(true); };
  const openEditBorder = border => { setEditingBorder(border); setBorderForm({ name: border.name, price: String(border.price), active: border.active }); setBorderDialog(true); };
  const saveBorder = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = { restaurant_id: restaurantId, name: borderForm.name.trim(), price: Number(borderForm.price || 0), active: borderForm.active };
    const query = editingBorder
      ? supabase.from('pizza_borders').update(values).eq('id', editingBorder.id).eq('restaurant_id', restaurantId)
      : supabase.from('pizza_borders').insert(values);
    const { error: borderError } = await query;
    if (borderError) setError(`Não foi possível salvar a borda: ${formatError(borderError)}`);
    else { setBorderDialog(false); setNotice(editingBorder ? 'Borda atualizada.' : 'Borda cadastrada.'); await loadCatalog(); }
    setBusy(false);
  };
  const deleteBorder = async border => {
    if (!window.confirm(`Excluir a borda “${border.name}”?`)) return;
    const { error: borderError } = await supabase.from('pizza_borders').delete().eq('id', border.id).eq('restaurant_id', restaurantId);
    if (borderError) setError(`Não foi possível excluir a borda: ${borderError.message}`);
    else { setNotice(`Borda “${border.name}” excluída.`); await loadCatalog(); }
  };

  const setFlavorSlot = (index, value) => setFlavorIds(current => current.map((id, slot) => slot === index ? value : id));
  const productFormName = productForm.category_slug === 'esfihas' ? 'esfiha' : 'pizza';

  return <>
    <div className="page-heading pizza-manager-heading"><div><h1>Pizzas e esfihas</h1><p>Gerencie sabores, tamanhos, bordas e a regra de preço das frações.</p></div>
      <button className="primary" onClick={section === 'borders' ? openCreateBorder : openCreateProduct}><Plus size={15}/>{section === 'borders' ? 'Nova borda' : 'Novo sabor'}</button></div>

    <section className="pizza-pricing-settings"><div className="pricing-setting-icon"><CircleDollarSign size={19}/></div><div className="pricing-setting-copy"><b>Regra de cobrança das frações</b><span>{ruleDescriptions[restaurant?.fraction_pricing] || 'Defina como calcular o preço de uma pizza com vários sabores.'}</span></div>
      <select value={restaurant?.fraction_pricing || 'maior_valor'} disabled={ruleBusy || loading} onChange={savePricingRule} aria-label="Regra de preço da pizza fracionada"><option value="maior_valor">Cobrar pelo maior valor</option><option value="media_ponderada">Média ponderada das frações</option></select>
    </section>

    <div className="pizza-page-tabs"><button className={section === 'catalog' ? 'active' : ''} onClick={() => setSection('catalog')}><Pizza size={15}/> Sabores e tamanhos</button><button className={section === 'calculator' ? 'active' : ''} onClick={() => setSection('calculator')}><CircleDollarSign size={15}/> Simulador de preço</button><button className={section === 'borders' ? 'active' : ''} onClick={() => setSection('borders')}><Wheat size={15}/> Bordas recheadas</button></div>

    {error && <div className="pizza-message error" role="alert">{error}<button onClick={() => setError('')}><X size={14}/></button></div>}
    {notice && <div className="pizza-message success" role="status">{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}

    {loading ? <div className="pizza-loading"><span className="auth-spinner"/>Carregando catálogo...</div> : section === 'catalog' ? <>
      <div className="pizza-catalog-toolbar"><div className="pizza-category-tabs">{categoryDefinitions.map(category => <button key={category.slug} className={categoryFilter === category.slug ? 'active' : ''} onClick={() => setCategoryFilter(category.slug)}>{category.slug === 'pizzas' ? <Pizza size={15}/> : <Wheat size={15}/>} {category.name}<b>{products.filter(product => product.categories?.slug === category.slug).length}</b></button>)}</div><label className="pizza-search"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar sabor"/></label></div>
      {filteredProducts.length ? <div className="pizza-product-grid">{filteredProducts.map(product => {
        const activeSizes = sizeDefinitions.map(size => product.product_fractions?.find(fraction => fraction.name === size.name && fraction.active)).filter(Boolean);
        const productImageUrl = product.image_path ? supabase.storage.from('product-images').getPublicUrl(product.image_path).data.publicUrl : '';
        return <article className={`pizza-product-card ${product.active ? '' : 'inactive'}`} key={product.id}>
          <div className={`pizza-product-photo ${productImageUrl ? 'has-image' : ''}`}>{productImageUrl ? <img src={productImageUrl} alt={product.name} loading="lazy"/> : <span>{product.categories?.slug === 'esfihas' ? <Wheat size={25}/> : <Pizza size={25}/>}<small>Adicione uma foto</small></span>}</div>
          <div className="pizza-product-card-top"><span className="pizza-product-icon">{product.categories?.slug === 'esfihas' ? <Wheat size={18}/> : <Pizza size={18}/>}</span><span className={`pizza-active-pill ${product.active ? '' : 'off'}`}>{product.active ? 'Ativo' : 'Inativo'}</span></div>
          <h2>{product.name}</h2><p className="pizza-product-description">{product.description || 'Sem descrição cadastrada.'}</p>
          <div className="pizza-size-prices">{activeSizes.length ? activeSizes.map(size => <div key={size.name}><span>{size.name}</span><b>{money(size.price)}</b></div>) : <span className="no-sizes">Nenhum tamanho ativo</span>}</div>
          <div className="pizza-product-card-footer"><span>{product.accepts_fractions ? 'Aceita frações' : 'Inteira'} · {product.prep_minutes} min</span><div><button onClick={() => openEditProduct(product)} aria-label={`Editar ${product.name}`}><Edit3 size={14}/></button><button className="pizza-delete-button" onClick={() => deleteProduct(product)} aria-label={`Excluir ${product.name}`}><Trash2 size={14}/></button></div></div>
        </article>;
      })}</div> : <div className="pizza-empty"><span><ChefHat size={26}/></span><h2>Nenhum {categoryFilter === 'pizzas' ? 'sabor de pizza' : 'sabor de esfiha'} cadastrado</h2><p>Cadastre um sabor com os tamanhos e preços disponíveis.</p><button className="primary" onClick={openCreateProduct}><Plus size={14}/> Cadastrar sabor</button></div>}
    </> : section === 'calculator' ? <div className="pizza-calculator-layout">
      <section className="panel pizza-calculator-panel"><header><div><h2>Montador de frações</h2><p>Escolha o tamanho e até quatro sabores. Cada sabor ocupa uma fração igual.</p></div></header>
        <div className="pizza-calculator-controls"><label>Tipo<select value={simulationCategory} onChange={event => { setSimulationCategory(event.target.value); setFlavorIds(['', '', '', '']); }}><option value="pizzas">Pizza</option><option value="esfihas">Esfiha</option></select></label><label>Tamanho<select value={simulationSize} onChange={event => { setSimulationSize(event.target.value); setFlavorIds(['', '', '', '']); }}>{sizeDefinitions.map(size => <option key={size.name}>{size.name}</option>)}</select></label><label>Quantidade de sabores<select value={flavorCount} onChange={event => setFlavorCount(Number(event.target.value))}><option value={1}>1 sabor</option><option value={2}>2 sabores (½ cada)</option><option value={3}>3 sabores (⅓ cada)</option><option value={4}>4 sabores (¼ cada)</option></select></label></div>
        <div className="pizza-flavor-slots">{Array.from({ length: Number(flavorCount) }, (_, index) => <label key={index}><span><i>{index + 1}</i> Fração 1/{flavorCount}</span><select value={flavorIds[index]} onChange={event => setFlavorSlot(index, event.target.value)}><option value="">Selecione um sabor</option>{availableFlavors.map(product => <option value={product.id} key={product.id} disabled={flavorIds.some((id, slot) => slot !== index && id === product.id)}>{product.name} · {money(fractionPrice(product))}</option>)}</select></label>)}</div>
        {!availableFlavors.length && <div className="pizza-calculator-hint">Cadastre sabores ativos com preço para o tamanho selecionado para usá-los aqui.</div>}
        <label className="pizza-border-select">Borda recheada<select value={borderId} onChange={event => setBorderId(event.target.value)}><option value="">Sem borda</option>{borders.filter(border => border.active).map(border => <option key={border.id} value={border.id}>{border.name} · {money(border.price)}</option>)}</select></label>
        <div className="pizza-rule-explainer"><Check size={15}/><span>{ruleDescriptions[restaurant?.fraction_pricing] || 'A regra de preço será aplicada sobre os sabores escolhidos.'}</span></div>
      </section>
      <aside className="panel pizza-calculator-summary"><span className="pizza-summary-label">SIMULAÇÃO DO PREÇO</span><h2>{simulationSize}</h2><div className="pizza-summary-flavors">{chosenFlavors.map((product, index) => <div key={`${product.id}-${index}`}><span>1/{flavorCount} · {product.name}</span><b>{money(fractionPrice(product))}</b></div>)}{!chosenFlavors.length && <p>Selecione os sabores para calcular.</p>}</div>
        <div className="pizza-summary-line"><span>{restaurant?.fraction_pricing === 'media_ponderada' ? 'Preço ponderado das frações' : 'Preço do maior sabor'}</span><b>{hasAllFlavors ? money(flavorCharge) : '—'}</b></div>{selectedBorder && <div className="pizza-summary-line"><span>Borda {selectedBorder.name}</span><b>{money(selectedBorder.price)}</b></div>}
        <div className="pizza-summary-total"><span>Total calculado</span><b>{hasAllFlavors ? money(finalPrice) : '—'}</b></div><small>{hasAllFlavors ? `Dividido em ${flavorCount} fração(ões) iguais${selectedBorder ? ', incluindo a borda.' : '.'}` : 'Escolha um sabor válido para cada fração.'}</small>
      </aside>
    </div> : <section className="panel pizza-borders-panel"><header><div><h2>Bordas recheadas</h2><p>Os valores cadastrados entram no total do simulador.</p></div><button className="primary" onClick={openCreateBorder}><Plus size={14}/> Nova borda</button></header>
      {borders.length ? <div className="pizza-border-list">{borders.map(border => <article key={border.id}><span className="pizza-border-icon"><Wheat size={16}/></span><div><b>{border.name}</b><small className={border.active ? '' : 'inactive'}>{border.active ? 'Disponível' : 'Inativa'}</small></div><strong>{money(border.price)}</strong><button onClick={() => openEditBorder(border)} aria-label={`Editar borda ${border.name}`}><Edit3 size={14}/></button><button className="pizza-delete-button" onClick={() => deleteBorder(border)} aria-label={`Excluir borda ${border.name}`}><Trash2 size={14}/></button></article>)}</div> : <div className="pizza-empty compact"><span><Wheat size={25}/></span><h2>Nenhuma borda cadastrada</h2><p>Adicione opções para usar no simulador de preço.</p></div>}
    </section>}

    {productDialog && <div className="pizza-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setProductDialog(false); }}><section className="pizza-modal" role="dialog" aria-modal="true" aria-labelledby="pizza-product-form-title"><header><div><span className="pizza-modal-icon"><Pizza size={18}/></span><div><h2 id="pizza-product-form-title">{editingProduct ? 'Editar sabor' : 'Cadastrar sabor'}</h2><p>Defina os preços por tamanho e os dados de preparo.</p></div></div><button onClick={() => setProductDialog(false)} aria-label="Fechar" disabled={busy}><X size={18}/></button></header>
      <form onSubmit={saveProduct}><div className="pizza-product-form-grid"><label>Tipo<select value={productForm.category_slug} onChange={event => setProductField('category_slug', event.target.value)}>{categoryDefinitions.map(category => <option value={category.slug} key={category.slug}>{category.name}</option>)}</select></label><label>Nome do sabor<input value={productForm.name} onChange={event => setProductField('name', event.target.value)} placeholder={productForm.category_slug === 'pizzas' ? 'Ex.: Calabresa' : 'Ex.: Carne'} maxLength={100} required/></label><label>Tempo de preparo (min)<input type="number" min="0" max="240" value={productForm.prep_minutes} onChange={event => setProductField('prep_minutes', event.target.value)} required/></label><label className="pizza-product-active"><input type="checkbox" checked={productForm.active} onChange={event => setProductField('active', event.target.checked)}/> Disponível no cardápio</label><label className="pizza-description-field">Descrição<input value={productForm.description} onChange={event => setProductField('description', event.target.value)} placeholder="Ingredientes ou detalhes do sabor" maxLength={300}/></label></div>
        <section className="pizza-image-upload"><div><b>Foto do produto</b><span>JPG, PNG ou WEBP · até 5 MB</span></div><div className="pizza-image-upload-row">{productImagePreview ? <img src={productImagePreview} alt="Pré-visualização do produto"/> : <span className="pizza-image-placeholder"><ImagePlus size={23}/></span>}<div><label className="pizza-image-select"><Upload size={14}/>{productImagePreview ? 'Trocar foto' : 'Adicionar foto'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseProductImage} disabled={busy}/></label>{productImagePreview && <button type="button" className="pizza-image-remove" onClick={removeProductImage} disabled={busy}>Remover foto</button>}</div></div></section>
        <div className="pizza-size-editor"><div className="pizza-size-editor-heading"><b>Preços por tamanho</b><span>O menor preço ativo será o preço base.</span></div>{sizeDefinitions.map(size => <div className={`pizza-size-row ${productForm.sizes[size.name].active ? '' : 'disabled'}`} key={size.name}><label><input type="checkbox" checked={productForm.sizes[size.name].active} onChange={event => setSizeField(size.name, 'active', event.target.checked)}/><span>{size.name}</span></label><small>Serve {size.serves}</small><span className="currency-input"><i>R$</i><input type="number" min="0" step="0.01" value={productForm.sizes[size.name].price} onChange={event => setSizeField(size.name, 'price', event.target.value)} placeholder="0,00" disabled={!productForm.sizes[size.name].active} required={productForm.sizes[size.name].active}/></span></div>)}</div>
        <label className="pizza-fractions-toggle"><input type="checkbox" checked={productForm.accepts_fractions} onChange={event => setProductField('accepts_fractions', event.target.checked)}/><span><b>Permitir este sabor em pizzas fracionadas</b><small>O sabor será oferecido no simulador de frações.</small></span></label>
        <footer><button type="button" className="pizza-modal-cancel" onClick={() => setProductDialog(false)} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando...' : editingProduct ? 'Salvar alterações' : `Cadastrar ${productFormName}`}</button></footer>
      </form></section></div>}

    {borderDialog && <div className="pizza-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setBorderDialog(false); }}><section className="pizza-modal pizza-border-modal" role="dialog" aria-modal="true" aria-labelledby="pizza-border-title"><header><div><span className="pizza-modal-icon"><Wheat size={18}/></span><div><h2 id="pizza-border-title">{editingBorder ? 'Editar borda' : 'Nova borda recheada'}</h2><p>Cadastre o nome, o preço e a disponibilidade.</p></div></div><button onClick={() => setBorderDialog(false)} aria-label="Fechar" disabled={busy}><X size={18}/></button></header><form onSubmit={saveBorder}><label>Nome<input value={borderForm.name} onChange={event => setBorderForm({ ...borderForm, name: event.target.value })} placeholder="Ex.: Catupiry" required maxLength="60"/></label><label>Preço adicional<input type="number" min="0" step="0.01" value={borderForm.price} onChange={event => setBorderForm({ ...borderForm, price: event.target.value })} placeholder="0,00" required/></label><label className="pizza-border-active"><input type="checkbox" checked={borderForm.active} onChange={event => setBorderForm({ ...borderForm, active: event.target.checked })}/> Disponível no simulador</label><footer><button type="button" className="pizza-modal-cancel" onClick={() => setBorderDialog(false)} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar borda'}</button></footer></form></section></div>}
  </>;
}

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Barcode, Box, Check, Edit3, Image as ImageIcon, PackagePlus, Plus, Search, Trash2, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import { supabase } from '../lib/supabaseClient';
import ConfirmDialog from './ConfirmDialog';

const initialCategories = [{ name: 'Refrigerantes', slug: 'refrigerantes', sort_order: 20 }, { name: 'Sucos', slug: 'sucos', sort_order: 21 }, { name: 'Chocolates', slug: 'chocolates', sort_order: 22 }, { name: 'Outros produtos', slug: 'outros-produtos', sort_order: 23 }];
const units = ['un', 'g', 'kg', 'ml', 'l', 'cx', 'pct'];
const sectors = [['bar', 'Bar'], ['cozinha', 'Cozinha'], ['forno_pizza', 'Forno de pizza']];
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quantity = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const blank = () => ({ category_id: '', name: '', barcode: '', cost_price: '', sale_price: '', stock_quantity: '', min_stock: '5', unit_measure: 'un', destination_sector: 'bar', image_url: '', description: '', active: true });

export default function ProductCatalogManager() {
  const { profile } = useAuth();
  const restaurantId = profile?.restaurant_id;
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toDelete, setToDelete] = useState(null);

  const load = async () => {
    if (!restaurantId || !supabase) { setLoading(false); return; }
    setLoading(true);
    setError('');
    const [categoriesRequest, productRequest] = await Promise.all([
      supabase.from('categories').upsert(initialCategories.map(item => ({ ...item, restaurant_id: restaurantId, active: true })), { onConflict: 'restaurant_id,slug' }).select('id,name,slug,sort_order'),
      supabase.from('products').select('id,name,description,barcode,cost_price,sale_price,base_price,stock_quantity,min_stock,unit_measure,destination_sector,image_url,active,category_id,categories(name,slug)').eq('restaurant_id', restaurantId).order('name'),
    ]);
    const failure = categoriesRequest.error || productRequest.error;
    if (failure) setError(`Não foi possível carregar os produtos: ${failure.message}`);
    else { setCategories(categoriesRequest.data || []); setProducts(productRequest.data || []); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [restaurantId]);
  const visible = useMemo(() => products.filter(item =>
    (filter === 'all' || item.category_id === filter) && `${item.name} ${item.barcode || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))
  ), [products, filter, search]);
  const lowStock = products.filter(item => Number(item.stock_quantity) <= Number(item.min_stock));
  const activeCount = products.filter(item => item.active).length;

  const edit = item => {
    setEditing(item);
    setForm({ category_id: item.category_id || '', name: item.name || '', barcode: item.barcode || '', cost_price: String(item.cost_price ?? 0), sale_price: String(item.sale_price ?? item.base_price ?? ''), stock_quantity: String(item.stock_quantity ?? 0), min_stock: String(item.min_stock ?? 5), unit_measure: item.unit_measure || 'un', destination_sector: item.destination_sector || 'bar', image_url: item.image_url || '', description: item.description || '', active: item.active });
    setError('');
    setOpen(true);
  };
  const create = () => { setEditing(null); setForm({ ...blank(), category_id: categories[0]?.id || '' }); setError(''); setOpen(true); };
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }));

  const save = async event => {
    event.preventDefault();
    const sale = Number(form.sale_price); const cost = Number(form.cost_price || 0); const stock = Number(form.stock_quantity || 0); const minimum = Number(form.min_stock || 0);
    if (!form.name.trim() || !form.category_id) { setError('Informe o nome e a categoria do produto.'); return; }
    if (![sale, cost, stock, minimum].every(Number.isFinite) || Math.min(sale, cost, stock, minimum) < 0) { setError('Informe valores válidos, iguais ou maiores que zero.'); return; }
    setBusy(true); setError('');
    const values = { restaurant_id: restaurantId, category_id: form.category_id, name: form.name.trim(), barcode: form.barcode.trim() || null, cost_price: cost, sale_price: sale, base_price: sale, stock_quantity: stock, min_stock: minimum, unit_measure: form.unit_measure, destination_sector: form.destination_sector, image_url: form.image_url.trim() || null, description: form.description.trim() || null, active: form.active, accepts_fractions: false, prep_minutes: 0 };
    const request = editing ? supabase.from('products').update(values).eq('id', editing.id).eq('restaurant_id', restaurantId) : supabase.from('products').insert(values);
    const { error: saveError } = await request;
    if (saveError) setError(saveError.code === '23505' ? 'Já existe um produto com este código de barras.' : saveError.message);
    else { setOpen(false); setNotice(editing ? 'Produto atualizado.' : 'Produto cadastrado.'); await load(); }
    setBusy(false);
  };
  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    const { error: removeError } = await supabase.from('products').delete().eq('id', toDelete.id).eq('restaurant_id', restaurantId);
    if (removeError) setError(removeError.message);
    else { setNotice(`${toDelete.name} foi excluído.`); await load(); }
    setBusy(false); setToDelete(null);
  };
  const margin = item => { const sale = Number(item.sale_price ?? item.base_price ?? 0); return sale ? ((sale - Number(item.cost_price || 0)) / sale) * 100 : 0; };

  return <div className="product-manager">
    <header className="page-heading product-heading">
      <div><span className="product-eyebrow">CATÁLOGO E PREÇOS</span><h1>Produtos</h1><p>Gerencie itens de venda rápida, preços e disponibilidade.</p></div>
      <button className="primary product-new-button" onClick={create}><Plus size={16}/> Novo produto</button>
    </header>

    {error && !open && <div className="product-message error" role="alert"><AlertTriangle size={16}/><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar aviso"><X size={15}/></button></div>}
    {notice && <div className="product-message success" role="status"><Check size={16}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15}/></button></div>}

    <section className="product-summary" aria-label="Resumo do catálogo">
      <article><span className="product-summary-icon total"><Box size={17}/></span><div><small>Total de produtos</small><b>{products.length}</b></div></article>
      <article><span className="product-summary-icon available"><Check size={17}/></span><div><small>Disponíveis para venda</small><b>{activeCount}</b></div></article>
      <article className={lowStock.length ? 'has-low-stock' : ''}><span className="product-summary-icon low"><AlertTriangle size={17}/></span><div><small>Estoque baixo</small><b>{lowStock.length}</b></div></article>
    </section>

    <section className="product-catalog-panel">
      <header className="product-catalog-header"><div><h2>Catálogo de produtos</h2><p>Consulte e edite os itens cadastrados.</p></div><span className="product-result-count">{visible.length} {visible.length === 1 ? 'item' : 'itens'}</span></header>
      <div className="product-catalog-toolbar">
        <label className="product-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome ou código" aria-label="Buscar produtos"/><kbd>⌕</kbd></label>
        <label className="product-category-filter"><span>Categoria</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todas as categorias</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      </div>
      {loading ? <div className="product-loading"><span className="product-spinner"/>Carregando catálogo...</div> : visible.length === 0 ? <div className="product-empty"><span><PackagePlus size={23}/></span><b>{products.length ? 'Nenhum produto encontrado' : 'Seu catálogo ainda está vazio'}</b><p>{products.length ? 'Ajuste a busca ou escolha outra categoria.' : 'Cadastre o primeiro item para começar a organizar suas vendas.'}</p>{!products.length && <button className="primary" onClick={create}><Plus size={15}/> Cadastrar primeiro produto</button>}</div> : <div className="product-table-wrap"><table className="product-table"><thead><tr><th>PRODUTO</th><th>CATEGORIA</th><th>PREÇO DE VENDA</th><th>ESTOQUE</th><th>MARGEM</th><th>STATUS</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{visible.map(item => {
        const stockLow = Number(item.stock_quantity) <= Number(item.min_stock);
        return <tr key={item.id}>
          <td><div className="product-name-cell">{item.image_url ? <img src={item.image_url} alt=""/> : <span className="product-item-placeholder"><Box size={16}/></span>}<div><b>{item.name}</b><small>{item.barcode ? <><Barcode size={11}/>{item.barcode}</> : item.description || 'Sem descrição'}</small></div></div></td>
          <td><span className="product-category-chip">{item.categories?.name || 'Sem categoria'}</span></td>
          <td><b className="product-price">{money(item.sale_price ?? item.base_price)}</b><small className="product-cost">Custo {money(item.cost_price)}</small></td>
          <td><span className={`product-stock ${stockLow ? 'low' : ''}`}>{stockLow && <AlertTriangle size={13}/>} {quantity(item.stock_quantity)} {item.unit_measure || 'un'}</span><small className="product-min-stock">Mínimo: {quantity(item.min_stock)}</small></td>
          <td><span className={`product-margin ${margin(item) < 30 ? 'margin-warning' : ''}`}>{margin(item).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></td>
          <td><span className={`product-status ${item.active ? 'active' : 'inactive'}`}><i/>{item.active ? 'Ativo' : 'Inativo'}</span></td>
          <td><div className="product-row-actions"><button onClick={() => edit(item)} aria-label={`Editar ${item.name}`} title="Editar"><Edit3 size={15}/></button><button className="delete" onClick={() => setToDelete(item)} aria-label={`Excluir ${item.name}`} title="Excluir"><Trash2 size={15}/></button></div></td>
        </tr>;
      })}</tbody></table></div>}
      {!loading && products.length > 0 && <footer className="product-catalog-footer">Exibindo {visible.length} de {products.length} produtos</footer>}
    </section>

    {open && <div className="product-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
        <header className="product-modal-header"><span className="product-modal-icon"><PackagePlus size={19}/></span><div><h2 id="product-form-title">{editing ? 'Editar produto' : 'Novo produto'}</h2><p>Preencha os dados para organizar o item no catálogo.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Fechar" disabled={busy}><X size={18}/></button></header>
        <form onSubmit={save} className="product-form">
          <section className="product-form-section"><div className="product-form-section-heading"><span>01</span><div><b>Informações do produto</b><small>Identificação e organização no catálogo</small></div></div>
            <div className="product-form-grid"><label className="span-two">Nome do produto <em>*</em><input autoFocus value={form.name} onChange={event => set('name', event.target.value)} placeholder="Ex.: Refrigerante lata 350 ml" maxLength={100} required/></label>
              <label>Categoria <em>*</em><select value={form.category_id} onChange={event => set('category_id', event.target.value)} required><option value="" disabled>Selecione uma categoria</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label><span className="product-field-title">Código de barras <span className="optional">Opcional</span></span><div className="product-input-icon"><Barcode size={15}/><input value={form.barcode} onChange={event => set('barcode', event.target.value)} placeholder="EAN ou código interno" maxLength={80}/></div></label>
              <label className="span-two"><span className="product-field-title">Descrição <span className="optional">Opcional</span></span><input value={form.description} onChange={event => set('description', event.target.value)} placeholder="Detalhes que ajudam a identificar o produto" maxLength={300}/></label>
            </div>
          </section>
          <section className="product-form-section"><div className="product-form-section-heading"><span>02</span><div><b>Preço e estoque</b><small>Valores de venda e controle de quantidade</small></div></div>
            <div className="product-form-grid product-pricing-grid"><label>Preço de custo <em>*</em><div className="product-input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={form.cost_price} onChange={event => set('cost_price', event.target.value)} placeholder="0,00" required/></div></label>
              <label>Preço de venda <em>*</em><div className="product-input-prefix"><span>R$</span><input type="number" min="0" step="0.01" value={form.sale_price} onChange={event => set('sale_price', event.target.value)} placeholder="0,00" required/></div></label>
              <label>Estoque atual<input type="number" min="0" step="0.001" value={form.stock_quantity} onChange={event => set('stock_quantity', event.target.value)} placeholder="0"/></label>
              <label>Estoque mínimo<input type="number" min="0" step="0.001" value={form.min_stock} onChange={event => set('min_stock', event.target.value)} placeholder="5"/></label>
              <label>Unidade de medida<select value={form.unit_measure} onChange={event => set('unit_measure', event.target.value)}>{units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            </div>
          </section>
          <section className="product-form-section"><div className="product-form-section-heading"><span>03</span><div><b>Operação e disponibilidade</b><small>Destino do pedido e exibição no cardápio</small></div></div>
            <div className="product-form-grid"><label>Setor de preparo<select value={form.destination_sector} onChange={event => set('destination_sector', event.target.value)}>{sectors.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="span-two"><span className="product-field-title">Imagem do produto <span className="optional">Opcional</span></span><div className="product-input-icon"><ImageIcon size={15}/><input type="url" value={form.image_url} onChange={event => set('image_url', event.target.value)} placeholder="Cole a URL da imagem do produto"/></div></label>
              <label className="product-active-toggle"><input type="checkbox" checked={form.active} onChange={event => set('active', event.target.checked)}/><span><b>Produto disponível</b><small>Exibir este item para venda</small></span></label>
            </div>
          </section>
          {error && <div className="product-form-error" role="alert"><AlertTriangle size={15}/>{error}</div>}
          <footer className="product-form-footer"><span><em>*</em> Campo obrigatório</span><div><button type="button" className="product-cancel-button" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Salvando...' : <><Check size={15}/> {editing ? 'Salvar alterações' : 'Cadastrar produto'}</>}</button></div></footer>
        </form>
      </section>
    </div>}
    <ConfirmDialog open={Boolean(toDelete)} title="Excluir produto?" description="Pedidos antigos manterão os dados do item." confirmLabel="Excluir" busy={busy} onConfirm={remove} onClose={() => setToDelete(null)}/>
  </div>;
}

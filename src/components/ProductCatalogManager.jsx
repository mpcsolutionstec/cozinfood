import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Barcode, Box, Edit3, Image as ImageIcon, PackagePlus, Plus, Search, Trash2, X } from 'lucide-react';
import { useAuth } from './AuthGate';
import { supabase } from '../lib/supabaseClient';
import ConfirmDialog from './ConfirmDialog';

const initialCategories = [{ name: 'Refrigerantes', slug: 'refrigerantes', sort_order: 20 }, { name: 'Sucos', slug: 'sucos', sort_order: 21 }, { name: 'Chocolates', slug: 'chocolates', sort_order: 22 }, { name: 'Outros produtos', slug: 'outros-produtos', sort_order: 23 }];
const units = ['un', 'g', 'kg', 'ml', 'l', 'cx', 'pct'];
const sectors = [['bar', 'Bar'], ['cozinha', 'Cozinha'], ['forno_pizza', 'Forno de pizza']];
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const blank = () => ({ category_id: '', name: '', barcode: '', cost_price: '', sale_price: '', stock_quantity: '', min_stock: '5', unit_measure: 'un', destination_sector: 'bar', image_url: '', description: '', active: true });

export default function ProductCatalogManager() {
  const { profile } = useAuth(); const restaurantId = profile?.restaurant_id;
  const [products, setProducts] = useState([]); const [categories, setCategories] = useState([]); const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [editing, setEditing] = useState(null); const [form, setForm] = useState(blank); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [toDelete, setToDelete] = useState(null);
  const load = async () => {
    if (!restaurantId || !supabase) return;
    setLoading(true); setError('');
    const categoriesRequest = await supabase.from('categories').upsert(initialCategories.map(item => ({ ...item, restaurant_id: restaurantId, active: true })), { onConflict: 'restaurant_id,slug' }).select('id,name,slug,sort_order');
    const productRequest = await supabase.from('products').select('id,name,description,barcode,cost_price,sale_price,base_price,stock_quantity,min_stock,unit_measure,destination_sector,image_url,active,category_id,categories(name,slug)').eq('restaurant_id', restaurantId).order('name');
    const failure = categoriesRequest.error || productRequest.error;
    if (failure) setError(`Não foi possível carregar os produtos: ${failure.message}`); else { setCategories(categoriesRequest.data || []); setProducts(productRequest.data || []); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [restaurantId]);
  const visible = useMemo(() => products.filter(item => (filter === 'all' || item.category_id === filter) && `${item.name} ${item.barcode || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [products, filter, search]);
  const lowStock = products.filter(item => Number(item.stock_quantity) <= Number(item.min_stock));
  const edit = item => { setEditing(item); setForm({ category_id: item.category_id || '', name: item.name || '', barcode: item.barcode || '', cost_price: String(item.cost_price ?? 0), sale_price: String(item.sale_price ?? item.base_price ?? ''), stock_quantity: String(item.stock_quantity ?? 0), min_stock: String(item.min_stock ?? 5), unit_measure: item.unit_measure || 'un', destination_sector: item.destination_sector || 'bar', image_url: item.image_url || '', description: item.description || '', active: item.active }); setError(''); setOpen(true); };
  const create = () => { setEditing(null); setForm({ ...blank(), category_id: categories[0]?.id || '' }); setError(''); setOpen(true); };
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const save = async event => {
    event.preventDefault(); const sale = Number(form.sale_price); const cost = Number(form.cost_price || 0); const stock = Number(form.stock_quantity || 0); const minimum = Number(form.min_stock || 0);
    if (!form.name.trim() || !form.category_id) { setError('Informe o nome e a categoria do produto.'); return; }
    if (![sale, cost, stock, minimum].every(Number.isFinite) || Math.min(sale, cost, stock, minimum) < 0) { setError('Informe valores válidos, iguais ou maiores que zero.'); return; }
    setBusy(true); setError('');
    const values = { restaurant_id: restaurantId, category_id: form.category_id, name: form.name.trim(), barcode: form.barcode.trim() || null, cost_price: cost, sale_price: sale, base_price: sale, stock_quantity: stock, min_stock: minimum, unit_measure: form.unit_measure, destination_sector: form.destination_sector, image_url: form.image_url.trim() || null, description: form.description.trim() || null, active: form.active, accepts_fractions: false, prep_minutes: 0 };
    const request = editing ? supabase.from('products').update(values).eq('id', editing.id).eq('restaurant_id', restaurantId) : supabase.from('products').insert(values);
    const { error: saveError } = await request;
    if (saveError) setError(saveError.code === '23505' ? 'Já existe um produto com este código de barras.' : saveError.message); else { setOpen(false); setNotice(editing ? 'Produto atualizado.' : 'Produto cadastrado.'); await load(); }
    setBusy(false);
  };
  const remove = async () => { if (!toDelete) return; setBusy(true); const { error: removeError } = await supabase.from('products').delete().eq('id', toDelete.id).eq('restaurant_id', restaurantId); if (removeError) setError(removeError.message); else { setNotice(`${toDelete.name} foi excluído.`); await load(); } setBusy(false); setToDelete(null); };
  const margin = item => { const sale = Number(item.sale_price ?? item.base_price ?? 0); return sale ? ((sale - Number(item.cost_price || 0)) / sale) * 100 : 0; };
  return <>
    <h1>Cadastro de produtos</h1>
    <p>Refrigerantes, sucos, chocolates e itens para venda rápida.</p>
    <button className="primary" onClick={create}>Novo produto</button>
    {error && <p role="alert">{error}</p>}
    {notice && <p>{notice}</p>}
    <section className="product-summary"><span>{products.length} produtos</span><span>{lowStock.length} com estoque baixo</span></section>
    <section className="product-catalog-panel"><h2>Catálogo</h2>
    {visible.map(item => <article key={item.id}><b>{item.name}</b><span>{money(item.sale_price)}</span><span>{item.stock_quantity} {item.unit_measure}</span><button onClick={() => edit(item)}>Editar</button><button onClick={() => setToDelete(item)}>Excluir</button></article>)}
    <button onClick={create}>Cadastrar produto</button>
    {open && <form onSubmit={save} className="product-form">
      <input value={form.name} onChange={e => set('name',e.target.value)} placeholder="Nome do produto" required/>
      <input value={form.barcode} onChange={e => set('barcode',e.target.value)} placeholder="Código de barras"/>
      <input type="number" step="0.01" value={form.cost_price} onChange={e => set('cost_price',e.target.value)} placeholder="Custo"/>
      <input type="number" step="0.01" value={form.sale_price} onChange={e => set('sale_price',e.target.value)} placeholder="Venda" required/>
      <input type="number" step="0.01" value={form.stock_quantity} onChange={e => set('stock_quantity',e.target.value)} placeholder="Estoque"/>
      <input type="number" step="0.01" value={form.min_stock} onChange={e => set('min_stock',e.target.value)} placeholder="Mínimo"/>
      <select value={form.category_id} onChange={e => set('category_id',e.target.value)}>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select value={form.unit_measure} onChange={e => set('unit_measure',e.target.value)}>{units.map(unit => <option key={unit}>{unit}</option>)}</select>
      <select value={form.destination_sector} onChange={e => set('destination_sector',e.target.value)}>{sectors.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input value={form.image_url} onChange={e => set('image_url',e.target.value)} placeholder="URL da imagem"/>
      {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? 'Salvando...' : 'Salvar produto'}</button><button type="button" onClick={() => setOpen(false)}>Cancelar</button>
    </form>}
    </section>
    <ConfirmDialog open={Boolean(toDelete)} title={'Excluir produto?'} description={'Pedidos antigos manterão os dados do item.'} confirmLabel={'Excluir'} busy={busy} onConfirm={remove} onClose={() => setToDelete(null)}/>
  </>;
}

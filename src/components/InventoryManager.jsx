import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, ClipboardList, Edit3, MinusCircle, Plus, RefreshCw, Save, Trash2, TrendingDown, Warehouse } from 'lucide-react';
import { useAuth } from './AuthGate';
import { supabase } from '../lib/supabaseClient';
import ConfirmDialog from './ConfirmDialog';

const units = ['kg', 'g', 'l', 'ml', 'un'];
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quantity = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const convert = (value, from, to) => {
  if (from === to) return Number(value || 0);
  if (from === 'g' && to === 'kg') return Number(value || 0) / 1000;
  if (from === 'kg' && to === 'g') return Number(value || 0) * 1000;
  if (from === 'ml' && to === 'l') return Number(value || 0) / 1000;
  if (from === 'l' && to === 'ml') return Number(value || 0) * 1000;
  return null;
};
const blankIngredient = { name: '', unit: 'kg', quantity: '', minimum_quantity: '', cost_per_unit: '' };

export default function InventoryManager() {
  const { profile } = useAuth();
  const restaurantId = profile?.restaurant_id;
  const isAdmin = profile?.role === 'admin';
  const [section, setSection] = useState('stock');
  const [ingredients, setIngredients] = useState([]);
  const [products, setProducts] = useState([]);
  const [borders, setBorders] = useState([]);
  const [additions, setAdditions] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [restaurant, setRestaurant] = useState(null);
  const [marginDraft, setMarginDraft] = useState('60');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ingredientForm, setIngredientForm] = useState(blankIngredient);
  const [editingIngredient, setEditingIngredient] = useState(null);
  const [targetType, setTargetType] = useState('product');
  const [targetId, setTargetId] = useState('');
  const [fractionId, setFractionId] = useState('');
  const [recipeRows, setRecipeRows] = useState([]);
  const [additionForm, setAdditionForm] = useState({ name: '', price: '' });
  const [editingAddition, setEditingAddition] = useState(null);
  const [loss, setLoss] = useState({ ingredient_id: '', quantity: '', unit: '', reason: '' });
  const [confirmAction, setConfirmAction] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    if (!restaurantId) { setError('Não encontramos o restaurante desta conta.'); setLoading(false); return; }
    setLoading(true);
    const [stockResult, productResult, borderResult, additionResult, recipeResult, restaurantResult] = await Promise.all([
      supabase.from('ingredients_stock').select('*').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('products').select('id,name,base_price,active,categories(slug),product_fractions(id,name,serves,price,active)').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('pizza_borders').select('id,name,price,active').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('product_additions').select('id,name,price,active').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('recipes').select('id,product_id,product_fraction_id,pizza_border_id,addition_id,ingredient_id,quantity,unit,ingredients_stock(id,name,unit,cost_per_unit)'),
      supabase.from('restaurants').select('id,target_margin_percent').eq('id', restaurantId).single(),
    ]);
    const failed = [stockResult, productResult, borderResult, additionResult, recipeResult, restaurantResult].find(result => result.error);
    if (failed) setError(`Não foi possível carregar o estoque: ${failed.error.message}`);
    else {
      setIngredients(stockResult.data || []);
      setProducts(productResult.data || []);
      setBorders(borderResult.data || []);
      setAdditions(additionResult.data || []);
      setRecipes(recipeResult.data || []);
      setRestaurant(restaurantResult.data);
      setMarginDraft(String(restaurantResult.data.target_margin_percent ?? 60));
      setError('');
      if (!targetId && productResult.data?.length) setTargetId(productResult.data[0].id);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [restaurantId]);
  useEffect(() => {
    if (!restaurantId) return undefined;
    const channel = supabase.channel(`inventory-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients_stock', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        supabase.from('ingredients_stock').select('*').eq('restaurant_id', restaurantId).order('name').then(({ data }) => { if (data) setIngredients(data); });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [restaurantId]);

  const targetOptions = targetType === 'product' ? products : targetType === 'border' ? borders : additions;
  const selectedProduct = products.find(product => product.id === targetId);
  const selectedFraction = selectedProduct?.product_fractions?.find(fraction => fraction.id === fractionId);
  const selectedTarget = targetOptions.find(option => option.id === targetId);
  const currentRecipes = useMemo(() => recipes.filter(recipe => targetType === 'product'
    ? recipe.product_id === targetId && (recipe.product_fraction_id || '') === fractionId
    : targetType === 'border' ? recipe.pizza_border_id === targetId : recipe.addition_id === targetId), [recipes, targetType, targetId, fractionId]);

  useEffect(() => {
    setRecipeRows(currentRecipes.map(recipe => ({ ingredient_id: recipe.ingredient_id, quantity: String(recipe.quantity), unit: recipe.unit })));
  }, [currentRecipes]);

  const recipeCost = useMemo(() => recipeRows.reduce((total, row) => {
    const ingredient = ingredients.find(item => item.id === row.ingredient_id);
    if (!ingredient || !row.quantity) return total;
    const normalized = convert(row.quantity, row.unit, ingredient.unit);
    return total + (normalized === null ? 0 : normalized * Number(ingredient.cost_per_unit || 0));
  }, 0), [recipeRows, ingredients]);
  const salePrice = targetType === 'product'
    ? Number(selectedFraction?.price ?? selectedProduct?.base_price ?? 0)
    : Number(selectedTarget?.price || 0);
  const margin = salePrice > 0 ? ((salePrice - recipeCost) / salePrice) * 100 : 0;
  const lowStock = ingredients.filter(item => Number(item.quantity) <= Number(item.minimum_quantity));

  const saveIngredient = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = { restaurant_id: restaurantId, name: ingredientForm.name.trim(), unit: ingredientForm.unit, minimum_quantity: Number(ingredientForm.minimum_quantity), cost_per_unit: Number(ingredientForm.cost_per_unit) };
    const query = editingIngredient
      ? supabase.from('ingredients_stock').update(values).eq('id', editingIngredient.id).eq('restaurant_id', restaurantId)
      : supabase.from('ingredients_stock').insert({ ...values, quantity: Number(ingredientForm.quantity) });
    const { error: saveError } = await query;
    if (saveError) setError(`Não foi possível salvar o insumo: ${saveError.message}`);
    else {
      if (editingIngredient && Number(ingredientForm.quantity) !== Number(editingIngredient.quantity)) {
        const delta = Number(ingredientForm.quantity) - Number(editingIngredient.quantity);
        const { error: movementError } = await supabase.rpc('record_stock_movement', { p_ingredient_id: editingIngredient.id, p_quantity_delta: delta, p_reason: 'Ajuste manual de inventário' });
        if (movementError) { setError(`Os dados foram salvos, mas o ajuste de saldo falhou: ${movementError.message}`); setBusy(false); await load(); return; }
      }
      setIngredientForm(blankIngredient); setEditingIngredient(null); setNotice(editingIngredient ? 'Insumo atualizado.' : 'Insumo cadastrado.'); await load();
    }
    setBusy(false);
  };
  const editIngredient = item => { setEditingIngredient(item); setIngredientForm({ name: item.name, unit: item.unit, quantity: String(item.quantity), minimum_quantity: String(item.minimum_quantity), cost_per_unit: String(item.cost_per_unit) }); };
  const deleteIngredient = item => setConfirmAction({ type: 'ingredient', item });

  const saveRecipes = async event => {
    event.preventDefault(); setBusy(true); setError('');
    const { error: saveError } = await supabase.rpc('save_inventory_recipe', {
      p_target_type: targetType, p_target_id: targetId, p_product_fraction_id: targetType === 'product' ? fractionId || null : null,
      p_rows: recipeRows.filter(row => row.ingredient_id && Number(row.quantity) > 0).map(row => ({ ingredient_id: row.ingredient_id, quantity: Number(row.quantity), unit: row.unit })),
    });
    if (saveError) setError(`Não foi possível salvar a ficha técnica: ${saveError.message}`);
    else { setNotice('Ficha técnica salva.'); await load(); }
    setBusy(false);
  };
  const saveMargin = async () => {
    if (marginDraft === '') return;
    const value = Number(marginDraft);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    const { error: saveError } = await supabase.from('restaurants').update({ target_margin_percent: value }).eq('id', restaurantId);
    if (saveError) setError(`Não foi possível salvar a margem mínima: ${saveError.message}`);
    else { setRestaurant(current => ({ ...current, target_margin_percent: value })); setNotice('Meta de margem atualizada.'); }
  };
  const saveAddition = async event => {
    event.preventDefault();
    const query = editingAddition
      ? supabase.from('product_additions').update({ name: additionForm.name.trim(), price: Number(additionForm.price || 0) }).eq('id', editingAddition.id).eq('restaurant_id', restaurantId)
      : supabase.from('product_additions').insert({ restaurant_id: restaurantId, name: additionForm.name.trim(), price: Number(additionForm.price || 0) });
    const { error: saveError } = await query;
    if (saveError) setError(`Não foi possível salvar o adicional: ${saveError.message}`); else { setAdditionForm({ name: '', price: '' }); setNotice(editingAddition ? 'Adicional atualizado.' : 'Adicional cadastrado. Agora você pode criar a ficha técnica dele.'); setEditingAddition(null); await load(); }
  };
  const editAddition = item => { setEditingAddition(item); setAdditionForm({ name: item.name, price: String(item.price) }); };
  const deleteAddition = item => setConfirmAction({ type: 'addition', item });
  const confirmDelete = async () => {
    if (!confirmAction) return;
    setDeleting(true);
    const table = confirmAction.type === 'ingredient' ? 'ingredients_stock' : 'product_additions';
    const { error: deleteError } = await supabase.from(table).delete().eq('id', confirmAction.item.id).eq('restaurant_id', restaurantId);
    if (deleteError) setError(`Não foi possível excluir: ${deleteError.message}`);
    else {
      setNotice(confirmAction.type === 'ingredient' ? 'Insumo excluído.' : 'Adicional excluído.');
      await load();
    }
    setDeleting(false);
    setConfirmAction(null);
  };
  const registerLoss = async event => {
    event.preventDefault(); const ingredient = ingredients.find(item => item.id === loss.ingredient_id);
    const amount = convert(loss.quantity, loss.unit, ingredient?.unit);
    if (!ingredient || amount === null || Number(amount) <= 0) { setError('Unidades incompatíveis ou quantidade inválida.'); return; }
    setBusy(true);
    const { error: lossError } = await supabase.rpc('record_stock_movement', { p_ingredient_id: ingredient.id, p_quantity_delta: -Number(amount), p_reason: loss.reason.trim() });
    if (lossError) setError(`Não foi possível registrar a perda: ${lossError.message}`);
    else { setLoss({ ingredient_id: ingredient.id, quantity: '', unit: ingredient.unit, reason: '' }); setNotice('Perda registrada e saldo atualizado.'); await load(); }
    setBusy(false);
  };

  const addRecipeRow = () => setRecipeRows(rows => [...rows, { ingredient_id: '', quantity: '', unit: ingredients[0]?.unit || 'g' }]);
  const updateRecipeRow = (index, field, value) => setRecipeRows(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  const removeRecipeRow = index => setRecipeRows(rows => rows.filter((_, rowIndex) => rowIndex !== index));

  return <>
    <div className="page-heading inventory-heading"><div><h1>Estoque e fichas técnicas</h1><p>Insumos, custos de produção, perdas e alertas de reposição em tempo real.</p></div><span className="inventory-live"><i/> {loading ? 'Sincronizando' : 'Estoque ao vivo'}</span></div>
    {error && <div className="inventory-message error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {notice && <div className="inventory-message success" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <ConfirmDialog open={Boolean(confirmAction)} title={confirmAction?.type === 'ingredient' ? `Excluir insumo “${confirmAction.item.name}”?` : `Excluir adicional “${confirmAction?.item.name || ''}”?`} description={confirmAction?.type === 'ingredient' ? 'Insumos usados em fichas técnicas não podem ser excluídos. O sistema vai verificar os vínculos antes de remover.' : 'Este adicional será removido do cadastro do restaurante.'} confirmLabel="Confirmar exclusão" busy={deleting} onConfirm={confirmDelete} onClose={() => { if (!deleting) setConfirmAction(null); }}/>
    {lowStock.length > 0 && <section className="inventory-alert"><AlertTriangle size={18}/><div><b>{lowStock.length} alerta(s) de reposição</b><span>{lowStock.map(item => `${item.name}: ${quantity(item.quantity)} ${item.unit} (mín. ${quantity(item.minimum_quantity)} ${item.unit})`).join(' · ')}</span></div><BellRing size={16}/></section>}
    <nav className="inventory-tabs"><button className={section === 'stock' ? 'active' : ''} onClick={() => setSection('stock')}><Warehouse size={15}/> Insumos</button><button className={section === 'recipes' ? 'active' : ''} onClick={() => setSection('recipes')}><ClipboardList size={15}/> Fichas e custos</button><button className={section === 'losses' ? 'active' : ''} onClick={() => setSection('losses')}><TrendingDown size={15}/> Perdas e descarte</button><button className="inventory-refresh" onClick={load} aria-label="Atualizar"><RefreshCw size={14}/></button></nav>
    {loading ? <div className="inventory-loading">Carregando dados do estoque...</div> : section === 'stock' ? <div className="inventory-layout">
      <section className="panel inventory-form-panel"><header><div><span className="inventory-icon"><Plus size={17}/></span><h2>{editingIngredient ? 'Editar insumo' : 'Cadastro rápido de insumo'}</h2></div><p>Cadastre saldo, unidade, estoque mínimo e custo de compra por unidade.</p></header>
        {isAdmin ? <form onSubmit={saveIngredient} className="inventory-form"><label>Nome do ingrediente<input value={ingredientForm.name} onChange={e => setIngredientForm({ ...ingredientForm, name: e.target.value })} placeholder="Ex.: Mussarela" required maxLength={100}/></label><div className="inventory-form-row"><label>Unidade<select value={ingredientForm.unit} disabled={Boolean(editingIngredient)} onChange={e => setIngredientForm({ ...ingredientForm, unit: e.target.value })}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label><label>Saldo atual<input type="number" min="0" step="0.001" value={ingredientForm.quantity} onChange={e => setIngredientForm({ ...ingredientForm, quantity: e.target.value })} placeholder="0" required/></label></div><div className="inventory-form-row"><label>Estoque mínimo<input type="number" min="0" step="0.001" value={ingredientForm.minimum_quantity} onChange={e => setIngredientForm({ ...ingredientForm, minimum_quantity: e.target.value })} placeholder="0" required/></label><label>Custo por {ingredientForm.unit}<span className="inventory-currency"><i>R$</i><input type="number" min="0" step="0.0001" value={ingredientForm.cost_per_unit} onChange={e => setIngredientForm({ ...ingredientForm, cost_per_unit: e.target.value })} placeholder="0,00" required/></span></label></div><footer><button type="button" className="inventory-cancel" onClick={() => { setIngredientForm(blankIngredient); setEditingIngredient(null); }}>Limpar</button><button className="primary" disabled={busy}><Save size={14}/>{busy ? 'Salvando...' : editingIngredient ? 'Salvar alteração' : 'Cadastrar insumo'}</button></footer></form> : <p className="inventory-readonly">Seu perfil pode consultar o estoque. Um administrador pode cadastrar e editar insumos.</p>}
      </section>
      <section className="panel inventory-list-panel"><header><div><h2>Saldo dos insumos</h2><p>{ingredients.length} ingrediente(s) cadastrado(s)</p></div></header>{ingredients.length ? <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Ingrediente</th><th>Saldo / Mínimo</th><th>Custo unitário</th><th>Valor em estoque</th><th/></tr></thead><tbody>{ingredients.map(item => { const low = Number(item.quantity) <= Number(item.minimum_quantity); return <tr key={item.id}><td><b>{item.name}</b><small>{item.unit}</small></td><td><span className={low ? 'stock-quantity low' : 'stock-quantity'}>{quantity(item.quantity)} {item.unit}</span><small>Mínimo {quantity(item.minimum_quantity)} {item.unit}</small></td><td>{money(item.cost_per_unit)} / {item.unit}</td><td>{money(Number(item.quantity) * Number(item.cost_per_unit))}</td><td>{isAdmin && <><button className="inventory-icon-button" onClick={() => editIngredient(item)} aria-label={`Editar ${item.name}`}><Edit3 size={14}/></button><button className="inventory-icon-button danger" onClick={() => deleteIngredient(item)} aria-label={`Excluir ${item.name}`}><Trash2 size={14}/></button></>}</td></tr>; })}</tbody></table></div> : <div className="inventory-empty">Cadastre o primeiro insumo para iniciar o controle de estoque.</div>}</section>
    </div> : section === 'recipes' ? <div className="inventory-recipes-layout">
      <section className="panel recipe-editor"><header><div><span className="inventory-icon"><ClipboardList size={17}/></span><h2>Ficha técnica por item vendido</h2></div><p>Escolha o sabor e o tamanho; a baixa considera a fração proporcional de cada sabor.</p></header>
        <div className="recipe-target-selectors"><label>Tipo<select value={targetType} onChange={e => { const type = e.target.value; setTargetType(type); setFractionId(''); const options = type === 'product' ? products : type === 'border' ? borders : additions; setTargetId(options[0]?.id || ''); }}><option value="product">Sabor de pizza ou esfiha</option><option value="border">Borda recheada</option><option value="addition">Adicional</option></select></label><label>Item<select value={targetId} onChange={e => { setTargetId(e.target.value); setFractionId(''); }}><option value="">Selecione</option>{targetOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{targetType === 'product' && <label>Tamanho<select value={fractionId} onChange={e => setFractionId(e.target.value)}><option value="">Ficha genérica (sem tamanho)</option>{selectedProduct?.product_fractions?.map(fraction => <option value={fraction.id} key={fraction.id}>{fraction.name}{fraction.active ? '' : ' (inativo)'}</option>)}</select></label>}</div>
        <form onSubmit={saveRecipes}><div className="recipe-lines-heading"><b>Insumos por {targetType === 'product' ? 'produto/tamanho' : 'unidade do item'}</b><button type="button" className="inventory-secondary" onClick={addRecipeRow} disabled={!ingredients.length}><Plus size={13}/> Adicionar insumo</button></div>{recipeRows.length ? <div className="recipe-lines">{recipeRows.map((row, index) => <div className="recipe-line" key={`${index}-${row.ingredient_id}`}><select aria-label="Ingrediente" value={row.ingredient_id} onChange={e => { const ingredient = ingredients.find(item => item.id === e.target.value); setRecipeRows(rows => rows.map((current, rowIndex) => rowIndex === index ? { ...current, ingredient_id: e.target.value, unit: ingredient?.unit || current.unit } : current)); }} required><option value="">Ingrediente</option>{ingredients.map(item => <option value={item.id} key={item.id}>{item.name} · {money(item.cost_per_unit)}/{item.unit}</option>)}</select><input aria-label="Quantidade da receita" type="number" min="0.001" step="0.001" value={row.quantity} onChange={e => updateRecipeRow(index, 'quantity', e.target.value)} placeholder="Quantidade" required/><select aria-label="Unidade da receita" value={row.unit} onChange={e => updateRecipeRow(index, 'unit', e.target.value)}>{units.map(unit => <option key={unit}>{unit}</option>)}</select><button type="button" className="inventory-icon-button danger" onClick={() => removeRecipeRow(index)} aria-label="Remover ingrediente"><Trash2 size={14}/></button></div>)}</div> : <div className="inventory-empty">Nenhum ingrediente nesta ficha. Adicione os insumos e quantidades necessários.</div>}
          <div className="recipe-cost-card"><div><small>CUSTO DE PRODUÇÃO</small><b>{money(recipeCost)}</b></div><div><small>PREÇO DE VENDA</small><b>{money(salePrice)}</b></div><div className={salePrice > 0 && margin < Number(restaurant?.target_margin_percent || 60) ? 'margin-warning' : 'margin-good'}><small>MARGEM BRUTA ESTIMADA</small><b>{salePrice > 0 ? `${margin.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</b></div></div>
          {salePrice > 0 && margin < Number(restaurant?.target_margin_percent || 60) && <div className="margin-alert"><AlertTriangle size={15}/> Margem abaixo da meta configurada. Revise o preço de venda ou os custos dos insumos.</div>}
          {isAdmin && <footer className="recipe-save-footer"><label>Meta mínima de margem (%)<input type="number" min="0" max="100" step="1" value={marginDraft} onChange={event => setMarginDraft(event.target.value)} onBlur={saveMargin}/></label><button className="primary" disabled={busy || !targetId}><Save size={14}/>{busy ? 'Salvando...' : 'Salvar ficha técnica'}</button></footer>}
        </form>
      </section>
      <aside className="panel additions-panel"><header><div><span className="inventory-icon"><Plus size={17}/></span><h2>Adicionais</h2></div><p>Adicionais e bordas têm ficha técnica própria.</p></header>{isAdmin && <form className="addition-form" onSubmit={saveAddition}><input value={additionForm.name} onChange={e => setAdditionForm({ ...additionForm, name: e.target.value })} placeholder="Ex.: Extra mussarela" required maxLength="80"/><span className="inventory-currency"><i>R$</i><input type="number" min="0" step="0.01" value={additionForm.price} onChange={e => setAdditionForm({ ...additionForm, price: e.target.value })} placeholder="Preço" required/></span><button className="primary" aria-label={editingAddition ? 'Salvar adicional' : 'Cadastrar adicional'}>{editingAddition ? <Save size={14}/> : <Plus size={14}/>}</button></form>}<div className="addition-list">{additions.map(item => <div key={item.id}><span>{item.name}<small>{item.active ? 'Ativo' : 'Inativo'}</small></span><b>{money(item.price)}</b>{isAdmin && <><button onClick={() => editAddition(item)} aria-label={`Editar ${item.name}`}><Edit3 size={13}/></button><button onClick={() => deleteAddition(item)} aria-label={`Excluir ${item.name}`}><Trash2 size={13}/></button></>}</div>)}{!additions.length && <p className="inventory-empty">Cadastre adicionais para incluir uma ficha técnica para cada um.</p>}</div><div className="border-note"><b>Bordas cadastradas</b>{borders.length ? borders.map(border => <span key={border.id}>{border.name}<small>{money(border.price)}</small></span>) : <small>Cadastre bordas na página Pizzas e esfihas.</small>}</div></aside>
    </div> : <div className="inventory-loss-layout"><section className="panel loss-form-panel"><header><div><span className="inventory-icon"><MinusCircle size={17}/></span><h2>Registrar perda ou descarte</h2></div><p>A baixa fica registrada no histórico e atualiza o saldo do estoque.</p></header>{isAdmin ? <form onSubmit={registerLoss} className="inventory-form"><label>Insumo<select value={loss.ingredient_id} onChange={e => { const ingredient = ingredients.find(item => item.id === e.target.value); setLoss({ ...loss, ingredient_id: e.target.value, unit: ingredient?.unit || '' }); }} required><option value="">Selecione um insumo</option>{ingredients.map(item => <option value={item.id} key={item.id}>{item.name} · saldo {quantity(item.quantity)} {item.unit}</option>)}</select></label><div className="inventory-form-row"><label>Quantidade perdida<input type="number" min="0.001" step="0.001" value={loss.quantity} onChange={e => setLoss({ ...loss, quantity: e.target.value })} placeholder="0" required/></label><label>Unidade<select value={loss.unit} onChange={e => setLoss({ ...loss, unit: e.target.value })}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label></div><label>Motivo<input value={loss.reason} onChange={e => setLoss({ ...loss, reason: e.target.value })} placeholder="Ex.: massa queimada no forno" minLength={3} required/></label><button className="primary" disabled={busy}><TrendingDown size={14}/>{busy ? 'Registrando...' : 'Registrar perda'}</button></form> : <p className="inventory-readonly">Somente administrador pode registrar perdas.</p>}</section><section className="panel loss-history-panel"><header><div><h2>Últimos movimentos</h2><p>Perdas e baixas de pedidos recentes</p></div></header><MovementHistory restaurantId={restaurantId}/></section></div>}
  </>;
}

function MovementHistory({ restaurantId }) {
  const [movements, setMovements] = useState([]);
  useEffect(() => {
    let active = true;
    const refresh = () => supabase.from('stock_movements').select('id,quantity_delta,reason,created_at,ingredients_stock(name,unit)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(40).then(({ data }) => { if (active && data) setMovements(data); });
    refresh();
    const channel = supabase.channel(`stock-movements-${restaurantId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_movements', filter: `restaurant_id=eq.${restaurantId}` }, refresh).subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [restaurantId]);
  return movements.length ? <div className="movement-list">{movements.map(item => <div key={item.id}><span className={Number(item.quantity_delta) < 0 ? 'movement-down' : 'movement-up'}>{Number(item.quantity_delta) < 0 ? '−' : '+'}{quantity(Math.abs(item.quantity_delta))} {item.ingredients_stock?.unit}</span><div><b>{item.ingredients_stock?.name}</b><small>{item.reason}</small></div><time>{new Date(item.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time></div>)}</div> : <div className="inventory-empty">Ainda não há movimentos de estoque.</div>;
}

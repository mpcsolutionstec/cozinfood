import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sizeKey = fraction => fraction?.name ? `name:${fraction.name}` : `serves:${fraction?.serves || ''}`;
const fractionForSize = (product, selectedFraction) => (product.fractions || product.product_fractions || [])
  .find(fraction => sizeKey(fraction) === sizeKey(selectedFraction));

export default function PizzaFlavorPicker({ products, product, fraction, borders = [], additions = [], fractionPricing = 'maior_valor', onCancel, onConfirm }) {
  const pizzas = useMemo(() => products.filter(item => item.categories?.slug === 'pizzas'), [products]);
  const initialFlavorCount = Math.min(2, pizzas.filter(item => fractionForSize(item, fraction)).length || 1);
  const [fractionId, setFractionId] = useState(fraction.id);
  const [flavorCount, setFlavorCount] = useState(initialFlavorCount);
  const [flavorIds, setFlavorIds] = useState([product.id]);
  const [borderId, setBorderId] = useState('');
  const [additionIds, setAdditionIds] = useState([]);
  const selectedFraction = (product.fractions || product.product_fractions || []).find(item => item.id === fractionId) || fraction;
  const eligibleFlavors = useMemo(() => pizzas.filter(item => fractionForSize(item, selectedFraction)), [pizzas, selectedFraction]);
  const selectedFlavors = flavorIds.map(id => eligibleFlavors.find(item => item.id === id)).filter(Boolean);
  const flavorPrice = selectedFlavors.map(item => Number(fractionForSize(item, selectedFraction)?.price || 0));
  const calculatedPrice = flavorPrice.length
    ? fractionPricing === 'media_ponderada'
      ? flavorPrice.reduce((sum, price) => sum + price, 0) / flavorPrice.length
      : Math.max(...flavorPrice)
    : Number(selectedFraction?.price || 0);
  const selectedBorder = borders.find(item => item.id === borderId) || null;
  const selectedAdditions = additions.filter(item => additionIds.includes(item.id));
  const unitPrice = Math.round((calculatedPrice + Number(selectedBorder?.price || 0) + selectedAdditions.reduce((sum, item) => sum + Number(item.price || 0), 0)) * 100) / 100;
  const fractionLabel = selectedFlavors.length
    ? `${selectedFraction.name} · ${selectedFlavors.map(item => `${Math.round(100 / flavorCount)}% ${item.name}`).join(' / ')}`
    : selectedFraction?.name || '';

  const changeFraction = id => {
    const nextFraction = (product.fractions || product.product_fractions || []).find(item => item.id === id);
    const nextEligible = pizzas.filter(item => fractionForSize(item, nextFraction));
    setFractionId(id);
    setFlavorIds(current => {
      const valid = current.filter(flavorId => nextEligible.some(item => item.id === flavorId));
      return valid.length ? valid : [nextEligible[0]?.id || product.id];
    });
    setFlavorCount(current => Math.min(current, nextEligible.length || 1));
  };

  const toggleFlavor = (id, checked) => setFlavorIds(current => checked
    ? current.length < flavorCount ? [...current, id] : current
    : current.filter(item => item !== id));

  const confirm = event => {
    event.preventDefault();
    if (selectedFlavors.length !== flavorCount || !selectedFraction) return;
    onConfirm({
      product,
      fraction: selectedFraction,
      flavors: selectedFlavors.map(item => ({
        product: item,
        fraction: fractionForSize(item, selectedFraction),
        share: 1 / flavorCount,
      })),
      border: selectedBorder,
      additions: selectedAdditions.map(item => ({ ...item, quantity: 1 })),
      unitPrice,
      fractionLabel,
    });
  };

  return <div className="public-pizza-picker-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="public-pizza-picker" role="dialog" aria-modal="true" aria-labelledby="public-pizza-picker-title" onSubmit={confirm}>
      <button type="button" className="public-pizza-picker-close" onClick={onCancel} aria-label="Fechar"><X size={19}/></button>
      <span className="public-pizza-picker-kicker">PERSONALIZE SUA PIZZA</span>
      <h2 id="public-pizza-picker-title">{product.name}</h2>
      <label className="public-pizza-picker-field">Tamanho
        <select value={fractionId} onChange={event => changeFraction(event.target.value)}>
          {(product.fractions || product.product_fractions || []).map(item => <option key={item.id} value={item.id}>{item.name}{item.serves > 1 ? ` · serve ${item.serves}` : ''}</option>)}
        </select>
      </label>
      <label className="public-pizza-picker-field">Quantos sabores?
        <select value={flavorCount} onChange={event => { const count = Number(event.target.value); setFlavorCount(count); setFlavorIds(current => current.slice(0, count)); }}>
          {Array.from({ length: Math.min(4, eligibleFlavors.length || 1) }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count} {count === 1 ? 'sabor' : 'sabores'}</option>)}
        </select>
      </label>
      <fieldset className="public-pizza-flavor-list">
        <legend>Escolha {flavorCount} {flavorCount === 1 ? 'sabor' : 'sabores'} ({selectedFlavors.length}/{flavorCount})</legend>
        {eligibleFlavors.map(item => {
          const flavorFraction = fractionForSize(item, selectedFraction);
          return <label key={item.id}>
            <input type="checkbox" checked={flavorIds.includes(item.id)} disabled={!flavorIds.includes(item.id) && flavorIds.length >= flavorCount} onChange={event => toggleFlavor(item.id, event.target.checked)}/>
            <span>{item.name}</span><small>{money(flavorFraction?.price)}</small>
          </label>;
        })}
        {!eligibleFlavors.length && <p>Nenhum sabor disponível para este tamanho.</p>}
      </fieldset>
      {borders.length > 0 && <label className="public-pizza-picker-field">Borda recheada
        <select value={borderId} onChange={event => setBorderId(event.target.value)}><option value="">Sem borda</option>{borders.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.price)}</option>)}</select>
      </label>}
      {additions.length > 0 && <fieldset className="public-pizza-flavor-list public-pizza-additions"><legend>Adicionais</legend>
        {additions.map(item => <label key={item.id}><input type="checkbox" checked={additionIds.includes(item.id)} onChange={event => setAdditionIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/><span>{item.name}</span><small>+ {money(item.price)}</small></label>)}
      </fieldset>}
      <div className="public-pizza-picker-summary"><span>{fractionLabel || 'Selecione os sabores'}</span><b>{money(unitPrice)}</b></div>
      <button type="submit" className="public-pizza-picker-confirm" disabled={selectedFlavors.length !== flavorCount}><Check size={18}/> Adicionar ao pedido</button>
    </form>
  </div>;
}

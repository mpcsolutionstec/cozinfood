import { useEffect, useState } from 'react';

export default function QuantityControl({ value = 0, onChange, label, className = '' }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = raw => {
    if (!/^\d*$/.test(raw)) return;
    setDraft(raw);
    if (raw !== '') onChange(Math.min(99, Number(raw)));
  };

  const adjust = amount => {
    const current = draft === '' ? Number(value) || 0 : Number(draft);
    const next = Math.min(99, Math.max(0, current + amount));
    setDraft(String(next));
    onChange(next);
  };

  const finishEditing = () => {
    const next = draft === '' ? 0 : Math.min(99, Math.max(0, Number(draft) || 0));
    setDraft(String(next));
    onChange(next);
  };

  return <div className={`quantity-control ${className}`} role="group" aria-label={label}>
    <button type="button" onClick={() => adjust(-1)} aria-label={`Diminuir ${label}`}>−</button>
    <input type="text" inputMode="numeric" pattern="[0-9]*" value={draft} onChange={event => commit(event.target.value)} onBlur={finishEditing} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} aria-label={`Quantidade de ${label}`} />
    <button type="button" onClick={() => adjust(1)} aria-label={`Aumentar ${label}`}>+</button>
  </div>;
}

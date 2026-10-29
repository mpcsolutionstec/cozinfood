import { useEffect } from 'react';
import { AlertTriangle, LoaderCircle, Trash2, X } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Excluir',
  busy = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;
  return <div className="confirm-dialog-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description">
      <button className="confirm-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={18}/></button>
      <span className="confirm-dialog-icon"><AlertTriangle size={24}/></span>
      <h2 id="confirm-dialog-title">{title}</h2>
      <p id="confirm-dialog-description">{description}</p>
      <footer>
        <button type="button" className="confirm-dialog-cancel" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="confirm-dialog-confirm" onClick={onConfirm} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="confirm-dialog-spinner"/> : <Trash2 size={16}/>}
          {busy ? 'Excluindo...' : confirmLabel}
        </button>
      </footer>
    </section>
  </div>;
}

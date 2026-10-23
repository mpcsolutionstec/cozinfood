import { useMemo, useState } from 'react';
import { Armchair, Check, Pencil, Plus, QrCode, ShoppingBasket, Trash2, Users, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from './AuthGate';
import { supabase } from '../lib/supabaseClient';
import TableService from './TableService';

const tableTypes = [
  { key: 'round_2', name: 'Redonda', seats: '2 lugares', image: 'mesa-redonda-2.svg' },
  { key: 'square_4', name: 'Quadrada', seats: '4 lugares', image: 'mesa-quadrada-4.svg' },
  { key: 'rectangle_6', name: 'Retangular', seats: '6 lugares', image: 'mesa-retangular-6.svg' },
  { key: 'rectangle_8', name: 'Retangular grande', seats: '8 lugares', image: 'mesa-retangular-8.svg' },
];

const statuses = [
  { key: 'livre', label: 'Livre' },
  { key: 'ocupada', label: 'Ocupada' },
  { key: 'aguardando_conta', label: 'Aguardando conta' },
  { key: 'reservada', label: 'Reservada' },
];
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const emptyForm = { number: '', capacity: 4, status: 'livre', image_key: 'square_4' };

export default function TablesManager({ tables, loading, loadError, refresh }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [serviceTable, setServiceTable] = useState(null);
  const [qrTable, setQrTable] = useState(null);
  const [copiedQr, setCopiedQr] = useState(false);

  const counts = useMemo(() => ({
    livre: tables.filter(table => table.status === 'livre').length,
    ocupada: tables.filter(table => table.status === 'ocupada').length,
    aguardando_conta: tables.filter(table => table.status === 'aguardando_conta').length,
    reservada: tables.filter(table => table.status === 'reservada').length,
  }), [tables]);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm, number: String((tables.at(-1)?.number || 0) + 1) });
    setFormError('');
    setDialog(true);
  };

  const openEdit = table => {
    setEditingId(table.id);
    setForm({ number: String(table.number), capacity: table.capacity || 4, status: table.status, image_key: table.image_key || 'square_4' });
    setFormError('');
    setDialog(true);
  };

  const saveTable = async event => {
    event.preventDefault();
    setFormError('');
    setNotice('');
    if (!profile?.restaurant_id) {
      setFormError('Não encontramos o restaurante vinculado ao seu perfil. Entre novamente e tente outra vez.');
      return;
    }
    const number = Number(form.number);
    const capacity = Number(form.capacity);
    if (!Number.isInteger(number) || number < 1) {
      setFormError('Informe um número de mesa inteiro, a partir de 1.');
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 30) {
      setFormError('A capacidade precisa ficar entre 1 e 30 lugares.');
      return;
    }

    setSaving(true);
    const values = { number, capacity, status: form.status, image_key: form.image_key };
    const request = editingId
      ? supabase.from('tables').update(values).eq('id', editingId).eq('restaurant_id', profile.restaurant_id)
      : supabase.from('tables').insert({ ...values, restaurant_id: profile.restaurant_id });
    const { error: saveError } = await request;
    if (saveError) {
      setFormError(saveError.code === '23505'
        ? `A mesa ${number} já está cadastrada neste restaurante.`
        : `Não foi possível salvar a mesa: ${saveError.message}`);
      setSaving(false);
      return;
    }
    await refresh();
    setSaving(false);
    setDialog(false);
    setNotice(editingId ? `Mesa ${number} atualizada.` : `Mesa ${number} cadastrada.`);
  };

  const deleteTable = async table => {
    if (table.status === 'ocupada' || table.status === 'aguardando_conta') {
      setNotice('Finalize a comanda antes de excluir esta mesa.');
      return;
    }
    const confirmed = window.confirm(`Excluir a mesa ${table.number}? Pedidos antigos deixarão de apontar para ela.`);
    if (!confirmed) return;
    setNotice('');
    const { error: deleteError } = await supabase
      .from('tables')
      .delete()
      .eq('id', table.id)
      .eq('restaurant_id', profile.restaurant_id);
    if (deleteError) {
      setNotice(`Não foi possível excluir a mesa: ${deleteError.message}`);
      return;
    }
    await refresh();
    setNotice(`Mesa ${table.number} excluída.`);
  };

  const qrMenuUrl = table => {
    const url = new URL(import.meta.env.BASE_URL, window.location.origin);
    url.searchParams.set('mesa', table.qr_token);
    return url.toString();
  };
  const copyQrLink = async table => {
    try {
      await navigator.clipboard.writeText(qrMenuUrl(table));
      setCopiedQr(true);
      window.setTimeout(() => setCopiedQr(false), 2200);
    } catch {
      setNotice('Não foi possível copiar automaticamente. Selecione o endereço do QR Code para copiar.');
    }
  };

  return <>
    <div className="page-heading tables-heading">
      <div><h1>Salão e mesas</h1><p>Cadastre o salão e acompanhe a situação das mesas em tempo real.</p></div>
      {isAdmin && <button className="primary" onClick={openNew}><Plus size={15}/> Nova mesa</button>}
    </div>

    <div className="table-status-summary">
      {statuses.map(status => <div className="table-summary-card" key={status.key}>
        <span className={`table-summary-dot ${status.key}`}/><span>{status.label}</span><b>{counts[status.key] || 0}</b>
      </div>)}
      <div className="table-summary-total"><b>{tables.length}</b><span>mesas no salão</span></div>
    </div>

    {notice && <div className="table-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15}/></button></div>}
    {loadError && <div className="table-error" role="alert">Falha ao carregar as mesas: {loadError}<button onClick={refresh}>Tentar novamente</button></div>}
    {loading ? <div className="table-loading"><span className="auth-spinner"/>Carregando mesas...</div> : tables.length === 0 ? <section className="panel table-empty">
      <div className="table-empty-icon"><Armchair size={27}/></div><h2>Seu salão ainda não tem mesas</h2>
      <p>Cadastre a primeira mesa, defina quantos lugares ela tem e escolha uma imagem para o mapa.</p>
      {isAdmin && <button className="primary" onClick={openNew}><Plus size={15}/> Cadastrar primeira mesa</button>}
    </section> : <div className="managed-table-grid">
      {tables.map(table => {
        const image = tableTypes.find(type => type.key === table.image_key) || tableTypes[1];
        const status = statuses.find(item => item.key === table.status) || statuses[0];
        return <article className={`managed-table-card ${table.status}`} key={table.id}>
          <div className="managed-table-image"><img src={`${import.meta.env.BASE_URL}table-images/${image.image}`} alt={`Ilustração de mesa ${image.name.toLowerCase()}`}/>
            <span className={`table-status-pill ${table.status}`}>{status.label}</span>
          </div>
          <div className="managed-table-info"><div><h2>Mesa {table.number}</h2><span><Users size={13}/> {table.capacity} lugares · {image.name}</span></div>
            <strong className={Number(table.current_total) > 0 ? 'has-balance' : ''}>{money(table.current_total)}</strong>
          </div>
          <div className="managed-table-actions"><button className="table-service-action" onClick={() => setServiceTable(table)}><ShoppingBasket size={14}/> Atender</button><button className="table-qr-action" onClick={() => { setQrTable(table); setCopiedQr(false); }}><QrCode size={14}/> QR Code</button>{isAdmin && <><button onClick={() => openEdit(table)}><Pencil size={14}/> Editar</button><button className="delete-table-button" onClick={() => deleteTable(table)}><Trash2 size={14}/> Excluir</button></>}</div>
        </article>;
      })}
    </div>}

    {serviceTable && <TableService table={serviceTable} profile={profile} onClose={() => setServiceTable(null)} onChanged={refresh}/>}
    {qrTable && <div className="table-modal-backdrop qr-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setQrTable(null); }}><section className="table-modal table-qr-modal" role="dialog" aria-modal="true" aria-labelledby="table-qr-title"><header><div><span className="table-modal-icon"><QrCode size={18}/></span><div><h2 id="table-qr-title">QR Code · Mesa {qrTable.number}</h2><p>Cliente abre o cardápio e envia o pedido direto para a mesa.</p></div></div><button className="table-modal-close" onClick={() => setQrTable(null)} aria-label="Fechar"><X size={19}/></button></header><div className="table-qr-content"><div className="table-qr-code"><QRCodeSVG value={qrMenuUrl(qrTable)} size={210} level="H" includeMargin/></div><label>Endereço do cardápio<input readOnly value={qrMenuUrl(qrTable)} onFocus={event => event.target.select()}/></label><div className="table-qr-actions"><button className="table-cancel-button" onClick={() => window.print()}>Imprimir QR Code</button><button className="primary" onClick={() => copyQrLink(qrTable)}>{copiedQr ? <><Check size={14}/> Link copiado</> : 'Copiar link'}</button></div></div></section></div>}
    {dialog && <div className="table-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setDialog(false); }}>
      <section className="table-modal" role="dialog" aria-modal="true" aria-labelledby="table-modal-title">
        <header><div><span className="table-modal-icon"><Armchair size={18}/></span><div><h2 id="table-modal-title">{editingId ? 'Editar mesa' : 'Cadastrar mesa'}</h2><p>Escolha a imagem e os detalhes da mesa.</p></div></div>
          <button className="table-modal-close" onClick={() => setDialog(false)} aria-label="Fechar" disabled={saving}><X size={19}/></button></header>
        <form onSubmit={saveTable}>
          <div className="table-form-fields">
            <label>Número da mesa<input type="number" min="1" max="999" value={form.number} onChange={event => setForm({ ...form, number: event.target.value })} required autoFocus/></label>
            <label>Lugares<input type="number" min="1" max="30" value={form.capacity} onChange={event => setForm({ ...form, capacity: event.target.value })} required/></label>
            <label className="table-status-field">Situação<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{statuses.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          </div>
          <fieldset className="table-image-picker"><legend>Imagem da mesa</legend><div className="table-image-options">
            {tableTypes.map(type => <button key={type.key} className={`table-image-option ${form.image_key === type.key ? 'selected' : ''}`} type="button" onClick={() => setForm({ ...form, image_key: type.key })} aria-pressed={form.image_key === type.key}>
              <img src={`${import.meta.env.BASE_URL}table-images/${type.image}`} alt=""/><span>{type.name}</span><small>{type.seats}</small>{form.image_key === type.key && <i><Check size={12}/></i>}
            </button>)}
          </div></fieldset>
          {formError && <div className="table-form-error" role="alert">{formError}</div>}
          <footer><button type="button" className="table-cancel-button" onClick={() => setDialog(false)} disabled={saving}>Cancelar</button>
            <button className="primary" disabled={saving}>{saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar mesa'}</button></footer>
        </form>
      </section>
    </div>}
  </>;
}

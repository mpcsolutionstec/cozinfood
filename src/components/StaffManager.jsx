import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Mail, Phone, RefreshCw, Search, ShieldCheck, SlidersHorizontal, UserPlus, UsersRound, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import './staff-manager.css';

const roleInfo = {
  admin: { label: 'Administrador', detail: 'Acesso administrativo completo' },
  garcom: { label: 'Garçom', detail: 'Salão, mesas e envio de pedidos' },
  caixa: { label: 'Caixa PDV', detail: 'PDV e caixa/turnos conforme permissões' },
};
const cashierDefaults = ['pdv.access','pdv.sell','finance.cash.open','finance.cash.close'];
const defaultByRole = { admin: [], garcom: ['waiter.access'], caixa: cashierDefaults };
const permissionOptions = [
  ['pdv.access','Acessar o PDV','Exibe o ponto de venda no menu.'],
  ['pdv.sell','Finalizar vendas','Permite receber pagamentos e concluir vendas.'],
  ['finance.cash.access','Acessar Caixa e turnos','Abre apenas o controle de caixa do Financeiro.'],
  ['finance.cash.open','Abrir o caixa','Inicia um novo turno com fundo de troco.'],
  ['finance.cash.close','Fechar e conferir caixa','Permite a contagem cega e o fechamento.'],
  ['finance.cash.withdrawal','Registrar sangria','Retirada exige a senha de gerente configurada.'],
  ['finance.cash.reinforcement','Registrar reforço','Registra entrada de dinheiro no caixa.'],
];
const emptyInvite = { full_name: '', email: '', phone: '', role: 'garcom', username: '', password: '' };
const formatPhone = value => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

async function getFunctionErrorMessage(error) {
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const body = await response.clone().json();
      if (body?.error) return body.code ? `${body.error} (${body.code})` : body.error;
    } catch { /* Retain the SDK message when the response is not JSON. */ }
  }
  return error?.message || 'Falha no serviço.';
}

export default function StaffManager({ profile }) {
  const [members, setMembers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState(emptyInvite);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [permissionUserId, setPermissionUserId] = useState('');
  const [cashierCredentials, setCashierCredentials] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadMembers = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('list_restaurant_staff');
    if (loadError) setError(`Não foi possível carregar a equipe: ${loadError.message}`);
    else {
      const rows = data || [];
      setMembers(rows);
      setDrafts(Object.fromEntries(rows.map(member => [member.id, { full_name: member.full_name, phone: member.phone || '', role: member.role, active: member.active, permissions: member.permissions || defaultByRole[member.role] || [] }])));
      setError('');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => {
    if (!supabase || !profile?.restaurant_id) return undefined;
    const channel = supabase.channel(`staff-profiles-${profile.restaurant_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `restaurant_id=eq.${profile.restaurant_id}` }, loadMembers)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.restaurant_id, loadMembers]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    return members.filter(member => !needle || `${member.full_name} ${member.email || ''} ${member.phone || ''} ${roleInfo[member.role]?.label || member.role}`.toLocaleLowerCase('pt-BR').includes(needle));
  }, [members, search]);
  const stats = useMemo(() => ({
    total: members.length,
    admins: members.filter(member => member.role === 'admin' && member.active).length,
    waiters: members.filter(member => member.role === 'garcom' && member.active).length,
    cashiers: members.filter(member => member.role === 'caixa' && member.active).length,
  }), [members]);

  const updateDraft = (id, field, value) => setDrafts(current => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const updateRole = (id, role) => setDrafts(current => ({ ...current, [id]: { ...current[id], role, permissions: defaultByRole[role] || [] } }));
  const togglePermission = (id, permission) => setDrafts(current => {
    const currentPermissions = current[id]?.permissions || [];
    return { ...current, [id]: { ...current[id], permissions: currentPermissions.includes(permission) ? currentPermissions.filter(item => item !== permission) : [...currentPermissions, permission] } };
  });
  const saveMember = async member => {
    const draft = drafts[member.id];
    setSavingId(member.id); setError(''); setNotice('');
    if (member.role === 'garcom' && (draft.phone || '') !== (member.phone || '')) {
      const { data, error: phoneError } = await supabase.functions.invoke('invite-staff', { body: { action: 'update_phone', user_id: member.id, phone: draft.phone } });
      if (phoneError || data?.error) {
        const detail = data?.error || await getFunctionErrorMessage(phoneError);
        setError(`Nao foi possivel atualizar o telefone de ${member.full_name}: ${detail}`);
        setSavingId(''); return false;
      }
    }
    const { error: saveError } = await supabase.rpc('update_staff_member', {
      p_user_id: member.id, p_role: draft.role, p_active: draft.active,
      p_full_name: draft.full_name, p_phone: draft.phone,
    });
    if (saveError) setError(`Nao foi possivel salvar ${member.full_name}: ${saveError.message}`);
    else {
      if (draft.role !== 'admin') {
        const { error: permissionError } = await supabase.rpc('update_staff_permissions', { p_user_id: member.id, p_permissions: draft.permissions || [] });
        if (permissionError) { setError(`Nao foi possivel salvar permissoes: ${permissionError.message}`); setSavingId(''); return false; }
      }
      setNotice(`Perfil de ${draft.full_name} atualizado.`); await loadMembers();
    }
    setSavingId('');
    return !saveError;
  };

  const inviteMember = async event => {
    event.preventDefault(); setInviteBusy(true); setError(''); setNotice('');
    const { data, error: inviteError } = await supabase.functions.invoke('invite-staff', { body: invite });
    if (inviteError || data?.error) {
      const detail = data?.error || await getFunctionErrorMessage(inviteError);
      setError(`Nao foi possivel criar o acesso: ${detail}`);
      setInviteBusy(false); return;
    }
    setNotice(data.role === 'caixa'
      ? `Acesso criado para ${data.full_name}. Login: ${data.username}. Entregue a senha inicial ao usuario; nenhum e-mail foi enviado.`
      : `Convite enviado para ${data.email}. A pessoa recebera um link para confirmar o e-mail e criar a senha.`);
    setInvite(emptyInvite); setInviteOpen(false); setInviteBusy(false); await loadMembers();
  };

  const saveCashierCredentials = async () => {
    if (!permissionMember || permissionMember.role !== 'caixa') return;
    setSavingId(permissionMember.id); setError(''); setNotice('');
    const { data, error: credentialsError } = await supabase.functions.invoke('invite-staff', {
      body: { action: 'set_cashier_credentials', user_id: permissionMember.id, username: cashierCredentials.username, password: cashierCredentials.password },
    });
    if (credentialsError || data?.error) {
      setError(data?.error || await getFunctionErrorMessage(credentialsError));
      setSavingId(''); return;
    }
    setNotice(`Login do Caixa PDV atualizado: ${data.username}. A senha nao foi enviada por e-mail.`);
    setCashierCredentials(current => ({ ...current, password: '' }));
    await loadMembers(); setSavingId('');
  };

  const permissionMember = members.find(member => member.id === permissionUserId);
  const permissionDraft = permissionMember ? (drafts[permissionMember.id] || permissionMember) : null;
  const optionsForMember = permissionMember?.role === 'caixa' ? permissionOptions : permissionMember?.role === 'garcom' ? [['waiter.access','Acessar app do garcom','Permite usar o mapa de mesas e registrar pedidos.']] : [];

  return <div className="staff-page">
    <div className="page-heading staff-heading"><div><h1>Equipe e acessos</h1><p>Crie acessos, ajuste permissoes e limite as telas de cada usuario.</p></div><button className="primary staff-invite-button" onClick={() => { setInviteOpen(true); setError(''); }}><UserPlus size={16}/> Criar acesso</button></div>
    <div className="staff-stats"><article><span className="staff-stat-icon all"><UsersRound size={18}/></span><div><small>Usuarios</small><b>{stats.total}</b></div></article><article><span className="staff-stat-icon admin"><ShieldCheck size={18}/></span><div><small>Administradores</small><b>{stats.admins}</b></div></article><article><span className="staff-stat-icon waiter"><UsersRound size={18}/></span><div><small>Garcons ativos</small><b>{stats.waiters}</b></div></article><article><span className="staff-stat-icon cashier"><span>R$</span></span><div><small>Caixas ativos</small><b>{stats.cashiers}</b></div></article></div>
    {notice && <div className="staff-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar"><X size={15}/></button></div>}
    {error && <div className="staff-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar"><X size={15}/></button></div>}
    <section className="staff-panel"><div className="staff-panel-head"><div><h2>Usuarios do restaurante</h2><p>As alteracoes de funcao, permissoes e status sao salvas no perfil.</p></div><label className="staff-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome, e-mail ou funcao"/></label><button className="staff-refresh" onClick={loadMembers} aria-label="Atualizar lista"><RefreshCw size={16}/></button></div>
      {loading ? <div className="staff-loading">Carregando equipe...</div> : filtered.length ? <div className="staff-list">{filtered.map(member => {
        const draft = drafts[member.id] || member;
        const changed = draft.full_name !== member.full_name || draft.phone !== (member.phone || '') || draft.role !== member.role || draft.active !== member.active || JSON.stringify([...(draft.permissions || [])].sort()) !== JSON.stringify([...(member.permissions || [])].sort());
        return <article className={`staff-row ${member.active ? '' : 'inactive'}`} key={member.id}>
          <div className="staff-avatar">{member.full_name.trim().split(/\s+/).map(word => word[0]).join('').slice(0,2).toUpperCase()}</div>
          <div className="staff-identity"><b>{member.full_name}</b>{member.username ? <span><KeyRound size={13}/>{member.username}</span> : member.email && <span><Mail size={13}/>{member.email}</span>}{member.phone && <span><Phone size={13}/>{member.phone}</span>}</div>
          <label className="staff-field staff-name-field"><span>Nome</span><input value={draft.full_name} maxLength={80} onChange={event => updateDraft(member.id,'full_name',event.target.value)}/></label>
          <label className="staff-field staff-role-field"><span>Funcao</span><select value={draft.role} onChange={event => updateRole(member.id,event.target.value)}>{Object.entries(roleInfo).map(([role,info]) => <option key={role} value={role}>{info.label}</option>)}</select><small>{roleInfo[draft.role]?.detail}</small></label>
          <label className="staff-field staff-phone-field"><span>Telefone</span><input value={draft.phone} maxLength={30} placeholder="Opcional" onChange={event => updateDraft(member.id,'phone',event.target.value)}/></label>
          <button type="button" className="staff-permission-open" onClick={() => { setPermissionUserId(member.id); setCashierCredentials({ username: member.username || '', password: '' }); }}><SlidersHorizontal size={14}/> Permissoes</button>
          <label className="staff-active-toggle"><input type="checkbox" checked={draft.active} onChange={event => updateDraft(member.id,'active',event.target.checked)}/><span className="staff-switch"/><span>{draft.active ? 'Ativo' : 'Inativo'}</span></label>
          <button className="staff-save" disabled={!changed || savingId === member.id} onClick={() => saveMember(member)}>{savingId === member.id ? 'Salvando...' : changed ? <><Check size={15}/> Salvar</> : 'Salvo'}</button>
        </article>;
      })}</div> : <div className="staff-empty"><UsersRound size={26}/><b>Nenhum usuario encontrado</b><span>Crie um acesso ou ajuste a busca.</span></div>}
    </section>
    <section className="staff-roles"><h2>Regras iniciais por funcao</h2><div>{Object.entries(roleInfo).map(([role,info]) => <article key={role}><span className={`staff-stat-icon ${role}`}>{role==='admin'?<ShieldCheck size={17}/>:role==='caixa'?<span>R$</span>:<UsersRound size={17}/>}</span><div><b>{info.label}</b><small>{info.detail}</small></div></article>)}</div></section>
    {inviteOpen && <div className="staff-modal-backdrop" onMouseDown={event => { if(event.target===event.currentTarget&&!inviteBusy)setInviteOpen(false); }}><section className="staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-invite-title"><header><div><span className="staff-modal-icon"><UserPlus size={19}/></span><div><h2 id="staff-invite-title">Novo usuario</h2><p>{invite.role==='caixa'?'Acesso criado sem e-mail. O caixa entra com usuario e senha.':'O usuario recebera um convite por e-mail para criar a senha.'}</p></div></div><button type="button" onClick={() => setInviteOpen(false)} disabled={inviteBusy} aria-label="Fechar"><X size={18}/></button></header>
      <form onSubmit={inviteMember}><label>Nome completo<input autoFocus value={invite.full_name} minLength={2} maxLength={80} onChange={event => setInvite(current => ({...current,full_name:event.target.value}))} required/></label>
        {invite.role === 'caixa' ? <><label>Usuario para entrar no PDV<input autoComplete="username" value={invite.username} minLength={3} maxLength={30} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}" placeholder="Ex.: caixa01" onChange={event => setInvite(current => ({...current,username:event.target.value.toLowerCase()}))} required/><small className="staff-field-hint">Use letras sem acento, numeros, ponto, hifen ou sublinhado.</small></label><label>Senha inicial<span className="staff-password-input"><input type={showInitialPassword ? 'text' : 'password'} autoComplete="new-password" value={invite.password} minLength={8} maxLength={72} onChange={event => setInvite(current => ({...current,password:event.target.value}))} required/><button type="button" aria-label={showInitialPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowInitialPassword(value => !value)}>{showInitialPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span><small className="staff-field-hint">Entregue a senha diretamente ao operador. Ela nao sera enviada por e-mail.</small></label></> : <label>E-mail<input type="email" autoComplete="email" value={invite.email} onChange={event => setInvite(current => ({...current,email:event.target.value}))} required/></label>}
        <label>Telefone <small>Opcional</small><input type="tel" autoComplete="tel" inputMode="numeric" value={invite.phone} maxLength={15} placeholder="(11) 99999-9999" onChange={event => setInvite(current => ({...current,phone:formatPhone(event.target.value)}))}/></label>
        <label>Funcao<select value={invite.role} onChange={event => setInvite(current => ({...current,role:event.target.value}))}>{Object.entries(roleInfo).map(([role,info]) => <option key={role} value={role}>{info.label} - {info.detail}</option>)}</select></label>
        <div className="staff-invite-note">{invite.role==='caixa'?'A conta sera criada pelo administrador, sem disparar mensagem. O operador podera entrar com usuario e senha.':'O Supabase enviara um link para confirmar o e-mail e definir a senha.'}</div>{error && <div className="staff-error" role="alert">{error}</div>}
        <footer><button type="button" className="staff-cancel" onClick={() => setInviteOpen(false)} disabled={inviteBusy}>Cancelar</button><button className="primary" disabled={inviteBusy}>{inviteBusy ? 'Criando...' : invite.role === 'caixa' ? <><KeyRound size={15}/> Criar acesso</> : <><Mail size={15}/> Enviar convite</>}</button></footer>
      </form></section></div>}
    {permissionMember && permissionDraft && <div className="staff-modal-backdrop" onMouseDown={event => { if(event.target===event.currentTarget)setPermissionUserId(''); }}><section className="staff-modal staff-permission-modal" role="dialog" aria-modal="true" aria-labelledby="staff-permission-title"><header><div><span className="staff-modal-icon"><SlidersHorizontal size={19}/></span><div><h2 id="staff-permission-title">Permissoes de {permissionMember.full_name}</h2><p>Marque os modulos e as operacoes permitidas para este perfil.</p></div></div><button type="button" onClick={() => setPermissionUserId('')} aria-label="Fechar"><X size={18}/></button></header>
      {permissionMember.role === 'admin' ? <div className="staff-invite-note">Administradores possuem acesso completo ao restaurante.</div> : <div className="staff-permission-list">{optionsForMember.map(([key,label,detail]) => <label key={key} className="staff-permission-toggle"><span><b>{label}</b><small>{detail}</small></span><input type="checkbox" checked={(permissionDraft.permissions || []).includes(key)} onChange={() => togglePermission(permissionMember.id,key)}/></label>)}</div>}
      {permissionMember.role === 'caixa' && <div className="staff-cashier-credentials"><h3>Login do Caixa PDV</h3><label>Nome de usuario<input autoComplete="username" value={cashierCredentials.username} minLength={3} maxLength={30} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}" onChange={event => setCashierCredentials(current => ({ ...current, username: event.target.value.toLowerCase() }))} placeholder="Ex.: caixa01" required/></label><label>Definir ou trocar senha <small>Deixe em branco para manter a atual</small><input type="password" autoComplete="new-password" value={cashierCredentials.password} minLength={8} maxLength={72} onChange={event => setCashierCredentials(current => ({ ...current, password: event.target.value }))} placeholder="Minimo 8 caracteres"/></label><button type="button" className="staff-permission-open" disabled={savingId===permissionMember.id} onClick={saveCashierCredentials}>{savingId===permissionMember.id?'Salvando...':'Salvar login'}</button></div>}
      <div className="staff-modal-actions"><button type="button" className="staff-cancel" onClick={() => setPermissionUserId('')}>Fechar</button><button type="button" className="primary" disabled={savingId===permissionMember.id} onClick={async () => { if (await saveMember(permissionMember)) setPermissionUserId(''); }}>{savingId===permissionMember.id?'Salvando...':'Salvar permissoes'}</button></div>
    </section></div>}
  </div>;
}

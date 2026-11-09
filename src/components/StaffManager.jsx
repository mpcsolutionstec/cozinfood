import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Mail, Phone, RefreshCw, Search, ShieldCheck, UserPlus, UsersRound, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import './staff-manager.css';

const roleInfo = {
  admin: { label: 'Administrador', detail: 'Acesso administrativo completo' },
  garcom: { label: 'Garçom', detail: 'Salão, mesas e envio de pedidos' },
  caixa: { label: 'Caixa', detail: 'PDV, vendas e recebimentos' },
};
const emptyInvite = { full_name: '', email: '', phone: '', role: 'garcom' };

export default function StaffManager({ profile }) {
  const [members, setMembers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState(emptyInvite);
  const [inviteBusy, setInviteBusy] = useState(false);
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
      setDrafts(Object.fromEntries(rows.map(member => [member.id, { full_name: member.full_name, phone: member.phone || '', role: member.role, active: member.active }])));
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
    return members.filter(member => !needle || `${member.full_name} ${member.email} ${member.phone || ''} ${roleInfo[member.role]?.label || member.role}`.toLocaleLowerCase('pt-BR').includes(needle));
  }, [members, search]);
  const stats = useMemo(() => ({
    total: members.length,
    admins: members.filter(member => member.role === 'admin' && member.active).length,
    waiters: members.filter(member => member.role === 'garcom' && member.active).length,
    cashiers: members.filter(member => member.role === 'caixa' && member.active).length,
  }), [members]);

  const updateDraft = (id, field, value) => setDrafts(current => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const saveMember = async member => {
    const draft = drafts[member.id];
    setSavingId(member.id); setError(''); setNotice('');
    const { error: saveError } = await supabase.rpc('update_staff_member', {
      p_user_id: member.id, p_role: draft.role, p_active: draft.active,
      p_full_name: draft.full_name, p_phone: draft.phone,
    });
    if (saveError) setError(`Não foi possível salvar ${member.full_name}: ${saveError.message}`);
    else { setNotice(`Perfil de ${draft.full_name} atualizado.`); await loadMembers(); }
    setSavingId('');
  };

  const inviteMember = async event => {
    event.preventDefault(); setInviteBusy(true); setError(''); setNotice('');
    const { data, error: inviteError } = await supabase.functions.invoke('invite-staff', { body: invite });
    if (inviteError || data?.error) {
      setError(`Não foi possível enviar o convite: ${data?.error || inviteError?.message || 'Falha no serviço de convites.'}`);
      setInviteBusy(false); return;
    }
    setNotice(`Convite enviado para ${data.email}. A pessoa receberá um link para criar a senha.`);
    setInvite(emptyInvite); setInviteOpen(false); setInviteBusy(false); await loadMembers();
  };

  return <div className="staff-page">
    <div className="page-heading staff-heading"><div><h1>Equipe e acessos</h1><p>Convide pessoas e controle a função de cada usuário no restaurante.</p></div><button className="primary staff-invite-button" onClick={() => { setInviteOpen(true); setError(''); }}><UserPlus size={16}/> Convidar usuário</button></div>
    <div className="staff-stats"><article><span className="staff-stat-icon all"><UsersRound size={18}/></span><div><small>Usuários</small><b>{stats.total}</b></div></article><article><span className="staff-stat-icon admin"><ShieldCheck size={18}/></span><div><small>Administradores</small><b>{stats.admins}</b></div></article><article><span className="staff-stat-icon waiter"><UsersRound size={18}/></span><div><small>Garçons ativos</small><b>{stats.waiters}</b></div></article><article><span className="staff-stat-icon cashier"><span>R$</span></span><div><small>Caixas ativos</small><b>{stats.cashiers}</b></div></article></div>
    {notice && <div className="staff-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar"><X size={15}/></button></div>}
    {error && <div className="staff-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar"><X size={15}/></button></div>}
    <section className="staff-panel"><div className="staff-panel-head"><div><h2>Usuários do restaurante</h2><p>Alterações de função e acesso são aplicadas imediatamente.</p></div><label className="staff-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome, e-mail ou função"/></label><button className="staff-refresh" onClick={loadMembers} aria-label="Atualizar lista"><RefreshCw size={16}/></button></div>
      {loading ? <div className="staff-loading">Carregando equipe…</div> : filtered.length ? <div className="staff-list">{filtered.map(member => {
        const draft = drafts[member.id] || member;
        const changed = draft.full_name !== member.full_name || draft.phone !== (member.phone || '') || draft.role !== member.role || draft.active !== member.active;
        return <article className={`staff-row ${member.active ? '' : 'inactive'}`} key={member.id}>
          <div className="staff-avatar">{member.full_name.trim().split(/\s+/).map(word => word[0]).join('').slice(0,2).toUpperCase()}</div>
          <div className="staff-identity"><b>{member.full_name}</b><span><Mail size={13}/>{member.email}</span>{member.phone && <span><Phone size={13}/>{member.phone}</span>}</div>
          <label className="staff-field staff-name-field"><span>Nome</span><input value={draft.full_name} maxLength={80} onChange={event => updateDraft(member.id,'full_name',event.target.value)}/></label>
          <label className="staff-field staff-role-field"><span>Função</span><select value={draft.role} onChange={event => updateDraft(member.id,'role',event.target.value)}>{Object.entries(roleInfo).map(([role,info]) => <option key={role} value={role}>{info.label}</option>)}</select><small>{roleInfo[draft.role]?.detail}</small></label>
          <label className="staff-field staff-phone-field"><span>Telefone</span><input value={draft.phone} maxLength={30} placeholder="Opcional" onChange={event => updateDraft(member.id,'phone',event.target.value)}/></label>
          <label className="staff-active-toggle"><input type="checkbox" checked={draft.active} onChange={event => updateDraft(member.id,'active',event.target.checked)}/><span className="staff-switch"/><span>{draft.active ? 'Ativo' : 'Inativo'}</span></label>
          <button className="staff-save" disabled={!changed || savingId === member.id} onClick={() => saveMember(member)}>{savingId === member.id ? 'Salvando…' : changed ? <><Check size={15}/> Salvar</> : 'Salvo'}</button>
        </article>;
      })}</div> : <div className="staff-empty"><UsersRound size={26}/><b>Nenhum usuário encontrado</b><span>Convide a equipe ou ajuste a busca.</span></div>}
    </section>
    <section className="staff-roles"><h2>O que cada função pode fazer</h2><div>{Object.entries(roleInfo).map(([role,info]) => <article key={role}><span className={`staff-stat-icon ${role}`}>{role==='admin'?<ShieldCheck size={17}/>:role==='caixa'?<span>R$</span>:<UsersRound size={17}/>}</span><div><b>{info.label}</b><small>{info.detail}</small></div></article>)}</div></section>
    {inviteOpen && <div className="staff-modal-backdrop" onMouseDown={event => { if(event.target===event.currentTarget&&!inviteBusy)setInviteOpen(false); }}><section className="staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-invite-title"><header><div><span className="staff-modal-icon"><UserPlus size={19}/></span><div><h2 id="staff-invite-title">Convidar usuário</h2><p>O convite será enviado por e-mail para acessar este restaurante.</p></div></div><button onClick={() => setInviteOpen(false)} disabled={inviteBusy} aria-label="Fechar"><X size={18}/></button></header><form onSubmit={inviteMember}><label>Nome completo<input autoFocus value={invite.full_name} minLength={2} maxLength={80} onChange={event => setInvite(current => ({...current,full_name:event.target.value}))} required/></label><label>E-mail<input type="email" autoComplete="email" value={invite.email} onChange={event => setInvite(current => ({...current,email:event.target.value}))} required/></label><label>Telefone <small>Opcional</small><input type="tel" value={invite.phone} maxLength={30} onChange={event => setInvite(current => ({...current,phone:event.target.value}))}/></label><label>Função<select value={invite.role} onChange={event => setInvite(current => ({...current,role:event.target.value}))}>{Object.entries(roleInfo).map(([role,info]) => <option key={role} value={role}>{info.label} · {info.detail}</option>)}</select></label><div className="staff-invite-note">A pessoa receberá um link para confirmar o e-mail e definir a própria senha.</div>{error && <div className="staff-error" role="alert">{error}</div>}<footer><button type="button" className="staff-cancel" onClick={() => setInviteOpen(false)} disabled={inviteBusy}>Cancelar</button><button className="primary" disabled={inviteBusy}>{inviteBusy ? 'Enviando convite…' : <><Mail size={15}/> Enviar convite</>}</button></footer></form></section></div>}
  </div>;
}

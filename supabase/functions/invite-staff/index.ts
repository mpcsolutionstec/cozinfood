import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

function normalizeBrazilPhone(value: unknown) {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return digits.length >= 12 && digits.length <= 13 ? `+${digits}` : ''
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  return ''
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization') || ''
  if (!supabaseUrl || !anonKey || !serviceKey) return reply({ error: 'Configure os segredos do Supabase para o gerenciamento da equipe.' }, 503)
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Sessão ausente. Entre novamente no painel.' }, 401)

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
    })
    const { data: authData, error: authError } = await authClient.auth.getUser()
    if (authError || !authData.user) return reply({ error: 'Sessão inválida. Entre novamente no painel.' }, 401)

    const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: inviter, error: inviterError } = await serviceClient.from('profiles')
      .select('restaurant_id,role,active').eq('id', authData.user.id).maybeSingle()
    if (inviterError) throw inviterError
    if (!inviter?.active || inviter.role !== 'admin') return reply({ error: 'Somente um administrador ativo pode gerenciar usuários.' }, 403)

    const input = await request.json()
    const action = String(input.action || 'invite')
    if (action === 'update_phone') {
      const userId = String(input.user_id || '')
      const phone = normalizeBrazilPhone(input.phone)
      if (!userId) return reply({ error: 'Usuário inválido.' }, 400)
      if (!phone) return reply({ error: 'Informe um telefone brasileiro válido com DDD.' }, 400)
      const { data: target, error: targetError } = await serviceClient.from('profiles')
        .select('id,role').eq('id', userId).eq('restaurant_id', inviter.restaurant_id).maybeSingle()
      if (targetError) throw targetError
      if (!target || target.role !== 'garcom') return reply({ error: 'O telefone só pode ser alterado para um garçom deste restaurante.' }, 404)
      const { data: duplicate, error: duplicateError } = await serviceClient.from('profiles')
        .select('id').eq('restaurant_id', inviter.restaurant_id).eq('phone', phone).neq('id', userId).maybeSingle()
      if (duplicateError) throw duplicateError
      if (duplicate) return reply({ error: 'Este telefone já está cadastrado para outra pessoa neste restaurante.' }, 409)
      const { error: updateAuthError } = await serviceClient.auth.admin.updateUserById(userId, { phone, phone_confirm: false })
      if (updateAuthError) return reply({ error: updateAuthError.message }, 409)
      const { error: updateProfileError } = await serviceClient.from('profiles')
        .update({ phone }).eq('id', userId).eq('restaurant_id', inviter.restaurant_id)
      if (updateProfileError) throw updateProfileError
      return reply({ ok: true, phone })
    }

    const email = String(input.email || '').trim().toLowerCase()
    const fullName = String(input.full_name || '').trim()
    const rawPhone = String(input.phone || '').trim()
    const role = String(input.role || '')
    if (fullName.length < 2 || fullName.length > 80) return reply({ error: 'O nome deve ter entre 2 e 80 caracteres.' }, 400)
    if (!['admin', 'garcom', 'caixa'].includes(role)) return reply({ error: 'Escolha admin, garçom ou caixa.' }, 400)

    if (action !== 'invite') return reply({ error: 'Ação inválida.' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Informe um e-mail válido.' }, 400)
    if (rawPhone.length > 30) return reply({ error: 'O telefone deve ter até 30 caracteres.' }, 400)

    const appUrl = (Deno.env.get('APP_URL') || 'https://cozinfood.vercel.app').replace(/\/$/, '')
    const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${appUrl}/?staff-invite=1`,
    })
    if (inviteError) {
      const authStatus = Number(inviteError.status)
      const responseStatus = authStatus >= 400 && authStatus < 500 ? authStatus : 502
      console.error('Supabase Auth invite failed:', {
        status: authStatus || null,
        code: inviteError.code || null,
        message: inviteError.message,
      })
      return reply({ error: inviteError.message, code: inviteError.code || 'auth_invite_failed' }, responseStatus)
    }
    const invitedUser = inviteData.user
    if (!invitedUser) return reply({ error: 'O Supabase não retornou o usuário convidado.' }, 502)

    const { data: existingProfile, error: existingError } = await serviceClient.from('profiles')
      .select('id,restaurant_id').eq('id', invitedUser.id).maybeSingle()
    if (existingError) throw existingError
    if (existingProfile) return reply({ error: 'Este e-mail já está vinculado a um perfil.' }, 409)

    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: invitedUser.id, restaurant_id: inviter.restaurant_id, full_name: fullName,
      phone: rawPhone || null, role, active: true,
    })
    if (profileError) throw profileError
    return reply({ ok: true, email, full_name: fullName, role })
  } catch (error) {
    console.error('invite-staff error:', error)
    return reply({ error: error instanceof Error ? error.message : 'Não foi possível concluir a operação.' }, 500)
  }
})

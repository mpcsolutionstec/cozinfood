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
  if (request.method !== 'POST') return reply({ error: 'Metodo nao permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization') || ''
  if (!supabaseUrl || !anonKey || !serviceKey) return reply({ error: 'Configure os segredos do Supabase para o gerenciamento da equipe.' }, 503)
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Sessao ausente. Entre novamente no painel.' }, 401)

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
    })
    const { data: authData, error: authError } = await authClient.auth.getUser()
    if (authError || !authData.user) return reply({ error: 'Sessao invalida. Entre novamente no painel.' }, 401)

    const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: inviter, error: inviterError } = await serviceClient.from('profiles')
      .select('restaurant_id,role,active').eq('id', authData.user.id).maybeSingle()
    if (inviterError) throw inviterError
    if (!inviter?.active || inviter.role !== 'admin') return reply({ error: 'Somente um administrador ativo pode gerenciar usuarios.' }, 403)

    const input = await request.json()
    const action = String(input.action || 'invite')
    if (action === 'set_cashier_credentials') {
      const userId = String(input.user_id || '')
      const username = String(input.username || '').trim().toLowerCase()
      const password = String(input.password || '')
      if (!userId || !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return reply({ error: 'Informe um usuario valido de 3 a 30 caracteres.' }, 400)
      if (password && (password.length < 8 || password.length > 72)) return reply({ error: 'A nova senha deve ter entre 8 e 72 caracteres.' }, 400)
      const { data: target, error: targetError } = await serviceClient.from('profiles')
        .select('id,username,role').eq('id', userId).eq('restaurant_id', inviter.restaurant_id).maybeSingle()
      if (targetError) throw targetError
      if (!target || target.role !== 'caixa') return reply({ error: 'Este usuario nao e um Caixa PDV deste restaurante.' }, 404)
      const { data: duplicate, error: duplicateError } = await serviceClient.from('profiles')
        .select('id').eq('username', username).neq('id', userId).maybeSingle()
      if (duplicateError) throw duplicateError
      if (duplicate) return reply({ error: 'Este nome de usuario ja esta em uso.' }, 409)
      const { error: saveProfileError } = await serviceClient.from('profiles')
        .update({ username }).eq('id', userId).eq('restaurant_id', inviter.restaurant_id)
      if (saveProfileError) throw saveProfileError
      const authUpdate = { email: `${username}@staff.cozinfood.app`, email_confirm: true, ...(password ? { password } : {}) }
      const { error: authUpdateError } = await serviceClient.auth.admin.updateUserById(userId, authUpdate)
      if (authUpdateError) {
        await serviceClient.from('profiles').update({ username: target.username }).eq('id', userId).eq('restaurant_id', inviter.restaurant_id)
        return reply({ error: authUpdateError.message, code: authUpdateError.code || 'auth_update_failed' }, 409)
      }
      return reply({ ok: true, username })
    }
    if (action === 'update_phone') {
      const userId = String(input.user_id || '')
      const phone = normalizeBrazilPhone(input.phone)
      if (!userId) return reply({ error: 'Usuario invalido.' }, 400)
      if (!phone) return reply({ error: 'Informe um telefone brasileiro valido com DDD.' }, 400)
      const { data: target, error: targetError } = await serviceClient.from('profiles')
        .select('id,role').eq('id', userId).eq('restaurant_id', inviter.restaurant_id).maybeSingle()
      if (targetError) throw targetError
      if (!target || target.role !== 'garcom') return reply({ error: 'O telefone so pode ser alterado para um garcom deste restaurante.' }, 404)
      const { data: duplicate, error: duplicateError } = await serviceClient.from('profiles')
        .select('id').eq('restaurant_id', inviter.restaurant_id).eq('phone', phone).neq('id', userId).maybeSingle()
      if (duplicateError) throw duplicateError
      if (duplicate) return reply({ error: 'Este telefone ja esta cadastrado para outra pessoa neste restaurante.' }, 409)
      const { error: updateAuthError } = await serviceClient.auth.admin.updateUserById(userId, { phone, phone_confirm: false })
      if (updateAuthError) return reply({ error: updateAuthError.message }, 409)
      const { error: updateProfileError } = await serviceClient.from('profiles')
        .update({ phone }).eq('id', userId).eq('restaurant_id', inviter.restaurant_id)
      if (updateProfileError) throw updateProfileError
      return reply({ ok: true, phone })
    }

    if (action !== 'invite') return reply({ error: 'Acao invalida.' }, 400)
    const email = String(input.email || '').trim().toLowerCase()
    const fullName = String(input.full_name || '').trim()
    const rawPhone = String(input.phone || '').trim()
    const role = String(input.role || '')
    const username = String(input.username || '').trim().toLowerCase()
    const initialPassword = String(input.password || '')
    if (fullName.length < 2 || fullName.length > 80) return reply({ error: 'O nome deve ter entre 2 e 80 caracteres.' }, 400)
    if (!['admin', 'garcom', 'caixa'].includes(role)) return reply({ error: 'Funcao invalida.' }, 400)
    if (rawPhone.length > 30) return reply({ error: 'Telefone invalido.' }, 400)

    let authUser
    if (role === 'caixa') {
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return reply({ error: 'Use um usuario de 3 a 30 caracteres, sem espacos.' }, 400)
      if (initialPassword.length < 8 || initialPassword.length > 72) return reply({ error: 'A senha inicial deve ter entre 8 e 72 caracteres.' }, 400)
      const { data: duplicate, error: duplicateError } = await serviceClient.from('profiles')
        .select('id').ilike('username', username).maybeSingle()
      if (duplicateError) throw duplicateError
      if (duplicate) return reply({ error: 'Este nome de usuario ja esta em uso.' }, 409)
      const { data, error: createError } = await serviceClient.auth.admin.createUser({
        email: `${username}@staff.cozinfood.app`, password: initialPassword, email_confirm: true,
        user_metadata: { full_name: fullName, staff_username: username },
      })
      if (createError) return reply({ error: createError.message, code: createError.code || 'auth_create_failed' }, 409)
      authUser = data.user
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Informe um e-mail valido.' }, 400)
      const appUrl = (Deno.env.get('APP_URL') || 'https://cozinfood.vercel.app').replace(/\/$/, '')
      const { data, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName }, redirectTo: `${appUrl}/?staff-invite=1`,
      })
      if (inviteError) {
        const authStatus = Number(inviteError.status)
        const responseStatus = authStatus >= 400 && authStatus < 500 ? authStatus : 502
        console.error('Supabase Auth invite failed:', { status: authStatus || null, code: inviteError.code || null, message: inviteError.message })
        return reply({ error: inviteError.message, code: inviteError.code || 'auth_invite_failed' }, responseStatus)
      }
      authUser = data.user
    }
    if (!authUser) return reply({ error: 'O Supabase nao retornou o usuario criado.' }, 502)

    const { data: existingProfile, error: existingError } = await serviceClient.from('profiles')
      .select('id,restaurant_id').eq('id', authUser.id).maybeSingle()
    if (existingError) throw existingError
    if (existingProfile) return reply({ error: 'Este e-mail ja esta vinculado a um perfil.' }, 409)

    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: authUser.id, restaurant_id: inviter.restaurant_id, full_name: fullName,
      phone: rawPhone || null, role, active: true, username: role === 'caixa' ? username : null,
    })
    if (profileError) {
      await serviceClient.auth.admin.deleteUser(authUser.id)
      throw profileError
    }
    return reply({ ok: true, email: role === 'caixa' ? null : email, username: role === 'caixa' ? username : null, full_name: fullName, role, email_sent: role !== 'caixa' })
  } catch (error) {
    console.error('invite-staff error:', error)
    return reply({ error: error instanceof Error ? error.message : 'Nao foi possivel concluir a operacao.' }, 500)
  }
})

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Metodo nao permitido' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization') || ''
  if (!supabaseUrl || !anonKey || !serviceKey) return reply({ error: 'Configure os segredos do Supabase para convites.' }, 503)
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
    if (!inviter?.active || inviter.role !== 'admin') return reply({ error: 'Somente um administrador ativo pode convidar usuários.' }, 403)

    const input = await request.json()
    const email = String(input.email || '').trim().toLowerCase()
    const fullName = String(input.full_name || '').trim()
    const phone = String(input.phone || '').trim()
    const role = String(input.role || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Informe um e-mail válido.' }, 400)
    if (fullName.length < 2 || fullName.length > 80) return reply({ error: 'O nome deve ter entre 2 e 80 caracteres.' }, 400)
    if (phone.length > 30) return reply({ error: 'O telefone deve ter até 30 caracteres.' }, 400)
    if (!['admin', 'garcom', 'caixa'].includes(role)) return reply({ error: 'Escolha admin, garçom ou caixa.' }, 400)

    const appUrl = (Deno.env.get('APP_URL') || 'https://cozinfood.vercel.app').replace(/\/$/, '')
    const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${appUrl}/?staff-invite=1`,
    })
    if (inviteError) return reply({ error: inviteError.message }, 409)
    const invitedUser = inviteData.user
    if (!invitedUser) return reply({ error: 'O Supabase não retornou o usuário convidado.' }, 502)

    const { data: existingProfile, error: existingError } = await serviceClient.from('profiles')
      .select('id,restaurant_id').eq('id', invitedUser.id).maybeSingle()
    if (existingError) throw existingError
    if (existingProfile) {
      return reply({ error: 'Este e-mail já está vinculado a um perfil.' }, 409)
    }

    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: invitedUser.id, restaurant_id: inviter.restaurant_id, full_name: fullName,
      phone: phone || null, role, active: true,
    })
    if (profileError) {
      throw profileError
    }
    return reply({ ok: true, email, full_name: fullName, role })
  } catch (error) {
    console.error('invite-staff error:', error)
    return reply({ error: error instanceof Error ? error.message : 'Não foi possível enviar o convite.' }, 500)
  }
})

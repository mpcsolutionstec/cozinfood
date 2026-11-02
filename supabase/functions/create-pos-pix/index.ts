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
  const accessToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN')
  const authorization = request.headers.get('Authorization') || ''
  if (!supabaseUrl || !anonKey || !serviceKey || !accessToken) {
    return reply({ error: 'Configure as chaves da Edge Function no Supabase.' }, 503)
  }
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Sessao ausente. Entre novamente no painel.' }, 401)

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
    })
    const { data: authData, error: authError } = await authClient.auth.getUser()
    if (authError || !authData.user) return reply({ error: 'Sessao invalida. Entre novamente no painel.' }, 401)

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const [{ data: profile }, body] = await Promise.all([
      admin.from('profiles').select('restaurant_id,role,active').eq('id', authData.user.id).maybeSingle(),
      request.json(),
    ])
    if (!profile?.active || !['admin', 'caixa'].includes(profile.role)) {
      return reply({ error: 'Somente administrador ou caixa pode cobrar no PDV.' }, 403)
    }

    const orderId = String(body.order_id || '')
    const registerId = String(body.cash_register_id || '')
    const [{ data: order }, { data: register }] = await Promise.all([
      admin.from('orders').select('id,restaurant_id,order_number,total,status,payment_state,restaurants(name)')
        .eq('id', orderId).eq('restaurant_id', profile.restaurant_id).maybeSingle(),
      admin.from('cash_registers').select('id,restaurant_id,operator_id,status')
        .eq('id', registerId).eq('restaurant_id', profile.restaurant_id).maybeSingle(),
    ])
    if (!order || order.status === 'cancelado') return reply({ error: 'Pedido aberto nao encontrado.' }, 404)
    if (!register || register.status !== 'aberto' || (register.operator_id !== authData.user.id && profile.role !== 'admin')) {
      return reply({ error: 'Abra um caixa valido para o seu operador antes de gerar o Pix.' }, 400)
    }

    const { data: paidPayments } = await admin.from('payments').select('amount')
      .eq('order_id', order.id).eq('status', 'pago')
    const due = Math.max(0, Number(order.total) - (paidPayments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0))
    if (due <= 0) return reply({ error: 'Este pedido ja esta pago.' }, 409)

    const { data: prior } = await admin.from('payments')
      .select('id,status,pix_qr_code,pix_qr_code_base64,pix_ticket_url')
      .eq('order_id', order.id).is('split_id', null).in('status', ['pendente', 'aguardando'])
      .not('pix_qr_code', 'is', null).maybeSingle()
    if (prior?.pix_qr_code) {
      return reply({ payment_id: prior.id, status: prior.status, qr_code: prior.pix_qr_code,
        qr_code_base64: prior.pix_qr_code_base64, ticket_url: prior.pix_ticket_url, amount: due })
    }

    const paymentId = crypto.randomUUID()
    const idempotencyKey = crypto.randomUUID()
    const { error: insertError } = await admin.from('payments').insert({
      id: paymentId, restaurant_id: profile.restaurant_id, order_id: order.id,
      amount: Number(due.toFixed(2)), method: 'pix', status: 'pendente', provider: 'mercado_pago',
      external_reference: paymentId, idempotency_key: idempotencyKey,
    })
    if (insertError) return reply({ error: 'Nao foi possivel iniciar a cobranca Pix.' }, 500)
    const { error: logError } = await admin.from('payments_log').insert({
      restaurant_id: profile.restaurant_id, cash_register_id: register.id, order_id: order.id,
      payment_id: paymentId, operator_id: authData.user.id, payment_method: 'pix',
      value_paid: Number(due.toFixed(2)), cash_received: 0, change_amount: 0, status: 'pendente',
    })
    if (logError) {
      await admin.from('payments').delete().eq('id', paymentId)
      return reply({ error: 'Nao foi possivel registrar a cobranca no caixa.' }, 500)
    }

    const orderRestaurant = Array.isArray(order.restaurants) ? order.restaurants[0] : order.restaurants
    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        transaction_amount: Number(due.toFixed(2)),
        description: `${orderRestaurant?.name || 'COZINFOOD'} · Venda PDV #${order.order_number}`.slice(0, 250),
        payment_method_id: 'pix', external_reference: paymentId,
        notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook`,
        payer: { email: authData.user.email || 'caixa@cozinfood.local' },
      }),
    })
    const mpData = await mpResponse.json()
    if (!mpResponse.ok) {
      await admin.from('payments').update({ status: 'falhou', webhook_log: [{ at: new Date().toISOString(), error: mpData.message || 'Falha do Mercado Pago' }] }).eq('id', paymentId)
      return reply({ error: mpData.message || 'Mercado Pago nao conseguiu gerar o Pix.' }, 502)
    }

    const transaction = mpData.point_of_interaction?.transaction_data || {}
    if (!transaction.qr_code) return reply({ error: 'O Mercado Pago nao retornou o codigo Pix.' }, 502)
    const status = mpData.status === 'approved' ? 'pago' : mpData.status === 'rejected' ? 'falhou' : 'aguardando'
    const { error: updateError } = await admin.from('payments').update({
      provider_payment_id: String(mpData.id), status,
      pix_qr_code: transaction.qr_code, pix_qr_code_base64: transaction.qr_code_base64 || null,
      pix_ticket_url: transaction.ticket_url || null,
      webhook_log: [{ at: new Date().toISOString(), event: 'pix_created', provider_status: mpData.status }],
      paid_at: status === 'pago' ? new Date().toISOString() : null,
    }).eq('id', paymentId)
    if (updateError) return reply({ error: 'Pix criado, mas nao foi possivel salvar os dados.' }, 500)

    return reply({ payment_id: paymentId, status, amount: due, qr_code: transaction.qr_code,
      qr_code_base64: transaction.qr_code_base64, ticket_url: transaction.ticket_url })
  } catch (error) {
    console.error('create-pos-pix:', error)
    return reply({ error: 'Falha inesperada ao gerar o Pix.' }, 500)
  }
})

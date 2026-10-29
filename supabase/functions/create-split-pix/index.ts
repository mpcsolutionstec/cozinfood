import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Método não permitido' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const accessToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN')
  if (!serviceKey || !accessToken) return reply({ error: 'Configure as chaves da Edge Function no Supabase.' }, 503)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  try {
    const input = await request.json()
    const token = String(input.token || '')
    const action = input.action === 'status' ? 'status' : 'create'
    if (!/^[a-f0-9]{48}$/.test(token)) return reply({ error: 'Link de pagamento inválido.' }, 400)

    const { data: split, error } = await admin.from('order_splits')
      .select('id,order_id,amount,customer_label,customer_email,status,token,orders(order_number,restaurant_id,restaurants(name))')
      .eq('token', token).maybeSingle()
    if (error || !split) return reply({ error: 'Esta divisão não existe ou expirou.' }, 404)
    const { data: payment } = await admin.from('payments')
      .select('id,amount,status,provider_payment_id,pix_qr_code,pix_qr_code_base64,pix_ticket_url')
      .eq('split_id', split.id).maybeSingle()

    if (action === 'status') return reply({ status: payment?.status || split.status, amount: split.amount, customer_label: split.customer_label })
    if (payment?.status === 'pago') return reply({ status: 'pago', amount: split.amount, customer_label: split.customer_label })
    if (payment?.pix_qr_code) return reply({ status: payment.status, amount: split.amount, customer_label: split.customer_label, qr_code: payment.pix_qr_code, qr_code_base64: payment.pix_qr_code_base64, ticket_url: payment.pix_ticket_url })

    const payerEmail = String(input.payer_email || split.customer_email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) return reply({ error: 'Informe um e-mail válido para gerar o Pix.' }, 400)
    const order = Array.isArray(split.orders) ? split.orders[0] : split.orders
    const restaurant = Array.isArray(order?.restaurants) ? order.restaurants[0] : order?.restaurants
    let paymentId = payment?.id
    let idempotencyKey: string

    if (paymentId) {
      const { data: current } = await admin.from('payments').select('idempotency_key').eq('id', paymentId).single()
      idempotencyKey = current?.idempotency_key || crypto.randomUUID()
    } else {
      idempotencyKey = crypto.randomUUID()
      paymentId = crypto.randomUUID()
      const { data: inserted, error: insertError } = await admin.from('payments').insert({
        id: paymentId,
        restaurant_id: order.restaurant_id,
        order_id: split.order_id,
        split_id: split.id,
        amount: split.amount,
        method: 'pix',
        status: 'pendente',
        provider: 'mercado_pago',
        external_reference: paymentId,
        idempotency_key: idempotencyKey,
      }).select('id').single()
      if (insertError || !inserted) return reply({ error: 'Não foi possível iniciar a cobrança Pix.' }, 500)
      paymentId = inserted.id
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/mercadopago-webhook`
    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        transaction_amount: Number(Number(split.amount).toFixed(2)),
        description: `${restaurant?.name || 'COZINFOOD'} · Comanda #${order?.order_number} · ${split.customer_label || 'Divisão da conta'}`.slice(0, 250),
        payment_method_id: 'pix',
        external_reference: paymentId,
        notification_url: webhookUrl,
        payer: { email: payerEmail },
      }),
    })
    const mpData = await mpResponse.json()
    if (!mpResponse.ok) {
      await admin.from('payments').update({ status: 'falhou', webhook_log: [{ at: new Date().toISOString(), error: mpData.message || 'Mercado Pago recusou a cobrança' }] }).eq('id', paymentId)
      return reply({ error: mpData.message || 'Mercado Pago não conseguiu gerar o Pix.' }, 502)
    }
    const transaction = mpData.point_of_interaction?.transaction_data || {}
    const status = mpData.status === 'approved' ? 'pago' : mpData.status === 'rejected' ? 'falhou' : 'aguardando'
    const { error: updateError } = await admin.from('payments').update({
      provider_payment_id: String(mpData.id),
      status,
      pix_qr_code: transaction.qr_code || null,
      pix_qr_code_base64: transaction.qr_code_base64 || null,
      pix_ticket_url: transaction.ticket_url || null,
      webhook_log: [{ at: new Date().toISOString(), event: 'pix_created', provider_status: mpData.status }],
      paid_at: status === 'pago' ? new Date().toISOString() : null,
    }).eq('id', paymentId)
    if (updateError) return reply({ error: 'Pix criado, mas não foi possível salvar os dados. Tente novamente.' }, 500)
    return reply({ status, amount: split.amount, customer_label: split.customer_label, qr_code: transaction.qr_code, qr_code_base64: transaction.qr_code_base64, ticket_url: transaction.ticket_url })
  } catch (error) {
    console.error('create-split-pix:', error)
    return reply({ error: 'Falha inesperada ao gerar o Pix.' }, 500)
  }
})

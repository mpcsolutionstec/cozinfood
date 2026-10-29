import { createClient } from 'npm:@supabase/supabase-js@2'

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply({ error: 'Método não permitido' }, 405)
  const secret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET')
  const accessToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !accessToken || !serviceKey) return reply({ error: 'Webhook não configurado' }, 503)

  try {
    const url = new URL(request.url)
    const body = await request.json()
    const dataId = String(url.searchParams.get('data.id') || body?.data?.id || '').toLowerCase()
    const signature = request.headers.get('x-signature') || ''
    const requestId = request.headers.get('x-request-id') || ''
    const ts = signature.match(/(?:^|,)\s*ts=([^,]+)/)?.[1]
    const suppliedHash = signature.match(/(?:^|,)\s*v1=([^,]+)/)?.[1]
    if (!dataId || !ts || !suppliedHash || !requestId) return reply({ error: 'Assinatura ausente' }, 401)
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)))
    let diff = expected.length ^ suppliedHash.length
    for (let i = 0; i < Math.max(expected.length, suppliedHash.length); i++) diff |= (expected.charCodeAt(i) || 0) ^ (suppliedHash.charCodeAt(i) || 0)
    if (diff !== 0) return reply({ error: 'Assinatura inválida' }, 401)

    const providerResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!providerResponse.ok) return reply({ error: 'Não foi possível validar o pagamento' }, 502)
    const providerPayment = await providerResponse.json()
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } })
    const { data: payment } = await admin.from('payments').select('id,amount,split_id').eq('provider_payment_id', dataId).maybeSingle()
    if (!payment || providerPayment.external_reference !== payment.id || Math.abs(Number(providerPayment.transaction_amount) - Number(payment.amount)) > 0.01) return reply({ error: 'Pagamento não corresponde à cobrança' }, 400)
    const status = providerPayment.status === 'approved' ? 'pago'
      : providerPayment.status === 'rejected' ? 'falhou'
      : providerPayment.status === 'refunded' || providerPayment.status === 'charged_back' ? 'estornado'
      : providerPayment.status === 'cancelled' ? 'cancelado'
      : 'aguardando'
    const { error } = await admin.from('payments').update({
      status,
      paid_at: status === 'pago' ? providerPayment.date_approved || new Date().toISOString() : null,
      webhook_log: [{ received_at: new Date().toISOString(), provider_status: providerPayment.status, notification_id: dataId }],
    }).eq('id', payment.id)
    if (error) return reply({ error: 'Falha ao atualizar o pagamento' }, 500)
    return reply({ received: true })
  } catch (error) {
    console.error('mercadopago-webhook:', error)
    return reply({ error: 'Falha ao processar webhook' }, 500)
  }
})

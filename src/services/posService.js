import { supabase } from '../lib/supabaseClient';

async function unwrap(request) {
  const { data, error } = await request;
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export const savePosOrder = input => unwrap(supabase.rpc('pos_save_order', {
  p_order_type: input.orderType,
  p_table_id: input.tableId || null,
  p_order_id: input.orderId || null,
  p_customer_name: input.customerName || '',
  p_items: input.items,
}));

export const finalizePosOrder = input => unwrap(supabase.rpc('pos_finalize_order', {
  p_order_id: input.orderId,
  p_cash_register_id: input.cashRegisterId,
  p_payments: input.payments,
}));

export const openPosCashRegister = openingAmount => unwrap(supabase.rpc('pos_open_cash_register', {
  p_opening_amount: Number(openingAmount || 0),
}));

export const closePosCashRegister = (registerId, closingAmount) => unwrap(supabase.rpc('pos_close_cash_register', {
  p_cash_register_id: registerId,
  p_closing_amount: Number(closingAmount || 0),
}));

export const createPosPix = input => unwrap(supabase.functions.invoke('create-pos-pix', {
  body: { order_id: input.orderId, cash_register_id: input.cashRegisterId },
}));

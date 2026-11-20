import { create } from 'zustand';
import { supabase } from '../lib/supabaseClient';

const unwrap = async request => {
  const { data, error } = await request;
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export const useCashRegisterStore = create((set, get) => ({
  register: null,
  movements: [],
  loading: false,
  error: '',
  setRegister: register => set({ register }),
  loadRegister: async restaurantId => {
    if (!supabase || !restaurantId) return null;
    set({ loading: true, error: '' });
    try {
      const { data, error } = await supabase.rpc('get_open_cash_register');
      if (error) throw error;
      set({ register: data || null, loading: false });
      return data || null;
    } catch (error) {
      set({ error: error.message || 'Falha ao consultar o turno.', loading: false });
      throw error;
    }
  },
  loadMovements: async (registerId, isAdmin) => {
    if (!supabase || !registerId || !isAdmin) { set({ movements: [] }); return []; }
    const { data, error } = await supabase.from('cash_movements')
      .select('id,type,payment_method,amount,description,created_at,category_id,created_by,profiles(full_name)')
      .eq('cash_register_id', registerId).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    set({ movements: data || [] });
    return data || [];
  },
  openRegister: async openingAmount => {
    const register = await unwrap(supabase.rpc('open_finance_cash_register', { p_opening_amount: Number(openingAmount || 0) }));
    set({ register, movements: [], error: '' });
    return register;
  },
  recordMovement: async input => {
    const movement = await unwrap(supabase.rpc('create_cash_movement', {
      p_cash_register_id: input.registerId,
      p_type: input.type,
      p_amount: Number(input.amount),
      p_description: input.description,
      p_category_id: input.categoryId || null,
      p_manager_password: input.managerPassword || null,
    }));
    if (input.isAdmin) set(state => ({ movements: [movement, ...state.movements] }));
    return movement;
  },
  closeRegister: async input => {
    const audit = await unwrap(supabase.rpc('close_cash_register_blind', {
      p_cash_register_id: input.registerId,
      p_counted_breakdown: Object.fromEntries(Object.entries(input.countedBreakdown).map(([method, amount]) => [method, Number(amount || 0)])),
      p_justification: input.justification || '',
    }));
    set({ register: null, movements: [], error: '' });
    return audit;
  },
  clear: () => set({ register: null, movements: [], error: '', loading: false }),
}));

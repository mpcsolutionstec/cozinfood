import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const cartKey = item => `${item.product.id}:${item.fraction?.id || 'base'}:${(item.flavors || []).map(flavor => `${flavor.product.id}-${flavor.fraction.id}`).join(',')}:${(item.additions || []).map(addition => `${addition.id}-${addition.quantity || 1}`).sort().join(',')}:${item.border?.id || ''}:${String(item.notes || '').trim().toLocaleLowerCase('pt-BR')}`;

export const useWaiterStore = create(persist((set, get) => ({
  selectedTable: null,
  guestCount: 2,
  carts: {},
  pendingByTable: {},
  selectTable: selectedTable => set({ selectedTable }),
  setGuestCount: guestCount => set({ guestCount: Math.max(1, Math.min(30, Number(guestCount) || 1)) }),
  addItem: (tableId, item) => set(state => {
    const cart = state.carts[tableId] || [];
    const key = item.key || cartKey(item);
    const existing = cart.find(row => row.key === key);
    return { carts: { ...state.carts, [tableId]: existing
      ? cart.map(row => row.key === key ? { ...row, quantity: Math.min(99, row.quantity + Number(item.quantity || 1)) } : row)
      : [...cart, { ...item, key, quantity: Math.max(1, Number(item.quantity) || 1), notes: item.notes || '' }] } };
  }),
  setQuantity: (tableId, key, quantity) => set(state => {
    const cart = state.carts[tableId] || [];
    const amount = Math.max(0, Math.min(99, Number(quantity) || 0));
    return { carts: { ...state.carts, [tableId]: amount === 0
      ? cart.filter(item => item.key !== key)
      : cart.map(item => item.key === key ? { ...item, quantity: amount } : item) } };
  }),
  setItemNote: (tableId, key, notes) => set(state => ({ carts: { ...state.carts, [tableId]: (state.carts[tableId] || []).map(item => item.key === key ? { ...item, notes } : item) } })),
  clearCart: tableId => set(state => ({ carts: { ...state.carts, [tableId]: [] } })),
  queueOrder: (tableId, order) => set(state => ({ pendingByTable: { ...state.pendingByTable, [tableId]: order } })),
  clearPendingOrder: tableId => set(state => {
    const pendingByTable = { ...state.pendingByTable };
    delete pendingByTable[tableId];
    return { pendingByTable };
  }),
  leaveTable: () => set({ selectedTable: null }),
}), {
  name: 'cozinfood:waiter:v1',
  partialize: state => ({ selectedTable: state.selectedTable, guestCount: state.guestCount, carts: state.carts, pendingByTable: state.pendingByTable }),
}));

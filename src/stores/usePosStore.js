import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const usePosStore = create(persist((set, get) => ({
  mode: 'balcao',
  cart: [],
  selectedTable: null,
  activeOrder: null,
  setMode: mode => set({ mode, selectedTable: mode === 'balcao' ? null : get().selectedTable }),
  setSelectedTable: selectedTable => set({ selectedTable }),
  setActiveOrder: activeOrder => set({ activeOrder }),
  addItem: (product, fraction = null, additions = [], flavors = [], unitPrice = null) => set(state => {
    const additionKey = additions.map(addition => addition.id).sort().join(',');
    const flavorKey = flavors.map(flavor => `${flavor.product.id}:${flavor.fraction?.id}:${flavor.share}`).join(',');
    const key = `${product.id}:${fraction?.id || 'base'}:${flavorKey}:${additionKey}`;
    const current = state.cart.find(item => item.key === key);
    if (current) return { cart: state.cart.map(item => item.key === key ? { ...item, quantity: item.quantity + 1 } : item) };
    return { cart: [...state.cart, { key, product, fraction, additions, flavors, unitPrice, quantity: 1, notes: '' }] };
  }),
  setQuantity: (key, quantity) => set(state => ({ cart: state.cart
    .map(item => item.key === key ? { ...item, quantity: Math.max(0, Number(quantity) || 0) } : item)
    .filter(item => item.quantity > 0) })),
  setNote: (key, notes) => set(state => ({ cart: state.cart.map(item => item.key === key ? { ...item, notes } : item) })),
  hydrateCatalog: (products, additions) => set(state => {
    const byProduct = new Map(products.map(product => [product.id, product]));
    const byAddition = new Map(additions.map(addition => [addition.id, addition]));
    return { cart: state.cart.map(item => {
      const product = byProduct.get(item.product.id);
      if (!product) return item;
      const fraction = item.fraction?.id ? product.product_fractions?.find(option => option.id === item.fraction.id) || item.fraction : null;
      const flavors = (item.flavors || []).map(flavor => {
        const flavorProduct = byProduct.get(flavor.product.id) || flavor.product;
        const flavorFraction = flavor.fraction?.id ? flavorProduct.product_fractions?.find(option => option.id === flavor.fraction.id) || flavor.fraction : null;
        return { ...flavor, product: flavorProduct, fraction: flavorFraction };
      });
      return { ...item, product, fraction, flavors, additions: (item.additions || []).map(addition => byAddition.get(addition.id) || addition) };
    }) };
  }),
  removeItem: key => set(state => ({ cart: state.cart.filter(item => item.key !== key) })),
  clearCart: () => set({ cart: [] }),
  clearSession: () => set({ cart: [], selectedTable: null, activeOrder: null }),
}), {
  name: 'cozinfood:pos-draft:v1',
  partialize: state => ({ mode: state.mode, cart: state.cart }),
}));

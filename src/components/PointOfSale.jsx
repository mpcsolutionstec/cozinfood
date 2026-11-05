import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, Banknote, Check, ChefHat, CircleDollarSign, Clock3, CreditCard, Plus, QrCode, Search, ShoppingCart, Trash2, Utensils, Wallet, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from './AuthGate';
import { useTableStatus } from '../hooks/useTableStatus';
import { supabase } from '../lib/supabaseClient';
import { closePosCashRegister, createPosPix, finalizePosOrder, openPosCashRegister, savePosOrder } from '../services/posService';
import { usePosStore } from '../stores/usePosStore';
import QuantityControl from './QuantityControl';

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const paymentOptions = [
  { key: 'cash', log: 'dinheiro', label: 'Dinheiro', icon: Banknote },
  { key: 'credit_card', log: 'credito', label: 'Crédito', icon: CreditCard },
  { key: 'debit_card', log: 'debito', label: 'Débito', icon: CreditCard },
];
const itemStatus = { pendente: 'Na fila', em_preparo: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado' };
const publicImage = product => {
  if (product?.image_url?.trim()) return product.image_url.trim();
  return product?.image_path && supabase ? supabase.storage.from('product-images').getPublicUrl(product.image_path).data.publicUrl : '';
};

export default function PointOfSale() {
  const { profile } = useAuth();
  const { tables, loading: tablesLoading, refresh: refreshTables } = useTableStatus();
  const mode = usePosStore(state => state.mode);
  const cart = usePosStore(state => state.cart);
  const selectedTable = usePosStore(state => state.selectedTable);
  const activeOrder = usePosStore(state => state.activeOrder);
  const setMode = usePosStore(state => state.setMode);
  const setSelectedTable = usePosStore(state => state.setSelectedTable);
  const setActiveOrder = usePosStore(state => state.setActiveOrder);
  const addItem = usePosStore(state => state.addItem);
  const setProductQuantity = usePosStore(state => state.setProductQuantity);
  const setQuantity = usePosStore(state => state.setQuantity);
  const setNote = usePosStore(state => state.setNote);
  const removeItem = usePosStore(state => state.removeItem);
  const clearCart = usePosStore(state => state.clearCart);
  const clearSession = usePosStore(state => state.clearSession);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [availableAdditions, setAvailableAdditions] = useState([]);
  const [fractionPricing, setFractionPricing] = useState('maior_valor');
  const [orderItems, setOrderItems] = useState([]);
  const [register, setRegister] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [dialog, setDialog] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('0');
  const [closingAmount, setClosingAmount] = useState('');
  const [expectedCash, setExpectedCash] = useState(0);
  const [paymentRows, setPaymentRows] = useState([]);
  const cashChange = paymentRows.reduce((sum, row) => row.method === 'cash'
    ? sum + Math.max(0, Number(row.cash_received || 0) - Number(row.amount || 0))
    : sum, 0);
  const [pix, setPix] = useState(null);
  const [pixStatus, setPixStatus] = useState('');
  const [copyDone, setCopyDone] = useState(false);
  const [noticeItemId, setNoticeItemId] = useState('');
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [customProduct, setCustomProduct] = useState(null);
  const [customFraction, setCustomFraction] = useState(null);
  const [customSizeName, setCustomSizeName] = useState('');
  const [customFlavorCount, setCustomFlavorCount] = useState(1);
  const [customFlavorIds, setCustomFlavorIds] = useState([]);
  const [customAdditions, setCustomAdditions] = useState([]);
  const searchRef = useRef(null);
  const isCashier = ['admin', 'caixa'].includes(profile?.role);

  const loadRegister = useCallback(async () => {
    if (!supabase || !profile?.restaurant_id || !isCashier) return;
    const { data, error: queryError } = await supabase.from('cash_registers').select('*')
      .eq('restaurant_id', profile.restaurant_id).eq('status', 'aberto').maybeSingle();
    if (!queryError) setRegister(data || null);
    else setError(`Falha ao consultar o caixa: ${queryError.message}`);
  }, [profile?.restaurant_id, isCashier]);

  const loadCatalog = useCallback(async () => {
    if (!supabase || !profile?.restaurant_id) return;
    const [categoryResult, productResult, additionResult, restaurantResult] = await Promise.all([
      supabase.from('categories').select('id,name,sort_order').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('sort_order'),
      supabase.from('products').select('id,name,description,base_price,prep_minutes,destination_sector,image_url,image_path,barcode,category_id,categories(name,slug),product_fractions(id,name,price,serves,active)')
        .eq('restaurant_id', profile.restaurant_id).eq('active', true).order('name'),
      supabase.from('product_additions').select('id,name,price').eq('restaurant_id', profile.restaurant_id).eq('active', true).order('name'),
      supabase.from('restaurants').select('fraction_pricing').eq('id', profile.restaurant_id).single(),
    ]);
    if (categoryResult.error || productResult.error || additionResult.error || restaurantResult.error) {
      setError(`Falha ao carregar o cardapio: ${(categoryResult.error || productResult.error || additionResult.error || restaurantResult.error).message}`);
      return;
    }
    setCategories(categoryResult.data || []);
    setProducts((productResult.data || []).map(product => ({ ...product, product_fractions: (product.product_fractions || []).filter(fraction => fraction.active) })));
    setAvailableAdditions(additionResult.data || []);
    setFractionPricing(restaurantResult.data?.fraction_pricing || 'maior_valor');
    usePosStore.getState().hydrateCatalog(
      (productResult.data || []).map(product => ({ ...product, product_fractions: (product.product_fractions || []).filter(fraction => fraction.active) })),
      additionResult.data || [],
    );
  }, [profile?.restaurant_id]);

  const loadActiveOrder = useCallback(async table => {
    if (!table || !supabase) return null;
    const { data, error: orderError } = await supabase.from('orders')
      .select('id,order_number,status,total,payment_state,created_at')
      .eq('table_id', table.id).not('status', 'in', '(entregue,cancelado)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (orderError) throw orderError;
    if (!data) {
      setActiveOrder(null);
      setOrderItems([]);
      return null;
    }
    const [{ data: itemData }, { data: paymentsData }] = await Promise.all([
      supabase.from('order_items').select('id,name,quantity,unit_price,line_total,fraction_label,status,notes,created_at')
        .eq('order_id', data.id).order('created_at'),
      supabase.from('payments').select('amount').eq('order_id', data.id).eq('status', 'pago'),
    ]);
    const paidAmount = (paymentsData || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const order = { ...data, paid_amount: paidAmount };
    setActiveOrder(order);
    setOrderItems(itemData || []);
    return order;
  }, [setActiveOrder]);

  useEffect(() => { loadCatalog(); loadRegister(); }, [loadCatalog, loadRegister]);
  useEffect(() => {
    if (!supabase || !profile?.restaurant_id) return undefined;
    const channel = supabase.channel(`pos-${profile.restaurant_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `restaurant_id=eq.${profile.restaurant_id}` }, refreshTables)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${profile.restaurant_id}` }, () => {
        if (selectedTable) loadActiveOrder(selectedTable).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        if (selectedTable) loadActiveOrder(selectedTable).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_registers', filter: `restaurant_id=eq.${profile.restaurant_id}` }, loadRegister)
      .subscribe(status => setRealtimeConnected(status === 'SUBSCRIBED'));
    return () => { setRealtimeConnected(false); supabase.removeChannel(channel); };
  }, [profile?.restaurant_id, selectedTable, refreshTables, loadActiveOrder, loadRegister]);

  useEffect(() => {
    if (!pix?.payment_id || !supabase) return undefined;
    let active = true;
    const checkPayment = async () => {
      const { data } = await supabase.from('payments').select('status').eq('id', pix.payment_id).maybeSingle();
      if (active && data?.status === 'pago') {
        setPixStatus('Pix confirmado. Pagamento registrado no caixa.');
        if (selectedTable) await loadActiveOrder(selectedTable).catch(() => {});
        setTimeout(() => { if (active) { setDialog(''); setPix(null); setPixStatus(''); } }, 1800);
      }
    };
    checkPayment();
    const timer = window.setInterval(checkPayment, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pix?.payment_id, selectedTable, loadActiveOrder]);

  const filteredProducts = useMemo(() => products.filter(product => {
    const matchesCategory = categoryId === 'all' || product.category_id === categoryId;
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    const matchesSearch = !needle || [product.name, product.description, product.barcode, product.categories?.name]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(needle));
    return matchesCategory && matchesSearch;
  }), [products, categoryId, search]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + (Number(item.unitPrice ?? item.fraction?.price ?? item.product.base_price) + (item.additions || []).reduce((total, addition) => total + Number(addition.price || 0) * Number(addition.quantity || 1), 0)) * item.quantity, 0), [cart]);
  const activeOrderTotal = Number(activeOrder?.total || 0);
  const totalDue = Math.max(0, activeOrderTotal + cartTotal - Number(activeOrder?.paid_amount || 0));
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const tableOrdersTotal = orderItems.filter(item => item.status !== 'cancelado').reduce((sum, item) => sum + Number(item.line_total || 0), 0);

  const selectMode = nextMode => {
    if (nextMode === mode) return;
    if (cart.length) { setError('Envie ou remova os itens do carrinho antes de trocar o modo.'); return; }
    setError(''); setMessage(''); setMode(nextMode);
    setSelectedTable(null); setActiveOrder(null); setOrderItems([]);
  };

  const selectTable = async table => {
    if (cart.length && selectedTable?.id !== table.id) { setError('Envie os itens atuais antes de mudar de mesa.'); return; }
    setError(''); setMessage(''); setSelectedTable(table);
    try { await loadActiveOrder(table); }
    catch (loadError) { setError(`Não foi possível abrir a comanda: ${loadError.message}`); }
  };

  const saveCart = async () => {
    if (!cart.length) return activeOrder;
    if (mode === 'salao' && !selectedTable) throw new Error('Selecione uma mesa antes de enviar o pedido.');
    const saved = await savePosOrder({
      orderType: mode === 'salao' ? 'salao' : 'balcao',
      tableId: mode === 'salao' ? selectedTable.id : null,
      orderId: activeOrder?.id,
      customerName: '',
      items: cart.map(item => ({ product_id: item.product.id, fraction_id: item.fraction?.id || null, quantity: item.quantity, notes: item.notes, additions: (item.additions || []).map(addition => ({ id: addition.id, quantity: addition.quantity || 1 })), flavors: (item.flavors || []).map(flavor => ({ product_id: flavor.product.id, product_fraction_id: flavor.fraction?.id || null, fraction: flavor.share })) })),
    });
    setActiveOrder({ ...saved, paid_amount: activeOrder?.paid_amount || 0 });
    clearCart();
    if (mode === 'salao') await loadActiveOrder(selectedTable);
    return saved;
  };

  const sendToKitchen = async () => {
    if (!cart.length) { setError('Adicione ao menos um item antes de enviar.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveCart();
      setMessage(mode === 'salao' ? `Itens enviados para a cozinha · Comanda #${saved.order_number}.` : `Venda #${saved.order_number} enviada para a produção.`);
      if (mode === 'balcao') { setActiveOrder(null); }
    } catch (saveError) { setError(`Não foi possível enviar o pedido: ${saveError.message}`); }
    finally { setBusy(false); }
  };

  const openPayment = () => {
    if (!isCashier) { setError('O recebimento no PDV é liberado para os perfis administrador e caixa.'); return; }
    if (!register) { setError('Abra o caixa antes de finalizar o pagamento.'); setDialog('register-open'); return; }
    if (!cart.length && !activeOrder) { setError('Adicione itens ou abra uma comanda antes de finalizar.'); return; }
    setError(''); setPaymentRows([{ method: 'cash', amount: totalDue.toFixed(2), cash_received: totalDue.toFixed(2) }]);
    setPix(null); setPixStatus(''); setDialog('payment');
  };

  useEffect(() => {
    const onKeyDown = event => {
      if (dialog) {
        if (event.key === 'Escape') { event.preventDefault(); setDialog(''); setPix(null); }
        return;
      }
      if (event.key === 'F2') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === 'F3') { event.preventDefault(); selectMode(mode === 'salao' ? 'balcao' : 'salao'); }
      if (event.key === 'F4') { event.preventDefault(); openPayment(); }
      if (event.key === 'Escape' && cart.length) {
        const target = event.target;
        if (target instanceof HTMLElement && ['INPUT','TEXTAREA','SELECT'].includes(target.tagName)) return;
        event.preventDefault(); removeItem(cart[cart.length - 1].key);
        setMessage('Último item removido do carrinho.');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, cart, setMode, removeItem, register, isCashier, activeOrder, totalDue, selectedTable, dialog]);

  const openCashClose = async () => {
    if (!register) return;
    const { data } = await supabase.from('payments_log').select('value_paid')
      .eq('cash_register_id', register.id).eq('payment_method', 'dinheiro').eq('status', 'pago');
    const expected = Number(register.opening_amount || 0) + (data || []).reduce((sum, row) => sum + Number(row.value_paid || 0), 0);
    setExpectedCash(expected); setClosingAmount(expected.toFixed(2)); setDialog('register-close'); setError('');
  };

  const submitOpenRegister = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { setRegister(await openPosCashRegister(openingAmount)); setDialog(''); setMessage('Caixa aberto para este turno.'); }
    catch (openError) { setError(openError.message); }
    setBusy(false);
  };

  const submitCloseRegister = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await closePosCashRegister(register.id, closingAmount); setRegister(null); setDialog(''); setMessage(`Caixa fechado. Diferença: ${money(Number(closingAmount || 0) - expectedCash)}.`); }
    catch (closeError) { setError(closeError.message); }
    setBusy(false);
  };

  const updatePaymentRow = (index, field, value) => setPaymentRows(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  const addPaymentRow = () => setPaymentRows(rows => [...rows, { method: 'credit_card', amount: '', cash_received: '' }]);
  const removePaymentRow = index => setPaymentRows(rows => rows.filter((_, rowIndex) => rowIndex !== index));

  const ensureOrderForCheckout = async () => {
    const saved = await saveCart();
    if (!saved?.id) throw new Error('Não foi possível abrir a venda para pagamento.');
    const { data: paidRows } = await supabase.from('payments').select('amount').eq('order_id', saved.id).eq('status', 'pago');
    const paid = (paidRows || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { ...saved, paid_amount: paid };
  };

  const submitPayment = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const targetOrder = await ensureOrderForCheckout();
      const payments = paymentRows.map(row => ({ method: row.method, amount: Number(row.amount || 0), cash_received: Number(row.cash_received || row.amount || 0) }));
      const sum = payments.reduce((total, row) => total + row.amount, 0);
      const due = Math.max(0, Number(targetOrder.total || 0) - Number(targetOrder.paid_amount || 0));
      if (Math.abs(sum - due) > 0.01) throw new Error(`Os pagamentos somam ${money(sum)}; o saldo é ${money(due)}.`);
      const result = await finalizePosOrder({
        orderId: targetOrder.id, cashRegisterId: register.id, payments,
      });
      setDialog(''); setPaymentRows([]); setPix(null); setMessage(`Venda paga. Troco: ${money(result?.change || 0)}.`);
      if (mode === 'salao' && selectedTable) await loadActiveOrder(selectedTable);
      else clearSession();
    } catch (paymentError) { setError(`Não foi possível concluir o pagamento: ${paymentError.message}`); }
    finally { setBusy(false); }
  };

  const createPix = async () => {
    setBusy(true); setError(''); setPixStatus('');
    try {
      const targetOrder = await ensureOrderForCheckout();
      const data = await createPosPix({
        orderId: targetOrder.id, cashRegisterId: register.id,
      });
      if (!data?.qr_code) throw new Error(data?.error || 'A cobrança não retornou um QR Code.');
      setActiveOrder({ ...targetOrder, paid_amount: targetOrder.paid_amount });
      setPix(data); setPixStatus('Aguardando pagamento Pix. Esta tela atualiza quando o banco confirmar.');
      setPaymentRows([]);
    } catch (pixError) { setError(`Não foi possível gerar o Pix: ${pixError.message}`); }
    finally { setBusy(false); }
  };

  const cancelOrderItem = async item => {
    if (item.status !== 'pendente') { setError('Um item que já entrou em preparo não pode ser cancelado pelo PDV.'); return; }
    if (noticeItemId !== item.id) { setNoticeItemId(item.id); return; }
    setBusy(true); setError('');
    const { error: cancelError } = await supabase.from('order_items').update({ status: 'cancelado' }).eq('id', item.id).eq('order_id', activeOrder.id).eq('status', 'pendente');
    if (cancelError) setError(`Não foi possível cancelar o item: ${cancelError.message}`);
    else { setMessage(`${item.name} cancelado antes do preparo.`); setNoticeItemId(''); await loadActiveOrder(selectedTable); }
    setBusy(false);
  };

  const catalogQuantity = (product, fraction = null) => cart.find(item => item.key === `${product.id}:${fraction?.id || 'base'}::`)?.quantity || 0;
  const setCatalogQuantity = (product, fraction, quantity) => {
    setProductQuantity(product, fraction, quantity);
    setError('');
  };

  const customizeProduct = (product, fraction = null) => {
    const initialSize = fraction?.name || product.product_fractions?.[0]?.name || '';
    setCustomProduct(product); setCustomFraction(fraction); setCustomSizeName(initialSize);
    setCustomFlavorCount(1); setCustomFlavorIds([product.id]); setCustomAdditions([]); setError(''); setDialog('customize');
  };
  const addCustomizedProduct = () => {
    if (!customProduct) return;
    const isPizza = customProduct.categories?.slug === 'pizzas';
    const selectedFlavors = isPizza ? customFlavorIds.slice(0, customFlavorCount).map(id => {
      const product = products.find(option => option.id === id);
      const fraction = product?.product_fractions?.find(option => option.name === customSizeName);
      return product && fraction ? { product, fraction, share: 1 / customFlavorCount } : null;
    }).filter(Boolean) : [];
    if (isPizza && selectedFlavors.length !== customFlavorCount) { setError('Escolha todos os sabores e confirme o tamanho da pizza.'); return; }
    const primaryProduct = selectedFlavors[0]?.product || customProduct;
    const primaryFraction = selectedFlavors[0]?.fraction || customFraction;
    const prices = selectedFlavors.map(flavor => Number(flavor.fraction.price));
    const basePrice = selectedFlavors.length
      ? fractionPricing === 'media_ponderada' ? prices.reduce((sum, price) => sum + price / prices.length, 0) : Math.max(...prices)
      : Number(primaryFraction?.price ?? primaryProduct.base_price);
    addItem(primaryProduct, primaryFraction, customAdditions, selectedFlavors, basePrice);
    setDialog(''); setCustomProduct(null); setCustomFraction(null); setCustomAdditions([]);
  };
  const customSelectedFlavors = customProduct?.categories?.slug === 'pizzas' ? customFlavorIds.slice(0, customFlavorCount).map(id => {
    const product = products.find(option => option.id === id);
    return product ? { product, fraction: product.product_fractions?.find(option => option.name === customSizeName) } : null;
  }).filter(Boolean) : [];
  const customBasePrice = customSelectedFlavors.length
    ? fractionPricing === 'media_ponderada'
      ? customSelectedFlavors.reduce((sum, flavor) => sum + Number(flavor.fraction?.price || 0) / customSelectedFlavors.length, 0)
      : Math.max(...customSelectedFlavors.map(flavor => Number(flavor.fraction?.price || 0)))
    : Number(customFraction?.price ?? customProduct?.base_price ?? 0);
  const customPrice = customBasePrice
    + customAdditions.reduce((sum, addition) => sum + Number(addition.price || 0), 0);

  return <section className="pos-page" aria-label="Ponto de venda">
    <header className="pos-header">
      <div><span className="pos-eyebrow">PONTO DE VENDA</span><h1>PDV híbrido</h1><p>Atenda no balcão ou lance itens diretamente na mesa.</p></div>
      <div className="pos-header-actions">
        <div className="pos-modes" role="group" aria-label="Modo de venda">
          <button className={mode === 'balcao' ? 'active' : ''} onClick={() => selectMode('balcao')}><ShoppingCart size={17}/> Balcão</button>
          <button className={mode === 'salao' ? 'active' : ''} onClick={() => selectMode('salao')}><Utensils size={17}/> Salão / Mesas</button>
        </div>
        <div className={`pos-register ${register ? 'open' : ''}`}>
          <span className="pos-register-dot"/><span>Caixa {register ? 'aberto' : 'fechado'}</span>
          {isCashier && (register
            ? <button onClick={openCashClose}>Fechar caixa</button>
            : <button onClick={() => { setError(''); setDialog('register-open'); }}>Abrir caixa</button>)}
        </div>
      </div>
    </header>

    {error && <div className="pos-alert error" role="alert"><X size={17}/><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar mensagem"><X size={15}/></button></div>}
    {message && <div className="pos-alert success" role="status"><Check size={17}/><span>{message}</span><button onClick={() => setMessage('')} aria-label="Fechar mensagem"><X size={15}/></button></div>}

    <div className="pos-workspace">
      <section className="pos-catalog-panel">
        {mode === 'salao' && <section className="pos-tables-panel">
          <div className="pos-section-heading"><div><h2>Mesas</h2><p>Selecione a mesa para abrir ou continuar a comanda.</p></div><button className="pos-refresh" onClick={refreshTables} title="Atualizar mesas"><Clock3 size={16}/></button></div>
          {tablesLoading ? <div className="pos-skeleton">Carregando mesas…</div> : tables.length === 0 ? <div className="pos-empty">Cadastre as mesas na página Salão e mesas para começar.</div> : <div className="pos-table-grid">{tables.map(table => <button key={table.id} className={`pos-table ${table.status} ${selectedTable?.id === table.id ? 'selected' : ''}`} onClick={() => selectTable(table)}>
            <span className="pos-table-icon"><Utensils size={18}/></span><b>Mesa {table.number}</b><small>{table.status === 'livre' ? 'Livre' : table.status === 'aguardando_conta' ? 'Aguardando conta' : table.status === 'reservada' ? 'Reservada' : 'Ocupada'}</small>{Number(table.current_total) > 0 && <strong>{money(table.current_total)}</strong>}
          </button>)}</div>}
        </section>}

        <div className="pos-section-heading pos-catalog-heading"><div><h2>Produtos</h2><p>Toque em um produto para adicioná-lo à venda.</p></div><span className={`pos-online ${realtimeConnected ? 'connected' : ''}`}><i/>{realtimeConnected ? 'Realtime ativo' : 'Reconectando'}</span></div>
        <label className="pos-search"><span className="sr-only">Buscar produto por nome ou código de barras</span><Search size={19}/><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar produto ou ler código de barras · F2"/><Barcode size={19}/></label>
        <nav className="pos-category-list"><button className={categoryId === 'all' ? 'active' : ''} onClick={() => setCategoryId('all')}>Todos</button>{categories.map(category => <button key={category.id} className={categoryId === category.id ? 'active' : ''} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</nav>
        {filteredProducts.length === 0 ? <div className="pos-empty">Nenhum produto encontrado.</div> : <div className="pos-product-grid">{filteredProducts.map(product => {
          const image = publicImage(product);
          const fractions = product.product_fractions || [];
          return <article className="pos-product" key={product.id}>
            {image ? <img src={image} alt="" onError={event => { event.currentTarget.style.display = 'none'; }}/> : <span className="pos-product-placeholder"><ChefHat size={23}/></span>}
            <div className="pos-product-info"><span>{product.categories?.name || 'Cardápio'}</span><b>{product.name}</b>{product.description && <small>{product.description}</small>}</div>
            {fractions.length ? <div className="pos-product-fractions">{fractions.map(fraction => <div className="pos-product-fraction-option" key={fraction.id}><span>{fraction.name}</span><b>{money(fraction.price)}</b><QuantityControl compact label={`${product.name} ${fraction.name}`} value={catalogQuantity(product, fraction)} onChange={quantity => setCatalogQuantity(product, fraction, quantity)}/></div>)}</div> : <div className="pos-product-add"><b>{money(product.base_price)}</b><QuantityControl compact label={product.name} value={catalogQuantity(product)} onChange={quantity => setCatalogQuantity(product, null, quantity)}/></div>}
            {(availableAdditions.length > 0 || product.categories?.slug === 'pizzas') && <button className="pos-customize-product" onClick={() => customizeProduct(product)}><Plus size={13}/> {product.categories?.slug === 'pizzas' ? 'Montar pizza / adicionais' : 'Personalizar / adicionais'}</button>}
          </article>;
        })}</div>}
      </section>

      <aside className="pos-ticket">
        <header className="pos-ticket-header"><div><h2>{mode === 'salao' ? selectedTable ? `Mesa ${selectedTable.number}` : 'Comanda da mesa' : 'Venda de balcão'}</h2><p>{activeOrder ? `Comanda #${activeOrder.order_number} · ${itemStatus[activeOrder.status] || activeOrder.status}` : 'Novo pedido'}</p></div><span className="pos-ticket-count">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</span></header>
        {mode === 'salao' && !selectedTable && <div className="pos-ticket-empty"><Utensils size={28}/><b>Escolha uma mesa</b><span>O pedido será associado a ela.</span></div>}
        {mode === 'salao' && selectedTable && orderItems.length > 0 && <section className="pos-existing-items"><div className="pos-subheading"><b>Itens da comanda</b><small>{activeOrder ? `#${activeOrder.order_number}` : ''}</small></div>{orderItems.filter(item => item.status !== 'cancelado').map(item => <div className="pos-existing-item" key={item.id}><span className="pos-item-qty">{Number(item.quantity)}×</span><div className="pos-item-description"><b>{item.name}</b><small>{item.fraction_label || itemStatus[item.status] || item.status}</small></div><strong>{money(item.line_total)}</strong>{item.status === 'pendente' && <button className="pos-cancel-item" onClick={() => cancelOrderItem(item)} disabled={busy} aria-label={`Cancelar ${item.name}`} title={noticeItemId === item.id ? 'Clique novamente para confirmar' : 'Cancelar item'}>{noticeItemId === item.id ? <Check size={15}/> : <Trash2 size={15}/>}</button>}</div>)}</section>}
        {cart.length > 0 && <section className="pos-cart-items"><div className="pos-subheading"><b>{mode === 'salao' ? 'Novos itens' : 'Itens da venda'}</b><small>{itemCount}</small></div>{cart.map(item => {
          const price = Number(item.unitPrice ?? item.fraction?.price ?? item.product.base_price) + (item.additions || []).reduce((sum, addition) => sum + Number(addition.price || 0) * Number(addition.quantity || 1), 0);
          const image = publicImage(item.product);
          return <article className="pos-cart-line" key={item.key}>
            {image ? <img src={image} alt="" onError={event => { event.currentTarget.style.display = 'none'; }}/> : <span className="pos-cart-placeholder"><ShoppingCart size={15}/></span>}
            <div className="pos-cart-line-main"><b>{item.flavors?.length > 1 ? `Pizza · ${item.flavors.length} sabores` : item.product.name}</b>{item.fraction && <small>{item.fraction.name}</small>}{item.flavors?.length > 1 && <small>{item.flavors.map(flavor => `${Math.round(flavor.share * 100)}% ${flavor.product.name}`).join(' · ')}</small>}{item.additions?.length > 0 && <small>Adicionais: {item.additions.map(addition => addition.name).join(', ')}</small>}<input value={item.notes} onChange={event => setNote(item.key, event.target.value)} placeholder="Observação (opcional)" aria-label={`Observação para ${item.product.name}`}/><QuantityControl label={item.product.name} value={item.quantity} onChange={quantity => setQuantity(item.key, quantity)}/></div>
            <div className="pos-cart-line-total"><b>{money(price * item.quantity)}</b><small>{money(price)} cada</small><button onClick={() => removeItem(item.key)} aria-label="Remover do carrinho"><Trash2 size={15}/></button></div>
          </article>;
        })}</section>}
        {mode === 'balcao' && cart.length === 0 && <div className="pos-ticket-empty"><ShoppingCart size={28}/><b>Carrinho vazio</b><span>Busque e selecione produtos para começar.</span></div>}
        {mode === 'salao' && selectedTable && !orderItems.length && !cart.length && <div className="pos-ticket-empty"><Utensils size={28}/><b>Mesa pronta para atendimento</b><span>Adicione produtos para iniciar a comanda.</span></div>}
        <div className="pos-ticket-summary">
          {mode === 'salao' && activeOrder && <div><span>Comanda atual</span><b>{money(tableOrdersTotal)}</b></div>}
          {cart.length > 0 && <div><span>{mode === 'salao' ? 'Novos itens' : 'Subtotal'}</span><b>{money(cartTotal)}</b></div>}
          <div className="pos-ticket-total"><span>Total {mode === 'salao' ? 'da comanda' : 'da venda'}</span><strong>{money(mode === 'salao' ? tableOrdersTotal + cartTotal : cartTotal)}</strong></div>
          {mode === 'balcao' ? <button className="pos-primary" onClick={openPayment} disabled={!cart.length || busy}><CircleDollarSign size={18}/> Finalizar pagamento <kbd>F4</kbd></button> : <div className="pos-salon-actions"><button className="pos-primary" onClick={sendToKitchen} disabled={!cart.length || !selectedTable || busy}><ChefHat size={18}/> Enviar à produção</button><button className="pos-secondary" onClick={openPayment} disabled={!activeOrder && !cart.length || busy}><Wallet size={17}/> Fechar conta</button></div>}
          <small className="pos-shortcuts">F2 buscar · F3 alternar modo · F4 pagamento · Esc remover último item</small>
        </div>
      </aside>
    </div>

    {dialog && <div className="pos-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(''); }}>
      {dialog === 'register-open' && <form className="pos-modal" onSubmit={submitOpenRegister}>
        <button type="button" className="pos-modal-close" onClick={() => setDialog('')} aria-label="Fechar"><X size={19}/></button><span className="pos-modal-icon"><Wallet size={23}/></span><h2>Abrir caixa</h2><p>Informe o valor inicial que ficará disponível para troco.</p><label>Fundo de caixa<input autoFocus type="number" min="0" step="0.01" value={openingAmount} onChange={event => setOpeningAmount(event.target.value)} required/></label>{error && <p className="pos-modal-error">{error}</p>}<button className="pos-primary" disabled={busy}>{busy ? 'Abrindo…' : 'Abrir caixa'}</button>
      </form>}
      {dialog === 'register-close' && <form className="pos-modal" onSubmit={submitCloseRegister}>
        <button type="button" className="pos-modal-close" onClick={() => setDialog('')} aria-label="Fechar"><X size={19}/></button><span className="pos-modal-icon"><Wallet size={23}/></span><h2>Fechar caixa</h2><p>Confira o dinheiro físico e registre o valor contado.</p><div className="pos-cash-expected"><span>Esperado em dinheiro</span><b>{money(expectedCash)}</b></div><label>Valor contado<input autoFocus type="number" min="0" step="0.01" value={closingAmount} onChange={event => setClosingAmount(event.target.value)} required/></label>{error && <p className="pos-modal-error">{error}</p>}<button className="pos-primary" disabled={busy}>{busy ? 'Fechando…' : 'Confirmar fechamento'}</button>
      </form>}
      {dialog === 'customize' && customProduct && <section className="pos-modal pos-customize-modal" role="dialog" aria-modal="true" aria-labelledby="pos-customize-title">
        <button type="button" className="pos-modal-close" onClick={() => setDialog('')} aria-label="Fechar"><X size={19}/></button><span className="pos-modal-icon"><ChefHat size={23}/></span><h2 id="pos-customize-title">Personalizar item</h2><p>{customProduct.name}</p>
        {(customProduct.product_fractions || []).length > 0 && <label>Tamanho<select value={customSizeName} onChange={event => { const size = event.target.value; setCustomSizeName(size); setCustomFraction(customProduct.product_fractions.find(fraction => fraction.name === size) || null); }}><option value="">Selecione um tamanho</option>{customProduct.product_fractions.map(fraction => <option key={fraction.id} value={fraction.name}>{fraction.name} · {money(fraction.price)}</option>)}</select></label>}
        {customProduct.categories?.slug === 'pizzas' && <div className="pos-pizza-flavors"><label>Quantidade de sabores<select value={customFlavorCount} onChange={event => { const count = Number(event.target.value); setCustomFlavorCount(count); setCustomFlavorIds(current => Array.from({ length: count }, (_, index) => current[index] || customProduct.id)); }}>{[1,2,3,4].map(count => <option key={count} value={count}>{count} {count === 1 ? 'sabor' : 'sabores'}</option>)}</select></label>{Array.from({ length: customFlavorCount }, (_, index) => <label key={index}>{customFlavorCount === 1 ? 'Sabor' : `Sabor da fração ${index + 1}`}<select value={customFlavorIds[index] || ''} onChange={event => setCustomFlavorIds(current => current.map((id, slot) => slot === index ? event.target.value : id))}><option value="">Selecione um sabor</option>{products.filter(option => option.categories?.slug === 'pizzas' && option.product_fractions?.some(fraction => fraction.name === customSizeName)).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>)}<small>Preço automático: {fractionPricing === 'maior_valor' ? 'maior valor entre os sabores' : 'média ponderada dos sabores'}.</small></div>}
        <div className="pos-addition-options"><b>Adicionais</b>{availableAdditions.map(addition => <label key={addition.id}><span><input type="checkbox" checked={customAdditions.some(item => item.id === addition.id)} onChange={event => setCustomAdditions(current => event.target.checked ? [...current, addition] : current.filter(item => item.id !== addition.id))}/>{addition.name}</span><strong>{Number(addition.price) > 0 ? `+ ${money(addition.price)}` : 'Grátis'}</strong></label>)}</div>
        {error && <p className="pos-modal-error">{error}</p>}<div className="pos-customize-total"><span>Preço do item</span><b>{money(customPrice)}</b></div><button type="button" className="pos-primary" onClick={addCustomizedProduct} disabled={Boolean(customProduct.accepts_fractions && customProduct.product_fractions?.length && !customFraction) || Boolean(customProduct.categories?.slug === 'pizzas' && (customSelectedFlavors.length !== customFlavorCount || customSelectedFlavors.some(flavor => !flavor.fraction)))}><Plus size={17}/> Adicionar ao pedido</button>
      </section>}
      {dialog === 'payment' && <form className="pos-modal pos-payment-modal" onSubmit={submitPayment}>
        <button type="button" className="pos-modal-close" onClick={() => { setDialog(''); setPix(null); }} aria-label="Fechar"><X size={19}/></button><span className="pos-modal-icon"><CircleDollarSign size={23}/></span><h2>Finalizar venda</h2><p>{activeOrder ? `Comanda #${activeOrder.order_number}` : mode === 'salao' ? `Mesa ${selectedTable?.number || ''}` : 'Venda rápida no balcão'}</p><div className="pos-payment-total"><span>Saldo a pagar</span><b>{money(totalDue)}</b></div>
        {pix ? <div className="pos-pix-panel"><div className="pos-pix-code"><QRCodeSVG value={pix.qr_code} size={196} level="M" includeMargin/></div><strong>{pixStatus}</strong><small>Escaneie o QR Code no aplicativo do banco.</small><button type="button" className="pos-pix-copy" onClick={async () => { await navigator.clipboard.writeText(pix.qr_code); setCopyDone(true); setTimeout(() => setCopyDone(false), 2000); }}>{copyDone ? <Check size={16}/> : <QrCode size={16}/>} {copyDone ? 'Código copiado' : 'Copiar código Pix'}</button></div> : <>
          <div className="pos-payment-rows">{paymentRows.map((row,index) => <div className="pos-payment-row" key={index}><label>Forma<select value={row.method} onChange={event => updatePaymentRow(index,'method',event.target.value)}>{paymentOptions.map(option => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label><label>Valor<input type="number" min="0.01" step="0.01" value={row.amount} onChange={event => updatePaymentRow(index,'amount',event.target.value)} required/></label>{row.method === 'cash' && <label>Recebido<input type="number" min={row.amount || '0'} step="0.01" value={row.cash_received} onChange={event => updatePaymentRow(index,'cash_received',event.target.value)} required/></label>}{paymentRows.length > 1 && <button type="button" className="pos-remove-payment" onClick={() => removePaymentRow(index)} aria-label="Remover forma de pagamento"><Trash2 size={16}/></button>}</div>)}</div>
          <div className="pos-payment-actions"><button type="button" className="pos-add-payment" onClick={addPaymentRow}><Plus size={15}/> Adicionar pagamento misto</button><button type="button" className="pos-add-payment pix" onClick={createPix} disabled={busy}><QrCode size={16}/> Gerar Pix dinâmico</button></div>
          <div className="pos-payment-sum"><span>Soma informada</span><b>{money(paymentRows.reduce((sum,row) => sum + Number(row.amount || 0),0))}</b></div>
          {paymentRows.some(row => row.method === 'cash') && <div className="pos-payment-sum pos-payment-change" role="status"><span>Troco</span><b>{money(cashChange)}</b></div>}
          </>}
        {error && <p className="pos-modal-error">{error}</p>}
        {pix ? <button className="pos-secondary" type="button" onClick={() => { setPix(null); setPixStatus(''); }}>Voltar aos pagamentos</button> : <button className="pos-primary" disabled={busy || !register}>{busy ? 'Processando…' : 'Confirmar pagamento'}</button>}
      </form>}
    </div>}
  </section>;
}

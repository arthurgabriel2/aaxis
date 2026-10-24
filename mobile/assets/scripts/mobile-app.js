import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence, collection, doc, setDoc, deleteDoc, onSnapshot, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// ========== CONFIGURAÇÃO DO FIREBASE ==========
const firebaseConfig = {
    apiKey: "AIzaSyC2ZI1GpBEdn5b5wItH4E5ZBQMYpUs-o5s",
    authDomain: "magazinepdv.firebaseapp.com",
    projectId: "magazinepdv",
    storageBucket: "magazinepdv.firebasestorage.app",
    messagingSenderId: "178719555159",
    appId: "1:178719555159:web:b7fbd4cb2a07c2313ded12"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = 'pdv-pro-v1';

try {
    enableIndexedDbPersistence(db).catch(() => {});
} catch(e) {}

// Global State
let userId = null;
let userEmail = null;
let productsDatabase = [];
let salesDatabase = [];
let currentCart = [];
let activeTab = 'home';
let currentStockFilter = 'all';
let currentHistoryPeriod = 'today';
let selectedSaleDetail = null;
let pendingAdminAuthAction = null;
let editingProductId = null;
let tempProductPhotoBase64 = null;

const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// ==========================================================================
// TOAST NOTIFICATIONS (TOP FLOATING PILL)
// ==========================================================================
window.showMobileToast = (msg, type = 'info') => {
    const container = document.getElementById('mobile-toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `mobile-toast ${type}`;
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-triangle';

    toast.innerHTML = `<i data-lucide="${icon}" style="width: 17px; height: 17px;"></i> <span>${msg}</span>`;
    container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-15px) scale(0.95)';
        setTimeout(() => toast.remove(), 250);
    }, 3200);
};

// ==========================================================================
// DATABASE PATH BUILDER (ISOLAMENTO POR CONTA)
// ==========================================================================
window.getDbPathArray = function(colName) {
    if (userEmail === 'jumagazinestore@gmail.com') {
        return ['artifacts', appId, 'public', 'data', colName];
    } else {
        return ['artifacts', appId, 'users', userId, colName];
    }
};

// ==========================================================================
// AUTHENTICATION LISTENER
// ==========================================================================
onAuthStateChanged(auth, (user) => {
    if (user && !user.isAnonymous && (user.emailVerified || user.email === 'jumagazinestore@gmail.com')) {
        userId = user.uid;
        userEmail = user.email;

        // Se mudou de usuário em relação ao que estava em cache, limpa os dados anteriores
        const prevUserId = localStorage.getItem('sys_current_user_id');
        if (prevUserId && prevUserId !== user.uid) {
            localStorage.removeItem('sys_profile_name');
            localStorage.removeItem('sys_profile_photo');
            localStorage.removeItem('sys_admin_pwd');
        }
        localStorage.setItem('sys_current_user_id', user.uid);

        updateMobileUserHeader();
        initMobileRealtimeData();
        checkAndTriggerMobileOnboarding(user.uid);
    } else {
        userId = null;
        userEmail = null;
        window.location.replace("login.html");
    }
});

function updateMobileUserHeader() {
    const savedName = localStorage.getItem('sys_profile_name') || (auth.currentUser && auth.currentUser.displayName) || (userEmail ? userEmail.split('@')[0] : 'Usuário');
    const savedPhoto = localStorage.getItem('sys_profile_photo') || (auth.currentUser && auth.currentUser.photoURL) || null;
    const storeName = localStorage.getItem('sys_store_name') || 'JÚ MAGAZINE';

    const headerStoreEl = document.getElementById('header-store-name');
    if (headerStoreEl) headerStoreEl.innerText = storeName;

    const avatarImgEl = document.getElementById('header-avatar-img');
    const sheetAvatarImg = document.getElementById('account-sheet-avatar');
    const avatarUrl = savedPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(savedName)}&background=random`;

    if (avatarImgEl) avatarImgEl.src = avatarUrl;
    if (sheetAvatarImg) sheetAvatarImg.src = avatarUrl;

    const sheetNameEl = document.getElementById('account-sheet-name');
    const sheetEmailEl = document.getElementById('account-sheet-email');
    if (sheetNameEl) sheetNameEl.innerText = savedName;
    if (sheetEmailEl) sheetEmailEl.innerText = userEmail;

    // Campos de Ajustes
    const storeNameInput = document.getElementById('setting-store-name');
    const storeDocInput = document.getElementById('setting-store-doc');
    const storeAddressInput = document.getElementById('setting-store-address');
    const taxDebitInput = document.getElementById('setting-tax-debit');
    const taxCreditInput = document.getElementById('setting-tax-credit');

    if (storeNameInput) storeNameInput.value = localStorage.getItem('sys_store_name') || '';
    if (storeDocInput) storeDocInput.value = localStorage.getItem('sys_store_doc') || '';
    if (storeAddressInput) storeAddressInput.value = localStorage.getItem('sys_store_address') || '';
    if (taxDebitInput) taxDebitInput.value = localStorage.getItem('sys_tax_debit') || '1.99';
    if (taxCreditInput) taxCreditInput.value = localStorage.getItem('sys_tax_credit') || '3.49';
}

// ==========================================================================
// REAL-TIME FIRESTORE DATA SYNC
// ==========================================================================
function initMobileRealtimeData() {
    if (!userId) return;

    // 1. Perfil na Nuvem
    const userDoc = doc(db, ...window.getDbPathArray('usuarios'), userId);
    onSnapshot(userDoc, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const profileName = data.name || (auth.currentUser && auth.currentUser.displayName) || userEmail.split('@')[0];
            const profilePhoto = data.photo || null;

            localStorage.setItem('sys_profile_name', profileName);
            if (profilePhoto) localStorage.setItem('sys_profile_photo', profilePhoto);
            else localStorage.removeItem('sys_profile_photo');

            if (data.adminPwd) localStorage.setItem('sys_admin_pwd', data.adminPwd);
            else localStorage.setItem('sys_admin_pwd', 'admin');

            if (data.tourCompleted) localStorage.setItem(`sys_tour_completed_${userId}`, 'true');

            updateMobileUserHeader();
        }
    }, (err) => console.warn("Erro sync perfil mobile:", err));

    // 2. Produtos do Estoque
    const prodCol = collection(db, ...window.getDbPathArray('produtos'));
    onSnapshot(prodCol, (snapshot) => {
        productsDatabase = [];
        snapshot.forEach(d => productsDatabase.push(d.data()));
        productsDatabase.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        renderMobileStock();
        window.renderMobileDashboard();
        if (activeTab === 'sales') window.renderMobileTodaySales();
    }, (err) => console.warn("Erro sync produtos mobile:", err));

    // 3. Vendas Realizadas
    const salesCol = collection(db, ...window.getDbPathArray('vendas'));
    onSnapshot(salesCol, (snapshot) => {
        salesDatabase = [];
        snapshot.forEach(d => salesDatabase.push(d.data()));
        salesDatabase.sort((a, b) => new Date(b.date) - new Date(a.date));

        window.renderMobileDashboard();
        window.renderMobileHistory();
        window.renderMobileTodaySales();
    }, (err) => console.warn("Erro sync vendas mobile:", err));
}

// ==========================================================================
// TAB NAVIGATION SYSTEM (BOTTOM DOCK)
// ==========================================================================
window.switchMobileTab = (tab) => {
    activeTab = tab;

    ['home', 'sales', 'consult', 'history'].forEach(t => {
        const viewEl = document.getElementById(`mobile-view-${t}`);
        if (viewEl) viewEl.classList.remove('active');
        const dockEl = document.getElementById(`dock-${t}`);
        if (dockEl) dockEl.classList.remove('active');
    });

    const activeView = document.getElementById(`mobile-view-${tab}`);
    if (activeView) activeView.classList.add('active');

    const activeDock = document.getElementById(`dock-${tab}`);
    if (activeDock) activeDock.classList.add('active');

    // Executa renderizadores específicos ao abrir a tela
    if (tab === 'home') window.renderMobileDashboard();
    if (tab === 'sales') window.renderMobileTodaySales();
    if (tab === 'consult') renderMobileStock();
    if (tab === 'history') window.renderMobileHistory();

    if (typeof lucide !== 'undefined') lucide.createIcons();
};

// ==========================================================================
// DASHBOARD LOGIC
// ==========================================================================
function populateMonthSelector() {
    const select = document.getElementById('dash-month-select');
    if (!select || select.children.length > 0) return;

    const months = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();

    months.forEach((m, idx) => {
        const opt = document.createElement('option');
        opt.value = `${curYear}-${String(idx + 1).padStart(2, '0')}`;
        opt.innerText = `${m} ${curYear}`;
        if (idx === curMonth) opt.selected = true;
        select.appendChild(opt);
    });
}
populateMonthSelector();

window.renderMobileDashboard = () => {
    populateMonthSelector();
    const monthSelect = document.getElementById('dash-month-select');
    const selectedMonth = monthSelect ? monthSelect.value : new Date().toISOString().substring(0, 7);

    // Filtra vendas do mês selecionado
    const monthSales = salesDatabase.filter(s => s.date && s.date.startsWith(selectedMonth));

    let revenue = 0;
    let totalCost = 0;
    let cardTaxesDeducted = 0;
    const productStats = {};

    const debitRate = (parseFloat(localStorage.getItem('sys_tax_debit')) || 1.99) / 100;
    const creditRate = (parseFloat(localStorage.getItem('sys_tax_credit')) || 3.49) / 100;

    monthSales.forEach(sale => {
        const saleTotal = parseFloat(sale.total) || 0;
        revenue += saleTotal;

        // Desconta taxa de cartão se aplicável (suporta desktop e mobile)
        const payStr = (sale.paymentMethod || (sale.items && sale.items[0] && (sale.items[0].paymentDetails || sale.items[0].payment)) || '').toLowerCase();
        if (payStr.includes('débito') || payStr.includes('debito')) {
            cardTaxesDeducted += saleTotal * debitRate;
        } else if (payStr.includes('crédito') || payStr.includes('credito')) {
            cardTaxesDeducted += saleTotal * creditRate;
        }

        // Calcula produtos mais vendidos e custo (suporta schemas desktop e mobile)
        if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                const qty = parseInt(item.qtd !== undefined ? item.qtd : item.quantity) || 1;
                const cost = parseFloat(item.cost !== undefined ? item.cost : item.costPrice) || 0;
                const price = parseFloat(item.sell !== undefined ? item.sell : item.price) || 0;
                totalCost += cost * qty;

                const pName = item.name || 'Produto';
                if (!productStats[pName]) {
                    productStats[pName] = { name: pName, quantity: 0, revenue: 0, photo: item.photo || null };
                }
                productStats[pName].quantity += qty;
                productStats[pName].revenue += price * qty;
            });
        }
    });

    const salesCount = monthSales.length;
    const ticketAvg = salesCount > 0 ? revenue / salesCount : 0;
    const profitEstimated = revenue - totalCost - cardTaxesDeducted;

    // Atualiza KPIs
    const kpiRevEl = document.getElementById('kpi-revenue');
    const kpiCountEl = document.getElementById('kpi-sales-count');
    const kpiTicketEl = document.getElementById('kpi-ticket-avg');
    const kpiProfitEl = document.getElementById('kpi-profit');

    if (kpiRevEl) kpiRevEl.innerText = formatter.format(revenue);
    if (kpiCountEl) kpiCountEl.innerText = salesCount;
    if (kpiTicketEl) kpiTicketEl.innerText = formatter.format(ticketAvg);
    if (kpiProfitEl) kpiProfitEl.innerText = formatter.format(profitEstimated);

    // Top Produtos Mais Vendidos
    const topContainer = document.getElementById('dash-top-products');
    if (topContainer) {
        const sortedProds = Object.values(productStats).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
        if (sortedProds.length === 0) {
            topContainer.innerHTML = `<div style="text-align: center; color: var(--text-tertiary); padding: 1rem 0; font-size: 0.82rem;">Nenhuma venda registrada no mês.</div>`;
        } else {
            topContainer.innerHTML = sortedProds.map((p, idx) => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--glass-card-border);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 0.85rem; font-weight: 700; color: #ffffff; width: 18px;">#${idx + 1}</span>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 0.88rem; font-weight: 600; color: var(--text-primary);">${p.name}</span>
                            <span style="font-size: 0.72rem; color: var(--text-secondary);">${p.quantity} unid. vendidas</span>
                        </div>
                    </div>
                    <span style="font-size: 0.9rem; font-weight: 700; color: #ffffff;">${formatter.format(p.revenue)}</span>
                </div>
            `).join('');
        }
    }

    // Vendas Recentes de Hoje
    const recentContainer = document.getElementById('dash-recent-sales');
    if (recentContainer) {
        const todayStr = new Date().toISOString().substring(0, 10);
        const todaySales = salesDatabase.filter(s => s.date && s.date.startsWith(todayStr)).slice(0, 4);

        if (todaySales.length === 0) {
            recentContainer.innerHTML = `<div style="text-align: center; color: var(--text-tertiary); padding: 1rem 0; font-size: 0.82rem;">Nenhuma venda hoje até o momento.</div>`;
        } else {
            recentContainer.innerHTML = todaySales.map(s => `
                <div class="sale-mobile-item" style="padding: 10px 12px; margin-bottom: 6px;" onclick="window.openSaleDetail('${s.id}')">
                    <div class="sale-item-left">
                        <div class="sale-item-icon" style="width: 32px; height: 32px;"><i data-lucide="shopping-bag" style="width: 16px; height: 16px;"></i></div>
                        <div>
                            <div class="sale-item-title" style="font-size: 0.88rem;">${(s.items && s.items[0]) ? s.items[0].name : 'Venda'} ${s.items && s.items.length > 1 ? `(+${s.items.length - 1})` : ''}</div>
                            <div class="sale-item-meta" style="font-size: 0.72rem;">${new Date(s.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • ${s.paymentMethod || 'Dinheiro'}</div>
                        </div>
                    </div>
                    <div class="sale-item-amount" style="font-size: 0.95rem;">${formatter.format(parseFloat(s.total) || 0)}</div>
                </div>
            `).join('');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
};

// ==========================================================================
// ESTOQUE & CATÁLOGO
// ==========================================================================
window.renderMobileStock = (searchTerm = '') => {
    const container = document.getElementById('stock-list-container');
    if (!container) return;

    let filtered = [...productsDatabase];

    // Filtro por texto
    if (searchTerm.trim()) {
        const t = searchTerm.toLowerCase();
        filtered = filtered.filter(p => (p.name && p.name.toLowerCase().includes(t)) || (p.barcode && p.barcode.includes(t)));
    }

    // Filtro segmentado
    if (currentStockFilter === 'low') {
        filtered = filtered.filter(p => {
            const stock = parseInt(p.stock) || 0;
            const min = parseInt(p.minStock) || 2;
            return stock <= min && stock > 0;
        });
    } else if (currentStockFilter === 'zero') {
        filtered = filtered.filter(p => (parseInt(p.stock) || 0) <= 0);
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-tertiary); padding: 3rem 1rem;">
                <i data-lucide="package" style="width: 36px; height: 36px; margin-bottom: 8px;"></i>
                <p>Nenhum produto encontrado.</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(p => {
        const stock = parseInt(p.stock) || 0;
        const minStock = parseInt(p.minStock) || 2;
        const isLow = stock <= minStock;
        const imgHtml = p.photo 
            ? `<img src="${p.photo}" alt="${p.name}">` 
            : `<i data-lucide="image"></i>`;

        return `
            <div class="product-mobile-item">
                <div class="product-mobile-thumb">${imgHtml}</div>
                <div class="product-mobile-info" onclick="window.openEditProductSheet('${p.id}')">
                    <div class="product-mobile-name">${p.name}</div>
                    <div class="product-mobile-meta">
                        <span class="product-mobile-price">${formatter.format(parseFloat(p.sell !== undefined ? p.sell : p.price) || 0)}</span>
                        <span class="stock-pill ${isLow ? 'low' : 'ok'}">${stock} unid.</span>
                    </div>
                </div>
                <div class="product-mobile-actions">
                    <button type="button" class="btn-glass" style="width: 34px; height: 34px; padding: 0;" onclick="window.quickAdjustStock('${p.id}', -1)">-</button>
                    <span style="font-weight: 700; font-size: 0.9rem; min-width: 20px; text-align: center;">${stock}</span>
                    <button type="button" class="btn-glass" style="width: 34px; height: 34px; padding: 0;" onclick="window.quickAdjustStock('${p.id}', 1)">+</button>
                </div>
            </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.setStockFilter = (filter, btn) => {
    currentStockFilter = filter;
    document.querySelectorAll('#mobile-view-consult .segment-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const searchInput = document.getElementById('stock-search-input');
    window.renderMobileStock(searchInput ? searchInput.value : '');
};

window.quickAdjustStock = async (prodId, delta) => {
    const prod = productsDatabase.find(x => x.id === prodId);
    if (!prod || !userId) return;

    const newStock = Math.max(0, (parseInt(prod.stock) || 0) + delta);
    try {
        await setDoc(doc(db, ...window.getDbPathArray('produtos'), prodId), {
            ...prod,
            stock: newStock
        }, { merge: true });
    } catch(e) {
        console.error(e);
        window.showMobileToast("Falha ao ajustar estoque", "error");
    }
};

window.openNewProductSheet = () => {
    editingProductId = null;
    tempProductPhotoBase64 = null;
    document.getElementById('product-sheet-title').innerHTML = '<i data-lucide="package-plus"></i> Novo Produto';
    document.getElementById('mobile-product-form').reset();
    document.getElementById('mobile-prod-photo-preview').style.display = 'none';
    document.getElementById('mobile-prod-photo-placeholder').style.display = 'flex';
    document.getElementById('product-sheet').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.openEditProductSheet = (prodId) => {
    const prod = productsDatabase.find(x => x.id === prodId);
    if (!prod) return;

    editingProductId = prodId;
    tempProductPhotoBase64 = prod.photo || null;

    document.getElementById('product-sheet-title').innerHTML = '<i data-lucide="edit-3"></i> Editar Produto';
    document.getElementById('prod-name').value = prod.name || '';
    document.getElementById('prod-price').value = prod.sell !== undefined ? prod.sell : (prod.price || '');
    document.getElementById('prod-cost').value = prod.cost !== undefined ? prod.cost : (prod.costPrice || '');
    document.getElementById('prod-stock').value = prod.stock || 0;
    document.getElementById('prod-min-stock').value = prod.minStock || 2;
    document.getElementById('prod-barcode').value = prod.barcode || '';

    const preview = document.getElementById('mobile-prod-photo-preview');
    const placeholder = document.getElementById('mobile-prod-photo-placeholder');
    if (prod.photo) {
        preview.src = prod.photo;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        preview.style.display = 'none';
        placeholder.style.display = 'flex';
    }

    document.getElementById('product-sheet').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeProductSheet = () => {
    document.getElementById('product-sheet').classList.add('hidden');
};
window.closeProductSheetOnOverlay = (e) => {
    if (e.target.id === 'product-sheet') window.closeProductSheet();
};

window.handleProductPhotoPick = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    compressImageMobile(file, (base64) => {
        tempProductPhotoBase64 = base64;
        const preview = document.getElementById('mobile-prod-photo-preview');
        const placeholder = document.getElementById('mobile-prod-photo-placeholder');
        preview.src = base64;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
    });
};

window.saveProduct = async (e) => {
    e.preventDefault();
    if (!userId) return;

    const btn = document.getElementById('btn-save-prod');
    btn.disabled = true;
    btn.innerText = "Salvando...";

    const id = editingProductId || ('prod_' + Date.now());
    const name = document.getElementById('prod-name').value.trim();
    const sell = parseFloat(document.getElementById('prod-price').value) || 0;
    const cost = parseFloat(document.getElementById('prod-cost').value) || 0;
    const profit = sell - cost;
    const percent = cost > 0 ? (((sell - cost) / cost) * 100) : 0;

    const productData = {
        id: id,
        name: name,
        sell: sell,
        price: sell,
        cost: cost,
        costPrice: cost,
        profit: profit,
        percent: percent,
        stock: stock,
        minStock: minStock,
        barcode: barcode,
        createdAt: editingProductId ? (productsDatabase.find(x => x.id === id)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (tempProductPhotoBase64) {
        productData.photo = tempProductPhotoBase64;
    }

    try {
        await setDoc(doc(db, ...window.getDbPathArray('produtos'), id), productData, { merge: true });
        window.showMobileToast("Produto salvo na nuvem!", "success");
        window.closeProductSheet();
    } catch(err) {
        console.error(err);
        window.showMobileToast("Erro ao salvar produto.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = "Salvar na Nuvem";
    }
};

// ==========================================================================
// CAIXA - VENDAS DO DIA MOBILE
// ==========================================================================
function isToday(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    const now = new Date();
    return d.getDate() === now.getDate() &&
           d.getMonth() === now.getMonth() &&
           d.getFullYear() === now.getFullYear();
}

window.renderMobileTodaySales = (filterText = '') => {
    const listContainer = document.getElementById('mob-today-sales-list');
    const dateDisplay = document.getElementById('mob-sales-date-display');
    const totalDisplay = document.getElementById('mob-today-total');
    const countDisplay = document.getElementById('mob-today-count');

    if (dateDisplay) {
        const now = new Date();
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        let str = now.toLocaleDateString('pt-BR', options);
        dateDisplay.innerText = str.charAt(0).toUpperCase() + str.slice(1);
    }

    let todaySales = salesDatabase.filter(s => isToday(s.date)).sort((a, b) => new Date(b.date) - new Date(a.date));
    const dayTotal = todaySales.reduce((acc, s) => acc + (parseFloat(s.total) || 0), 0);

    if (totalDisplay) totalDisplay.innerText = formatter.format(dayTotal);
    if (countDisplay) countDisplay.innerText = `${todaySales.length} pedido${todaySales.length === 1 ? '' : 's'}`;

    if (!listContainer) return;

    if (filterText.trim()) {
        const q = filterText.toLowerCase();
        todaySales = todaySales.filter(s => 
            (s.id && s.id.toLowerCase().includes(q)) ||
            (s.customerName && s.customerName.toLowerCase().includes(q)) ||
            (s.paymentMethod && s.paymentMethod.toLowerCase().includes(q)) ||
            (s.items && s.items.some(i => i.name && i.name.toLowerCase().includes(q)))
        );
    }

    if (todaySales.length === 0) {
        listContainer.innerHTML = `
            <div class="glass-card" style="text-align: center; color: var(--text-tertiary); padding: 2.5rem 1rem;">
                <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto;">
                    <i data-lucide="receipt" style="width: 26px; height: 26px;"></i>
                </div>
                <h4 style="font-size: 1rem; font-weight: 600; color: #ffffff; margin-bottom: 4px;">Nenhuma venda registrada hoje</h4>
                <p style="font-size: 0.82rem; margin-bottom: 16px;">Toque no botão abaixo ou no "+" para registrar uma nova venda.</p>
                <button type="button" class="btn-glass btn-glass-primary" style="display: inline-flex; width: auto; padding: 10px 20px; font-size: 0.88rem; gap: 6px;" onclick="window.openMobileSaleModal()">
                    <i data-lucide="plus"></i> Iniciar Nova Venda
                </button>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    listContainer.innerHTML = todaySales.map(s => {
        const timeStr = new Date(s.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const items = s.items || [];
        const firstItemName = items.length > 0 ? (items[0].name || 'Produto') : 'Venda';
        const otherCount = items.length > 1 ? ` (+${items.length - 1} item${items.length > 2 ? 's' : ''})` : '';

        return `
            <div class="sale-mobile-item" onclick="window.openSaleDetail('${s.id}')">
                <div class="sale-item-left">
                    <div class="sale-item-icon">
                        <i data-lucide="receipt"></i>
                    </div>
                    <div>
                        <div class="sale-item-title">${firstItemName}${otherCount}</div>
                        <div class="sale-item-meta">
                            ${timeStr} • #${s.id.slice(-6)} • ${s.paymentMethod || 'Venda'}
                        </div>
                    </div>
                </div>
                <div class="sale-item-right">
                    <div class="sale-item-amount" style="color: #10b981;">${formatter.format(parseFloat(s.total) || 0)}</div>
                    <span class="sale-item-badge">${s.paymentMethod || 'Venda'}</span>
                </div>
            </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.filterMobileTodaySales = (query) => {
    window.renderMobileTodaySales(query);
};

// ==========================================================================
// MODAL / SHEET: FORMULÁRIO DE VENDAS COMPLETO (PDV MOBILE)
// ==========================================================================
let currentSelectedProdId = null;
let currentItemPhoto = null;
let mobMultiRows = [];

window.openMobileSaleModal = () => {
    const modal = document.getElementById('mobile-sale-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const prodInput = document.getElementById('mob-pdv-product');
    if (prodInput && !prodInput.value) {
        document.getElementById('mob-add-item-form')?.reset();
        document.getElementById('mob-pdv-qtd').value = 1;
        document.getElementById('mob-pdv-disc-pct').value = '';
        document.getElementById('mob-pdv-disc-val').value = '';
        document.getElementById('mob-item-subtotal-display').innerText = 'R$ 0,00';
        document.getElementById('mob-pdv-payment').value = 'Dinheiro';
        window.handleMobileItemPaymentChange();
    }

    renderMobileSaleModalCart();
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeMobileSaleModal = () => {
    const modal = document.getElementById('mobile-sale-modal');
    if (modal) modal.classList.add('hidden');
    const dropdown = document.getElementById('mob-pdv-autocomplete-list');
    if (dropdown) dropdown.classList.add('hidden');
    updateMobileFabBadge();
};

window.closeMobileSaleModalOnOverlay = (e) => {
    if (e.target.id === 'mobile-sale-modal') window.closeMobileSaleModal();
};

window.handleMobileProductAutocomplete = () => {
    const input = document.getElementById('mob-pdv-product');
    const dropdown = document.getElementById('mob-pdv-autocomplete-list');
    if (!input || !dropdown) return;

    const val = input.value.trim().toLowerCase();
    if (!val) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        return;
    }

    const matches = productsDatabase.filter(p => 
        (p.name && p.name.toLowerCase().includes(val)) ||
        (p.barcode && p.barcode.includes(val))
    ).slice(0, 8);

    if (matches.length === 0) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        return;
    }

    dropdown.innerHTML = matches.map(p => {
        const price = parseFloat(p.sell !== undefined ? p.sell : p.price) || 0;
        const stock = parseInt(p.stock) || 0;
        return `
            <div class="mobile-autocomplete-item" onclick="window.selectMobileProductSuggestion('${p.id}')">
                <div class="autocomplete-item-name">${p.name}</div>
                <div class="autocomplete-item-meta">${formatter.format(price)} • ${stock} un.</div>
            </div>
        `;
    }).join('');

    dropdown.classList.remove('hidden');
};

window.selectMobileProductSuggestion = (prodId) => {
    const prod = productsDatabase.find(p => p.id === prodId);
    const dropdown = document.getElementById('mob-pdv-autocomplete-list');
    if (dropdown) {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
    }
    if (!prod) return;

    currentSelectedProdId = prod.id;
    currentItemPhoto = prod.photo || null;

    const nameInput = document.getElementById('mob-pdv-product');
    const priceInput = document.getElementById('mob-pdv-price');

    if (nameInput) nameInput.value = prod.name;
    const price = parseFloat(prod.sell !== undefined ? prod.sell : prod.price) || 0;
    if (priceInput) priceInput.value = price.toFixed(2);

    window.calcMobileItemDiscount('sync');
};

// Esconde autocomplete ao clicar fora
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('mob-pdv-autocomplete-list');
    const input = document.getElementById('mob-pdv-product');
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.classList.add('hidden');
    }
});

window.adjustMobileItemQtd = (delta) => {
    const input = document.getElementById('mob-pdv-qtd');
    if (!input) return;
    const cur = parseInt(input.value) || 1;
    const next = Math.max(1, cur + delta);
    input.value = next;
    window.calcMobileItemDiscount('sync');
};

window.calcMobileItemDiscount = (origin) => {
    const qtd = parseInt(document.getElementById('mob-pdv-qtd')?.value) || 1;
    const price = parseFloat(document.getElementById('mob-pdv-price')?.value) || 0;
    const pctInput = document.getElementById('mob-pdv-disc-pct');
    const valInput = document.getElementById('mob-pdv-disc-val');
    const display = document.getElementById('mob-item-subtotal-display');

    const rawTotal = qtd * price;

    if (origin === 'pct' && pctInput && valInput) {
        const pct = parseFloat(pctInput.value) || 0;
        const discountVal = (rawTotal * pct) / 100;
        valInput.value = discountVal > 0 ? discountVal.toFixed(2) : '';
    } else if (origin === 'val' && pctInput && valInput) {
        const discountVal = parseFloat(valInput.value) || 0;
        const pct = rawTotal > 0 ? (discountVal / rawTotal) * 100 : 0;
        pctInput.value = pct > 0 ? pct.toFixed(1) : '';
    }

    const currentDiscVal = parseFloat(valInput ? valInput.value : 0) || 0;
    const finalItemTotal = Math.max(0, rawTotal - currentDiscVal);

    if (display) display.innerText = formatter.format(finalItemTotal);
    window.calcMobileItemCashChange();
};

window.handleMobileItemPaymentChange = () => {
    const method = document.getElementById('mob-pdv-payment')?.value || 'Dinheiro';
    const creditBox = document.getElementById('mob-pdv-credit-options');
    const cashBox = document.getElementById('mob-pdv-cash-options');
    const fiadoBox = document.getElementById('mob-pdv-fiado-options');
    const multiBox = document.getElementById('mob-pdv-multi-options');

    if (creditBox) creditBox.classList.toggle('hidden', method !== 'Crédito');
    if (cashBox) cashBox.classList.toggle('hidden', method !== 'Dinheiro');
    if (fiadoBox) fiadoBox.classList.toggle('hidden', method !== 'Fiado');
    if (multiBox) multiBox.classList.toggle('hidden', method !== 'Multiplo');

    if (method === 'Multiplo' && mobMultiRows.length === 0) {
        mobMultiRows = [
            { type: 'Dinheiro', val: 0, inst: 1 },
            { type: 'Pix', val: 0, inst: 1 }
        ];
        renderMobileMultiRows();
    }
};

window.calcMobileItemCashChange = () => {
    const method = document.getElementById('mob-pdv-payment')?.value;
    if (method !== 'Dinheiro') return;

    const cashInput = document.getElementById('mob-pdv-cash-given');
    const changeDisplay = document.getElementById('mob-pdv-change-display');
    if (!cashInput || !changeDisplay) return;

    const qtd = parseInt(document.getElementById('mob-pdv-qtd')?.value) || 1;
    const price = parseFloat(document.getElementById('mob-pdv-price')?.value) || 0;
    const discountVal = parseFloat(document.getElementById('mob-pdv-disc-val')?.value || 0) || 0;
    const itemTotal = Math.max(0, (qtd * price) - discountVal);

    const cashGiven = parseFloat(cashInput.value) || 0;
    if (cashGiven >= itemTotal && cashGiven > 0) {
        changeDisplay.innerText = `Troco a devolver: ${formatter.format(cashGiven - itemTotal)}`;
    } else {
        changeDisplay.innerText = '';
    }
};

// Pagamento Múltiplo
window.addMobileMultiRow = () => {
    mobMultiRows.push({ type: 'Cartão de Débito', val: 0, inst: 1 });
    renderMobileMultiRows();
};

window.removeMobileMultiRow = (idx) => {
    mobMultiRows.splice(idx, 1);
    renderMobileMultiRows();
};

function renderMobileMultiRows() {
    const container = document.getElementById('mob-multi-rows-container');
    if (!container) return;

    container.innerHTML = mobMultiRows.map((row, idx) => `
        <div style="display: flex; gap: 6px; align-items: center;">
            <select class="input-mobile" style="flex: 1.2;" onchange="mobMultiRows[${idx}].type = this.value; renderMobileMultiRows();">
                <option value="Dinheiro" ${row.type === 'Dinheiro' ? 'selected' : ''}>Dinheiro</option>
                <option value="Pix" ${row.type === 'Pix' ? 'selected' : ''}>Pix</option>
                <option value="Cartão de Débito" ${row.type === 'Cartão de Débito' ? 'selected' : ''}>Débito</option>
                <option value="Cartão de Crédito" ${row.type === 'Cartão de Crédito' ? 'selected' : ''}>Crédito</option>
            </select>
            <input type="number" step="0.01" class="input-mobile" style="flex: 1;" placeholder="0,00" value="${row.val || ''}" oninput="mobMultiRows[${idx}].val = parseFloat(this.value) || 0; calcMobileMultiSum();">
            <button type="button" class="btn-glass btn-glass-destructive" style="width: 36px; height: 36px; padding: 0;" onclick="window.removeMobileMultiRow(${idx})">
                <i data-lucide="x" style="width: 14px; height: 14px;"></i>
            </button>
        </div>
    `).join('');

    calcMobileMultiSum();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function calcMobileMultiSum() {
    const qtd = parseInt(document.getElementById('mob-pdv-qtd')?.value) || 1;
    const price = parseFloat(document.getElementById('mob-pdv-price')?.value) || 0;
    const discountVal = parseFloat(document.getElementById('mob-pdv-disc-val')?.value || 0) || 0;
    const itemTotal = Math.max(0, (qtd * price) - discountVal);

    let sum = mobMultiRows.reduce((acc, r) => acc + (parseFloat(r.val) || 0), 0);
    const diff = itemTotal - sum;
    const label = document.getElementById('mob-multi-remaining-label');
    if (label) {
        if (Math.abs(diff) < 0.01) {
            label.innerText = "✓ Total distribuído exatamente!";
            label.style.color = "#10b981";
        } else if (diff > 0) {
            label.innerText = `Falta distribuir: ${formatter.format(diff)}`;
            label.style.color = "#ef4444";
        } else {
            label.innerText = `Excedeu em: ${formatter.format(Math.abs(diff))}`;
            label.style.color = "#f59e0b";
        }
    }
}

// Inserir Item no Carrinho
window.handleMobileAddItemSubmit = (e) => {
    e.preventDefault();

    const name = document.getElementById('mob-pdv-product')?.value.trim();
    if (!name) {
        window.showMobileToast("Informe o nome do produto.", "error");
        return;
    }

    const qtd = parseInt(document.getElementById('mob-pdv-qtd')?.value) || 1;
    const price = parseFloat(document.getElementById('mob-pdv-price')?.value) || 0;
    if (price <= 0) {
        window.showMobileToast("O preço unitário deve ser maior que zero.", "error");
        return;
    }

    const discountVal = parseFloat(document.getElementById('mob-pdv-disc-val')?.value || 0) || 0;
    const payment = document.getElementById('mob-pdv-payment')?.value || 'Dinheiro';
    let paymentDetails = payment;

    if (payment === 'Crédito') {
        const inst = document.getElementById('mob-pdv-installments')?.value || '1';
        paymentDetails = `Crédito (${inst}x)`;
    } else if (payment === 'Fiado') {
        const client = document.getElementById('mob-pdv-fiado-name')?.value.trim();
        const due = document.getElementById('mob-pdv-fiado-due')?.value;
        const hasEntry = document.getElementById('mob-pdv-fiado-has-entry')?.checked;
        const entryVal = parseFloat(document.getElementById('mob-pdv-fiado-entry-val')?.value || 0) || 0;
        if (!client) {
            window.showMobileToast("Informe o nome do cliente no Fiado.", "error");
            return;
        }
        paymentDetails = `Fiado (${client}${due ? ` - Venc: ${due}` : ''}${hasEntry && entryVal > 0 ? ` - Entrada: ${formatter.format(entryVal)}` : ''})`;
    } else if (payment === 'Multiplo') {
        let parts = [];
        let sum = 0;
        mobMultiRows.forEach(r => {
            if (r.val > 0) {
                sum += r.val;
                parts.push(`${r.type}: ${formatter.format(r.val)}`);
            }
        });
        const totalItem = Math.max(0, (qtd * price) - discountVal);
        if (Math.abs(totalItem - sum) > 0.05) {
            window.showMobileToast("A soma das formas divididas não bate com o valor do item.", "error");
            return;
        }
        paymentDetails = `Múltiplo (${parts.join(' | ')})`;
    }

    if (discountVal > 0) {
        paymentDetails += ` (Desc: ${formatter.format(discountVal)})`;
    }

    const itemTotal = Math.max(0, (qtd * price) - discountVal);

    // Encontra custo cadastrado se houver
    const prodRef = productsDatabase.find(p => p.id === currentSelectedProdId || (p.name && p.name.toUpperCase() === name.toUpperCase()));
    const costPrice = prodRef ? (parseFloat(prodRef.cost !== undefined ? prodRef.cost : prodRef.costPrice) || 0) : 0;

    const newItem = {
        id: Date.now().toString(),
        prodId: prodRef ? prodRef.id : null,
        name: name,
        qtd: qtd,
        quantity: qtd,
        price: price,
        sell: price,
        cost: costPrice,
        costPrice: costPrice,
        discount: discountVal,
        total: itemTotal,
        payment: payment,
        paymentDetails: paymentDetails,
        photo: currentItemPhoto || (prodRef ? prodRef.photo : null)
    };

    currentCart.push(newItem);

    // Reseta form do item
    document.getElementById('mob-pdv-product').value = '';
    document.getElementById('mob-pdv-price').value = '';
    document.getElementById('mob-pdv-qtd').value = 1;
    document.getElementById('mob-pdv-disc-pct').value = '';
    document.getElementById('mob-pdv-disc-val').value = '';
    document.getElementById('mob-item-subtotal-display').innerText = 'R$ 0,00';
    document.getElementById('mob-pdv-cash-given').value = '';
    document.getElementById('mob-pdv-change-display').innerText = '';
    currentSelectedProdId = null;
    currentItemPhoto = null;

    renderMobileSaleModalCart();
    updateMobileFabBadge();
    window.showMobileToast(`"${name}" inserido no pedido!`, "success");
    document.getElementById('mob-pdv-product').focus();
};

function renderMobileSaleModalCart() {
    const list = document.getElementById('mob-cart-items-list');
    const countEl = document.getElementById('mob-cart-items-count');
    const subtotalEl = document.getElementById('mob-sale-subtotal');
    const discEl = document.getElementById('mob-sale-discount');
    const finalEl = document.getElementById('mob-sale-final-total');

    if (countEl) countEl.innerText = currentCart.length;

    let subtotal = 0;
    let totalDiscount = 0;
    let finalTotal = 0;

    currentCart.forEach(item => {
        subtotal += (item.price * item.quantity);
        totalDiscount += (item.discount || 0);
        finalTotal += item.total;
    });

    if (subtotalEl) subtotalEl.innerText = formatter.format(subtotal);
    if (discEl) discEl.innerText = formatter.format(totalDiscount);
    if (finalEl) finalEl.innerText = formatter.format(finalTotal);

    if (!list) return;

    if (currentCart.length === 0) {
        list.innerHTML = `<p style="text-align: center; color: var(--text-tertiary); padding: 1.25rem 0; font-size: 0.85rem;">Nenhum item adicionado ainda.</p>`;
        return;
    }

    list.innerHTML = currentCart.map((item, idx) => `
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.04); border-radius: var(--radius-md); padding: 10px 12px; border: 1px solid var(--glass-card-border);">
            <div style="flex: 1; min-width: 0; padding-right: 8px;">
                <div style="font-weight: 700; font-size: 0.88rem; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${item.quantity}x ${item.name}
                </div>
                <div style="font-size: 0.74rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                    ${item.paymentDetails} • ${formatter.format(item.price)} un.
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; font-size: 0.95rem; color: #10b981;">${formatter.format(item.total)}</span>
                <button type="button" class="btn-glass btn-glass-destructive" style="width: 32px; height: 32px; padding: 0;" onclick="window.removeMobileSaleModalCartItem(${idx})">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        </div>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.removeMobileSaleModalCartItem = (idx) => {
    currentCart.splice(idx, 1);
    renderMobileSaleModalCart();
    updateMobileFabBadge();
};

window.clearCurrentCart = () => {
    if (currentCart.length === 0) return;
    currentCart = [];
    renderMobileSaleModalCart();
    updateMobileFabBadge();
    window.showMobileToast("Itens do pedido limpos.", "info");
};

function updateMobileFabBadge() {
    const badge = document.getElementById('mob-fab-cart-badge');
    const dockBadge = document.getElementById('dock-cart-badge');
    if (!badge) return;

    if (currentCart.length > 0) {
        badge.innerText = currentCart.length;
        badge.classList.remove('hidden');
        if (dockBadge) dockBadge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
        if (dockBadge) dockBadge.classList.add('hidden');
    }
}

// Finalizar Venda pelo Modal
window.finishMobileSaleFromModal = async () => {
    if (currentCart.length === 0) {
        window.showMobileToast("Adicione pelo menos um item ao pedido para finalizar.", "error");
        return;
    }

    const btn = document.getElementById('btn-mob-finish-sale');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Gravando Venda...";
    }

    const subtotal = currentCart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    const totalDiscount = currentCart.reduce((sum, i) => sum + (i.discount || 0), 0);
    const finalTotal = currentCart.reduce((sum, i) => sum + i.total, 0);

    // Agrupa formas de pagamento dos itens
    let payMethods = new Set();
    currentCart.forEach(i => {
        let p = i.paymentDetails || i.payment || '';
        payMethods.add(p.split(' ')[0].replace(':', '').trim());
    });
    const summaryPayment = Array.from(payMethods).join(' + ') || 'Dinheiro';

    const saleId = 'VND-' + Date.now();
    const saleData = {
        id: saleId,
        date: new Date().toISOString(),
        items: [...currentCart],
        subtotal: subtotal,
        discount: totalDiscount,
        total: finalTotal,
        paymentMethod: summaryPayment,
        operator: localStorage.getItem('sys_profile_name') || userEmail
    };

    try {
        // 1. Grava no Firestore em vendas
        await setDoc(doc(db, ...window.getDbPathArray('vendas'), saleId), saleData);

        // 2. Abate do estoque no Firestore
        for (const item of currentCart) {
            const prod = productsDatabase.find(p => p.id === item.prodId || (p.name && p.name.toUpperCase() === item.name.toUpperCase()));
            if (prod) {
                const currentStock = parseInt(prod.stock) || 0;
                const newStock = Math.max(0, currentStock - item.quantity);
                await setDoc(doc(db, ...window.getDbPathArray('produtos'), prod.id), {
                    ...prod,
                    stock: newStock
                }, { merge: true });
            }
        }

        window.showMobileToast("Venda finalizada com sucesso!", "success");
        window.closeMobileSaleModal();

        // Abre o comprovante térmico digital
        window.displaySaleReceipt(saleData);

        // Limpa o carrinho
        currentCart = [];
        renderMobileSaleModalCart();
        updateMobileFabBadge();

        // Atualiza a tela de Vendas do Dia
        window.renderMobileTodaySales();
        window.renderMobileDashboard();
    } catch(err) {
        console.error(err);
        window.showMobileToast("Erro ao processar venda no banco.", "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Finalizar Venda ➔";
        }
    }
};

// ==========================================================================
// COMPROVANTE & RECIBO
// ==========================================================================
window.displaySaleReceipt = (sale) => {
    selectedSaleDetail = sale;
    const container = document.getElementById('receipt-printable-content');
    if (!container) return;

    const storeName = localStorage.getItem('sys_store_name') || 'JÚ MAGAZINE';
    const storeDoc = localStorage.getItem('sys_store_doc') || '';
    const storeAddr = localStorage.getItem('sys_store_address') || '';
    const dateFormatted = new Date(sale.date).toLocaleString('pt-BR');

    container.innerHTML = `
        <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-size: 1.1rem; font-weight: bold;">${storeName.toUpperCase()}</div>
            ${storeDoc ? `<div>CNPJ/CPF: ${storeDoc}</div>` : ''}
            ${storeAddr ? `<div>${storeAddr}</div>` : ''}
            <div style="margin-top: 4px;">COMPROVANTE NÃO FISCAL</div>
        </div>

        <div style="margin-bottom: 8px;">
            <div>Data: ${dateFormatted}</div>
            <div>Pedido: #${sale.id.slice(-6)}</div>
            ${sale.customerName ? `<div>Cliente: ${sale.customerName}</div>` : ''}
            <div>Pagamento: ${sale.paymentMethod}</div>
        </div>

        <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; margin-bottom: 8px;">
            ${(sale.items || []).map(i => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                    <span>${i.quantity}x ${i.name}</span>
                    <span>${formatter.format((i.price || 0) * i.quantity)}</span>
                </div>
            `).join('')}
        </div>

        <div style="text-align: right; margin-bottom: 8px;">
            <div>Subtotal: ${formatter.format(sale.subtotal || sale.total)}</div>
            ${sale.discount > 0 ? `<div>Desconto: -${formatter.format(sale.discount)}</div>` : ''}
            <div style="font-size: 1.1rem; font-weight: bold; margin-top: 4px;">TOTAL: ${formatter.format(sale.total)}</div>
        </div>

        <div style="text-align: center; font-size: 0.75rem; border-top: 1px dashed #000; padding-top: 8px;">
            Obrigado pela preferência!<br>Volte Sempre!
        </div>
    `;

    document.getElementById('receipt-sheet').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.openSaleDetail = (saleId) => {
    const sale = salesDatabase.find(s => s.id === saleId);
    if (sale) {
        window.displaySaleReceipt(sale);
    }
};

window.closeReceiptSheet = () => {
    document.getElementById('receipt-sheet').classList.add('hidden');
};
window.closeReceiptSheetOnOverlay = (e) => {
    if (e.target.id === 'receipt-sheet') window.closeReceiptSheet();
};

window.shareReceiptViaNative = async () => {
    if (!selectedSaleDetail) return;
    const storeName = localStorage.getItem('sys_store_name') || 'Jú Magazine';
    const textReceipt = `*${storeName.toUpperCase()}*\nRecibo da Venda #${selectedSaleDetail.id.slice(-6)}\nData: ${new Date(selectedSaleDetail.date).toLocaleString('pt-BR')}\nTotal: ${formatter.format(selectedSaleDetail.total)}\nForma de Pagamento: ${selectedSaleDetail.paymentMethod}\nObrigado pela preferência!`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: `Recibo - ${storeName}`,
                text: textReceipt
            });
        } catch(e) {}
    } else {
        const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(textReceipt)}`;
        window.open(whatsappUrl, '_blank');
    }
};

window.printMobileReceipt = () => {
    window.print();
};

// ==========================================================================
// HISTÓRICO DE VENDAS
// ==========================================================================
window.renderMobileHistory = (searchTerm = '') => {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    let list = [...salesDatabase];

    // Filtro por período
    const now = new Date();
    if (currentHistoryPeriod === 'today') {
        const todayStr = now.toISOString().substring(0, 10);
        list = list.filter(s => s.date && s.date.startsWith(todayStr));
    } else if (currentHistoryPeriod === '7days') {
        const past7Days = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        list = list.filter(s => new Date(s.date) >= past7Days);
    } else if (currentHistoryPeriod === 'month') {
        const monthStr = now.toISOString().substring(0, 7);
        list = list.filter(s => s.date && s.date.startsWith(monthStr));
    }

    // Filtro por busca
    if (searchTerm.trim()) {
        const t = searchTerm.toLowerCase();
        list = list.filter(s => 
            (s.id && s.id.toLowerCase().includes(t)) ||
            (s.customerName && s.customerName.toLowerCase().includes(t)) ||
            (s.paymentMethod && s.paymentMethod.toLowerCase().includes(t)) ||
            (s.items && s.items.some(i => i.name && i.name.toLowerCase().includes(t)))
        );
    }

    if (list.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-tertiary); padding: 3rem 1rem;">
                <i data-lucide="calendar-x" style="width: 36px; height: 36px; margin-bottom: 8px;"></i>
                <p>Nenhuma venda encontrada no período.</p>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    container.innerHTML = list.map(s => `
        <div class="sale-mobile-item" onclick="window.openSaleDetail('${s.id}')">
            <div class="sale-item-left">
                <div class="sale-item-icon"><i data-lucide="receipt"></i></div>
                <div>
                    <div class="sale-item-title">${(s.items && s.items[0]) ? s.items[0].name : 'Venda'} ${s.items && s.items.length > 1 ? `(+${s.items.length - 1} itens)` : ''}</div>
                    <div class="sale-item-meta">
                        ${new Date(s.date).toLocaleDateString('pt-BR')} ${new Date(s.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • ${s.paymentMethod}
                    </div>
                </div>
            </div>
            <div class="sale-item-right">
                <div class="sale-item-amount">${formatter.format(parseFloat(s.total) || 0)}</div>
                <span class="sale-item-badge">${s.paymentMethod}</span>
            </div>
        </div>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.setHistoryPeriod = (period, btn) => {
    currentHistoryPeriod = period;
    document.querySelectorAll('#mobile-view-history .segment-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const searchInput = document.getElementById('history-search-input');
    window.renderMobileHistory(searchInput ? searchInput.value : '');
};

window.openSaleDetail = (saleId) => {
    const sale = salesDatabase.find(s => s.id === saleId);
    if (!sale) return;

    selectedSaleDetail = sale;
    const body = document.getElementById('sale-detail-body');
    if (!body) return;

    body.innerHTML = `
        <div class="glass-card" style="padding: 14px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">Identificador:</span>
                <span style="font-size: 0.85rem; font-weight: 600; color: #fff;">#${sale.id.slice(-8)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">Data / Horário:</span>
                <span style="font-size: 0.85rem; color: #fff;">${new Date(sale.date).toLocaleString('pt-BR')}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">Forma de Pagamento:</span>
                <span style="font-size: 0.85rem; font-weight: 600; color: #60a5fa;">${sale.paymentMethod}</span>
            </div>
            ${sale.customerName ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 0.8rem; color: var(--text-secondary);">Cliente Fiado:</span>
                <span style="font-size: 0.85rem; font-weight: 600; color: #f59e0b;">${sale.customerName}</span>
            </div>` : ''}
            <div style="display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 700; color: #fff; padding-top: 6px; border-top: 1px solid var(--glass-card-border);">
                <span>Total Pago:</span>
                <span>${formatter.format(sale.total)}</span>
            </div>
        </div>

        <h4 style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 8px;">Itens Comprados</h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
            ${(sale.items || []).map(i => `
                <div style="display: flex; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: var(--radius-sm);">
                    <span>${i.quantity}x ${i.name}</span>
                    <span style="font-weight: 600;">${formatter.format((i.price || 0) * i.quantity)}</span>
                </div>
            `).join('')}
        </div>
    `;

    document.getElementById('sale-detail-sheet').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeSaleDetailSheet = () => {
    document.getElementById('sale-detail-sheet').classList.add('hidden');
};
window.closeSaleDetailSheetOnOverlay = (e) => {
    if (e.target.id === 'sale-detail-sheet') window.closeSaleDetailSheet();
};

window.reprintCurrentSaleReceipt = () => {
    if (selectedSaleDetail) {
        window.closeSaleDetailSheet();
        window.displaySaleReceipt(selectedSaleDetail);
    }
};

window.promptCancelSale = () => {
    pendingAdminAuthAction = 'cancel_sale';
    document.getElementById('admin-auth-pwd').value = '';
    document.getElementById('admin-auth-modal').classList.remove('hidden');
};

// ==========================================================================
// SEGURANÇA ADMIN (AUTORIZAÇÃO)
// ==========================================================================
window.closeAdminAuthModal = () => {
    document.getElementById('admin-auth-modal').classList.add('hidden');
    pendingAdminAuthAction = null;
};

window.verifyAdminAuth = async () => {
    const inputPwd = document.getElementById('admin-auth-pwd').value;
    const currentAdminPwd = localStorage.getItem('sys_admin_pwd') || 'admin';

    if (inputPwd !== currentAdminPwd) {
        window.showMobileToast("Senha admin incorreta! (Padrão: admin)", "error");
        return;
    }

    window.closeAdminAuthModal();

    if (pendingAdminAuthAction === 'cancel_sale' && selectedSaleDetail) {
        // Estorno da venda: devolve itens ao estoque
        try {
            for (const item of (selectedSaleDetail.items || [])) {
                const prod = productsDatabase.find(p => p.id === item.id || (p.name && p.name.toUpperCase() === (item.name || '').toUpperCase()));
                if (prod) {
                    const returnQty = parseInt(item.qtd !== undefined ? item.qtd : item.quantity) || 1;
                    await setDoc(doc(db, ...window.getDbPathArray('produtos'), prod.id), {
                        ...prod,
                        stock: (parseInt(prod.stock) || 0) + returnQty
                    }, { merge: true });
                }
            }
            await deleteDoc(doc(db, ...window.getDbPathArray('vendas'), selectedSaleDetail.id));
            window.showMobileToast("Venda estornada e itens devolvidos ao estoque!", "success");
            window.closeSaleDetailSheet();
        } catch(e) {
            console.error(e);
            window.showMobileToast("Falha ao estornar venda.", "error");
        }
    }
};

// ==========================================================================
// CONTA, AJUSTES E LOGOUT
// ==========================================================================
window.openAccountSheet = () => {
    updateMobileUserHeader();
    document.getElementById('account-sheet').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeAccountSheet = () => {
    document.getElementById('account-sheet').classList.add('hidden');
};
window.closeAccountSheetOnOverlay = (e) => {
    if (e.target.id === 'account-sheet') window.closeAccountSheet();
};

window.saveMobileStoreSetting = (key, value) => {
    localStorage.setItem(key, value);
    window.showMobileToast("Ajuste salvo com sucesso!", "success");
    updateMobileUserHeader();
};

window.handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !userId) return;

    compressImageMobile(file, async (base64) => {
        localStorage.setItem('sys_profile_photo', base64);
        updateMobileUserHeader();
        try {
            await setDoc(doc(db, ...window.getDbPathArray('usuarios'), userId), {
                photo: base64,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            window.showMobileToast("Foto de perfil atualizada na nuvem!", "success");
        } catch(err) {
            console.error(err);
        }
    });
};

window.openLogoutModal = () => {
    document.getElementById('logout-confirm-modal').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeLogoutModal = () => {
    document.getElementById('logout-confirm-modal').classList.add('hidden');
};

window.logoutMobile = async () => {
    const btn = document.getElementById('btn-confirm-logout');
    if (btn) { btn.disabled = true; btn.innerText = "Saindo..."; }
    window.showMobileToast("Encerrando sessão...", "info");

    localStorage.removeItem('sys_current_user_id');
    localStorage.removeItem('sys_profile_name');
    localStorage.removeItem('sys_profile_photo');
    localStorage.removeItem('sys_admin_pwd');

    try {
        await signOut(auth);
        window.location.replace("login.html");
    } catch(e) {
        window.location.replace("login.html");
    }
};

window.exportMobileCSVBackup = () => {
    if (productsDatabase.length === 0) {
        window.showMobileToast("Estoque vazio para backup.", "error");
        return;
    }

    let csv = "ID,Nome,Preço,Custo,Estoque,Estoque Mínimo,Código de Barras\n";
    productsDatabase.forEach(p => {
        csv += `"${p.id}","${p.name || ''}",${p.price || 0},${p.costPrice || 0},${p.stock || 0},${p.minStock || 0},"${p.barcode || ''}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_estoque_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    window.showMobileToast("Arquivo CSV baixado!", "success");
};

// ==========================================================================
// ONBOARDING TOUR MOBILE
// ==========================================================================
const mobileTourSteps = [
    {
        tab: 'home',
        badge: 'Passo 1 de 5 • Início',
        title: 'Bem-vindo ao Axis Mobile! 🚀',
        desc: 'Acompanhe a saúde financeira da sua loja em tempo real. Veja faturamento bruto, ticket médio e produtos mais vendidos no seu bolso.',
        example: 'Abra a tela Início para conferir quanto entrou no caixa no final do dia!'
    },
    {
        tab: 'consult',
        badge: 'Passo 2 de 5 • Estoque',
        title: 'Catálogo e Estoque Rápido 📦',
        desc: 'Cadastre e edite produtos em segundos, tirando fotos direto da câmera do seu celular com alertas de estoque baixo.',
        example: 'Chegou mercadoria? Toque em "+ Novo", tire a foto da peça e defina o preço de venda!'
    },
    {
        tab: 'sales',
        badge: 'Passo 3 de 5 • Caixa & PDV',
        title: 'Frente de Caixa Ágil 🛒',
        desc: 'Venda com 1 toque no balcão: adicione itens ao carrinho, escolha Pix, Cartão ou Dinheiro e emita comprovantes na hora.',
        example: 'O cliente traz 2 itens: você toca no produto, escolhe Pix e finaliza o pedido em segundos!'
    },
    {
        tab: 'history',
        badge: 'Passo 4 de 5 • Histórico',
        title: 'Histórico & Recibos 📅',
        desc: 'Consulte vendas passadas, envie recibos direto pelo WhatsApp ou estorne pedidos com reposição de estoque.',
        example: 'Precisa enviar o comprovante para um cliente? Abra a venda e toque em Compartilhar!'
    },
    {
        tab: 'home',
        badge: 'Passo 5 de 5 • Ajustes',
        title: 'Personalização & Segurança ⚙️',
        desc: 'Configure o nome da sua loja para sair no recibo, taxas de cartão e senha de administrador para proteção total.',
        example: 'Toque no ícone de Ajustes na barra inferior para colocar o nome da sua loja!'
    }
];

let curMobileTourStep = 0;

function renderMobileTourStep(idx) {
    curMobileTourStep = idx;
    const step = mobileTourSteps[idx];
    if (!step) return;

    if (step.tab) window.switchMobileTab(step.tab);

    document.getElementById('mobile-tour-badge-text').innerText = step.badge;
    document.getElementById('mobile-tour-counter').innerText = `${idx + 1} de ${mobileTourSteps.length}`;
    document.getElementById('mobile-tour-title').innerText = step.title;
    document.getElementById('mobile-tour-desc').innerText = step.desc;
    document.getElementById('mobile-tour-example').innerText = step.example;

    const pct = ((idx + 1) / mobileTourSteps.length) * 100;
    document.getElementById('mobile-tour-progress').style.width = `${pct}%`;

    const prevBtn = document.getElementById('mobile-tour-btn-prev');
    const nextBtn = document.getElementById('mobile-tour-btn-next');

    if (idx === 0) prevBtn.classList.add('hidden');
    else prevBtn.classList.remove('hidden');

    nextBtn.innerText = idx === mobileTourSteps.length - 1 ? 'Concluir 🎉' : 'Próximo ➔';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.startMobileOnboardingTour = () => {
    window.closeAccountSheet();
    document.getElementById('mobile-tour-modal').classList.remove('hidden');
    renderMobileTourStep(0);
};

window.prevMobileTourStep = () => {
    if (curMobileTourStep > 0) renderMobileTourStep(curMobileTourStep - 1);
};

window.nextMobileTourStep = () => {
    if (curMobileTourStep < mobileTourSteps.length - 1) {
        renderMobileTourStep(curMobileTourStep + 1);
    } else {
        window.finishMobileOnboarding(false);
    }
};

window.promptSkipMobileTour = () => {
    document.getElementById('mobile-tour-skip-confirm').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.cancelSkipMobileTour = () => {
    document.getElementById('mobile-tour-skip-confirm').classList.add('hidden');
};

window.finishMobileOnboarding = async (skipped = false) => {
    const targetUserId = userId || localStorage.getItem('sys_current_user_id');
    if (targetUserId) {
        localStorage.setItem(`sys_tour_completed_${targetUserId}`, 'true');
    }

    document.getElementById('mobile-tour-modal').classList.add('hidden');
    document.getElementById('mobile-tour-skip-confirm').classList.add('hidden');
    window.switchMobileTab('home');

    if (targetUserId) {
        try {
            await setDoc(doc(db, ...window.getDbPathArray('usuarios'), targetUserId), {
                tourCompleted: true,
                tourCompletedAt: new Date().toISOString()
            }, { merge: true });
        } catch(e) {}
    }

    if (skipped) window.showMobileToast("Tutorial ignorado. Bom trabalho!", "info");
    else window.showMobileToast("Tutorial concluído! Boas vendas!", "success");
};

function checkAndTriggerMobileOnboarding(uid) {
    if (!uid) return;
    const isDone = localStorage.getItem(`sys_tour_completed_${uid}`);
    if (!isDone) {
        setTimeout(() => {
            if (!localStorage.getItem(`sys_tour_completed_${uid}`)) {
                window.startMobileOnboardingTour();
            }
        }, 1200);
    }
}

// ==========================================================================
// CAMERA BARCODE SCANNER
// ==========================================================================
let scannerStream = null;
let scannerDetector = null;
let scannerInterval = null;
let scannerTargetInputId = null;

window.openScannerModal = (targetInputId = null) => {
    scannerTargetInputId = targetInputId;
    const modal = document.getElementById('scanner-modal');
    if (modal) modal.classList.remove('hidden');
    const manualInput = document.getElementById('scanner-manual-input');
    if (manualInput) manualInput.value = '';
    startCameraScanner();
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.scanBarcodeForInput = (inputId) => {
    window.openScannerModal(inputId);
};

window.closeScannerModal = () => {
    stopCameraScanner();
    const modal = document.getElementById('scanner-modal');
    if (modal) modal.classList.add('hidden');
    scannerTargetInputId = null;
};

async function startCameraScanner() {
    const video = document.getElementById('scanner-video');
    const fallbackMsg = document.getElementById('scanner-fallback-msg');
    if (!video) return;

    if (fallbackMsg) fallbackMsg.classList.add('hidden');

    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            scannerStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            video.srcObject = scannerStream;
            await video.play();

            if ('BarcodeDetector' in window) {
                try {
                    const formats = await BarcodeDetector.getSupportedFormats();
                    scannerDetector = new BarcodeDetector({ formats: formats.length > 0 ? formats : ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code'] });
                    
                    scannerInterval = setInterval(async () => {
                        if (!scannerDetector || video.readyState < 2) return;
                        try {
                            const barcodes = await scannerDetector.detect(video);
                            if (barcodes && barcodes.length > 0) {
                                const detectedCode = barcodes[0].rawValue;
                                if (detectedCode) {
                                    handleDetectedBarcode(detectedCode);
                                }
                            }
                        } catch (detectErr) {}
                    }, 400);
                } catch(e) {
                    console.warn("BarcodeDetector error:", e);
                }
            }
        } else {
            if (fallbackMsg) fallbackMsg.classList.remove('hidden');
        }
    } catch(err) {
        console.warn("Camera access denied or unavailable:", err);
        if (fallbackMsg) fallbackMsg.classList.remove('hidden');
    }
}

function stopCameraScanner() {
    if (scannerInterval) {
        clearInterval(scannerInterval);
        scannerInterval = null;
    }
    if (scannerStream) {
        scannerStream.getTracks().forEach(track => track.stop());
        scannerStream = null;
    }
}

function handleDetectedBarcode(code) {
    if (!code) return;
    const cleanCode = code.trim();
    const targetInput = scannerTargetInputId;
    
    if (navigator.vibrate) navigator.vibrate(80);

    window.closeScannerModal();

    if (targetInput) {
        const input = document.getElementById(targetInput);
        if (input) {
            input.value = cleanCode;
            if (targetInput === 'mob-pdv-product') {
                const prod = productsDatabase.find(p => (p.barcode && p.barcode === cleanCode) || (p.id && p.id === cleanCode));
                if (prod) {
                    window.selectMobileProductSuggestion(prod.id);
                    window.showMobileToast(`"${prod.name}" selecionado!`, "success");
                    return;
                }
            }
        }
        window.showMobileToast(`Código capturado: ${cleanCode}`, "success");
        return;
    }

    const prod = productsDatabase.find(p => (p.barcode && p.barcode === cleanCode) || (p.id && p.id === cleanCode));
    if (prod) {
        window.switchMobileTab('sales');
        window.openMobileSaleModal();
        window.selectMobileProductSuggestion(prod.id);
        window.showMobileToast(`"${prod.name}" selecionado na venda!`, "success");
    } else {
        window.showMobileToast(`Código ${cleanCode} não encontrado.`, "info");
        setTimeout(() => {
            if (confirm(`Deseja cadastrar um novo produto com o código ${cleanCode}?`)) {
                window.switchMobileTab('consult');
                window.openNewProductSheet();
                const barcodeInput = document.getElementById('prod-barcode');
                if (barcodeInput) barcodeInput.value = cleanCode;
            }
        }, 300);
    }
}

window.submitManualBarcode = () => {
    const input = document.getElementById('scanner-manual-input');
    if (!input || !input.value.trim()) {
        window.showMobileToast("Por favor digite um código.", "error");
        return;
    }
    handleDetectedBarcode(input.value.trim());
};

// ==========================================================================
// IMAGE COMPRESSOR (CANVAS CLIENT-SIDE)
// ==========================================================================
function compressImageMobile(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDimension = 600;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxDimension) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                }
            } else {
                if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Inicializa os ícones do Lucide
if (typeof lucide !== 'undefined') lucide.createIcons();

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence, collection, getDocs, setDoc, doc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Verificação inicial do tema
if (localStorage.getItem('theme') === 'light') {
    document.documentElement.classList.remove('dark');
} else {
    document.documentElement.classList.add('dark');
}

// ========== COLOQUE SUAS CREDENCIAIS AQUI ==========
// Cole abaixo o firebaseConfig gerado no seu painel do Firebase:
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyC2ZI1GpBEdn5b5wItH4E5ZBQMYpUs-o5s",
    authDomain: "magazinepdv.firebaseapp.com",
    projectId: "magazinepdv",
    storageBucket: "magazinepdv.firebasestorage.app",
    messagingSenderId: "178719555159",
    appId: "1:178719555159:web:b7fbd4cb2a07c2313ded12"
};
// ===================================================

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn("Múltiplas abas abertas, o cache só funciona em uma aba.");
        } else if (err.code == 'unimplemented') {
            console.warn("O navegador atual não suporta cache offline do Firebase.");
        }
    });
} catch(e) {}

const auth = getAuth(app);

// Mantemos o padrão do sistema ou do Canvas
const appId = typeof __app_id !== 'undefined' ? __app_id : 'pdv-pro-v1';
let userId = null;

// Custom Toast System Global
window.showToast = (msg, type = 'info') => {
    const container = document.getElementById('toast-container') || (() => {
        const c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); return c;
    })();
    const toast = document.createElement('div');
    toast.className = 'toast';
    if(type === 'error') toast.style.borderLeftColor = 'var(--destructive)';
    if(type === 'success') toast.style.borderLeftColor = '#10b981';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// Sistema de Auth (Regra do Firebase Canvas e Local)
const initAuth = async () => {
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    } catch(e) {
        console.error("Auth error", e);
        window.showToast("Erro ao conectar no banco de dados. Ativou o Login Anônimo no painel do Firebase?", "error");
    }
};

let productsDatabase = [];
let pendingAction = null;
let currentEditId = null;
let isCatalogMode = false;

let salesDatabase = [];
let currentCart = [];
window.currentViewSaleId = null;
let editingSaleId = null;

let isSelectMode = false;
let selectedProducts = new Set();

let shoppingListsDatabase = [];
window.currentOpenListId = null;
window.editingShoppingItemId = null;

let salesViewMode = localStorage.getItem('sales_view_mode') || 'grid';
let historyViewMode = localStorage.getItem('history_view_mode') || 'list';
let historySortMode = 'date_desc';

const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const titles = { 'sales': 'Painel de Vendas', 'register': 'Cadastrar Produto', 'consult': 'Consultar Estoque', 'history': 'Consultar Vendas' };

// Define onde vamos salvar (Isolamento por Usuário)
window.getDbPathArray = function(colName) {
    if (window.userEmail === 'jumagazinestore@gmail.com') {
        return ['artifacts', appId, 'public', 'data', colName];
    } else {
        return ['artifacts', appId, 'users', userId, 'data', colName];
    }
}

function loadDataFromFirebase() {
    if(!userId) return;

    // Variáveis de controle para Lazy Loading
    if (typeof window.isProductsLoaded === 'undefined') window.isProductsLoaded = false;
    if (typeof window.isSalesLoaded === 'undefined') window.isSalesLoaded = false;

    window.checkLazyLoad = (tab) => {
        // Carrega produtos apenas quando o usuário entra no estoque ou PDV
        if ((tab === 'consult' || tab === 'sales' || tab === 'register') && !window.isProductsLoaded) {
            window.isProductsLoaded = true;
            const prodCol = collection(db, ...window.getDbPathArray('produtos'));
            onSnapshot(prodCol, (snapshot) => {
                productsDatabase = [];
                snapshot.forEach(d => productsDatabase.push(d.data()));
                const searchEl = document.getElementById('search');
                renderTable(searchEl ? searchEl.value : '');
            }, (error) => console.error("Erro Produtos:", error));
        }
        
        // Carrega vendas apenas quando o usuário entra no dashboard, histórico ou PDV
        if ((tab === 'home' || tab === 'history' || tab === 'sales') && !window.isSalesLoaded) {
            window.isSalesLoaded = true;
            const salesCol = collection(db, ...window.getDbPathArray('vendas'));
            onSnapshot(salesCol, (snapshot) => {
                salesDatabase = [];
                snapshot.forEach(d => salesDatabase.push(d.data()));
                if(document.getElementById('view-sales') && document.getElementById('view-sales').classList.contains('active')) renderTodaySales();
                if(document.getElementById('view-history') && document.getElementById('view-history').classList.contains('active')) window.renderHistory();
                if(document.getElementById('view-home') && document.getElementById('view-home').classList.contains('active')) window.renderDashboard();
            }, (error) => console.error("Erro Vendas:", error));
        }
    };

    // Dispara o Lazy Loading baseado na aba inicial padrão (Home)
    window.checkLazyLoad('home');


    // Escutando Changelogs (Sempre global)
    const changelogsCol = collection(db, 'artifacts', appId, 'public', 'data', 'changelogs');
    onSnapshot(changelogsCol, (snapshot) => {
        let list = [];
        snapshot.forEach(d => list.push(d.data()));
        window.renderChangelogsMain(list);
    }, (error) => console.error("Erro Changelogs:", error));

    // Escutando dados do perfil na nuvem
    const userDoc = doc(db, ...window.getDbPathArray('usuarios'), userId);
    onSnapshot(userDoc, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.name) localStorage.setItem('sys_profile_name', data.name);
            if (data.photo) localStorage.setItem('sys_profile_photo', data.photo);
            if (data.adminPwd) localStorage.setItem('sys_admin_pwd', data.adminPwd);
            updateProfileUI();
        }
    }, (error) => console.error("Erro Perfil:", error));
}

onAuthStateChanged(auth, (user) => {
    if (user && !user.isAnonymous && (user.emailVerified || user.email === 'jumagazinestore@gmail.com')) {
        userId = user.uid;
        window.userEmail = user.email;
        document.getElementById('account-name-display').innerText = localStorage.getItem('sys_profile_name') || user.email.split('@')[0];
        document.getElementById('account-email-display').innerText = user.email;
        document.body.classList.add('auth-ready'); // Mostra a tela suavemente
        loadDataFromFirebase();
    } else {
        userId = null;
        window.userEmail = null;
        window.location.replace("login.html"); // Remove do histórico para não voltar com a setinha
    }
});

// ------------------ FUNÇÕES GLOBAIS DE INTERFACE ------------------
if(typeof lucide !== 'undefined') lucide.createIcons();
if (!localStorage.getItem('sys_admin_pwd')) localStorage.setItem('sys_admin_pwd', 'admin');
const getTax = (type) => parseFloat(localStorage.getItem(`sys_tax_${type}`)) || 0;

if(document.getElementById('tax-debit')) document.getElementById('tax-debit').value = getTax('debit');
if(document.getElementById('tax-credit')) document.getElementById('tax-credit').value = getTax('credit');
if(localStorage.getItem('sys_logo') && document.getElementById('logo-status')) document.getElementById('logo-status').innerText = "Logo salva pronta para uso.";

if(document.getElementById('store-name')) document.getElementById('store-name').value = localStorage.getItem('sys_store_name') || 'JÚ MAGAZINE';
if(document.getElementById('store-doc')) document.getElementById('store-doc').value = localStorage.getItem('sys_store_doc') || '';
if(document.getElementById('store-address')) document.getElementById('store-address').value = localStorage.getItem('sys_store_address') || '';
if(document.getElementById('setting-autocomplete')) document.getElementById('setting-autocomplete').checked = localStorage.getItem('sys_autocomplete') === 'true';
if(document.getElementById('setting-ntfy-topic')) document.getElementById('setting-ntfy-topic').value = localStorage.getItem('sys_ntfy_topic') || '';

window.saveNtfyTopic = (val) => {
    localStorage.setItem('sys_ntfy_topic', val);
    window.showToast("Tópico de notificações atualizado", "success");
};

window.openRegisterModal = () => document.getElementById('register-modal').classList.remove('hidden');
window.closeRegisterModal = () => document.getElementById('register-modal').classList.add('hidden');

window.switchTab = (tab) => {
    if(window.checkLazyLoad) window.checkLazyLoad(tab);

    ['home', 'consult', 'sales', 'history'].forEach(t => {
        const viewEl = document.getElementById(`view-${t}`);
        if (viewEl) viewEl.classList.remove('active');
        const btnEl = document.getElementById(`btn-${t}`);
        if (btnEl) btnEl.classList.remove('active');
    });
    const activeView = document.getElementById(`view-${tab}`);
    if (activeView) activeView.classList.add('active');
    const activeBtn = document.getElementById(`btn-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');
    const pageTitle = document.getElementById('page-title');
    if (pageTitle && titles[tab]) pageTitle.innerText = titles[tab];
    
    if(tab === 'sales') renderTodaySales();
    if(tab === 'history') window.renderHistory();
    if(tab === 'shopping') renderShoppingLists();
    if(tab === 'home') window.renderDashboard();

    if(window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
        const icon = document.getElementById('sidebar-icon');
        if (icon) {
            icon.setAttribute('data-lucide', 'panel-left-open');
            if(typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
};

window.toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    const icon = document.getElementById('sidebar-icon');
    if (icon) {
        icon.setAttribute('data-lucide', isCollapsed ? 'panel-left-open' : 'panel-left-close');
        if(typeof lucide !== 'undefined') lucide.createIcons();
    }
};

window.openSettingsModal = () => {
    document.getElementById('settings-modal').classList.remove('hidden');
    if(window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
        const icon = document.getElementById('sidebar-icon');
        if (icon) {
            icon.setAttribute('data-lucide', 'panel-left-open');
            if(typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
};

window.closeSettingsModal = () => document.getElementById('settings-modal').classList.add('hidden');

window.switchSettingsTab = (tabId) => {
    // Hide all sections
    document.querySelectorAll('.settings-section-view').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('active');
    });
    // Remove active class from all tabs
    document.querySelectorAll('.settings-tab-btn').forEach(el => {
        el.classList.remove('active');
    });
    
    // Show requested section
    const targetSection = document.getElementById('settings-' + tabId);
    if (targetSection) {
        targetSection.classList.remove('hidden');
        targetSection.classList.add('active');
    }
    
    // Add active class to clicked tab
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes("'" + tabId + "'")) {
            btn.classList.add('active');
        }
    });
};

const bindFileInput = (inputId, displayId) => {
    const el = document.getElementById(inputId);
    if (el) {
        el.addEventListener('change', function() {
            const display = document.getElementById(displayId);
            if(display) display.textContent = this.files && this.files.length > 0 ? this.files[0].name : "Nenhum arquivo...";
        });
    }
};

bindFileInput('photo', 'photo-filename');
bindFileInput('logo-upload', 'logo-filename');
bindFileInput('edit-photo', 'edit-photo-filename');
bindFileInput('excel-upload', 'excel-filename');

const compressImage = (file, callback) => {
    if (!file) { callback(''); return; }
    const reader = new FileReader(); reader.readAsDataURL(file);
    reader.onload = event => {
        const img = new Image(); img.src = event.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas'); const MAX_WIDTH = 150;
            const scaleSize = MAX_WIDTH / img.width; canvas.width = MAX_WIDTH; canvas.height = img.height * scaleSize;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        }
    }
};

if(document.getElementById('logo-upload')) {
    document.getElementById('logo-upload').addEventListener('change', function() {
        compressImage(this.files[0], (base64) => {
            localStorage.setItem('sys_logo', base64);
            document.getElementById('logo-status').innerText = "Logo salva com sucesso!";
            window.showToast("Logo salva com sucesso!", "success");
        });
    });
}

// IMPORTAÇÃO DE DADOS DO EXCEL -> FIREBASE
if (document.getElementById('excel-upload')) {
    document.getElementById('excel-upload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file || !userId) return;
        
        window.showToast("Lendo arquivo Excel e gravando na nuvem, aguarde...", "info");
        
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                let year = new Date().getFullYear().toString();
                let month = (new Date().getMonth() + 1).toString().padStart(2, '0');
                
                const resumoSheet = workbook.Sheets["RESUMO GERAL"];
                if (resumoSheet) {
                    const resumoData = XLSX.utils.sheet_to_json(resumoSheet, { header: 1 });
                    for (const row of resumoData) {
                        if (row[0] && typeof row[0] === 'string' && row[0].startsWith('Mês:')) {
                            const parts = row[0].split(' ')[1].split('-');
                            if(parts.length === 2) { year = parts[0]; month = parts[1]; }
                            break;
                        }
                    }
                }
                
                let newSales = [];
                workbook.SheetNames.forEach(sheetName => {
                    if (sheetName.startsWith("Dia ")) {
                        const day = sheetName.split(" ")[1];
                        const sheet = workbook.Sheets[sheetName];
                        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                        
                        let startIdx = -1;
                        for (let i = 0; i < rows.length; i++) {
                            if (rows[i] && rows[i][0] === 'ID' && rows[i][1] === 'Produto') { startIdx = i + 1; break; }
                        }
                        
                        if (startIdx !== -1) {
                            const daySalesMap = {};
                            for (let i = startIdx; i < rows.length; i++) {
                                const row = rows[i];
                                if (!row || !row[0]) continue; 
                                
                                const id = row[0].toString();
                                const produto = row[1];
                                const qtd = typeof row[2] === 'number' ? row[2] : parseInt(row[2]) || 1;
                                const unit = typeof row[3] === 'number' ? row[3] : parseFloat(row[3].toString().replace(',', '.')) || 0;
                                const total = typeof row[4] === 'number' ? row[4] : parseFloat(row[4].toString().replace(',', '.')) || 0;
                                const pagamento = row[5] || "Dinheiro";
                                let hora = row[6];
                                
                                if (typeof hora === 'number') {
                                    let totalSeconds = Math.round(hora * 24 * 60 * 60);
                                    let hours = Math.floor(totalSeconds / 3600);
                                    let minutes = Math.floor((totalSeconds % 3600) / 60);
                                    let seconds = totalSeconds % 60;
                                    hora = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                                } else if (typeof hora !== 'string') { hora = "12:00:00"; }
                                
                                let dateStr = `${year}-${month}-${day}T${hora}`;
                                let dateObj = new Date(dateStr);
                                if (isNaN(dateObj.getTime())) { dateObj = new Date(`${year}-${month}-${day}T12:00:00`); }
                                
                                const saleId = `VND-EX-${year}${month}${day}-${id}`;
                                if (!daySalesMap[saleId]) { daySalesMap[saleId] = { id: saleId, date: dateObj.toISOString(), items: [], total: 0 }; }
                                
                                daySalesMap[saleId].items.push({
                                    id: Date.now().toString() + Math.random().toString(36).substring(7),
                                    name: produto ? produto.toUpperCase() : "PRODUTO DESCONHECIDO",
                                    qtd: qtd, price: unit, total: total, payment: pagamento, paymentDetails: pagamento
                                });
                                daySalesMap[saleId].total += total;
                            }
                            
                            Object.values(daySalesMap).forEach(sale => {
                                if (!salesDatabase.find(s => s.id === sale.id)) { newSales.push(sale); }
                            });
                        }
                    }
                });
                
                // Gravação no Firebase (Path Global)
                if (newSales.length > 0) {
                    for (const sale of newSales) {
                        await setDoc(doc(db, ...window.getDbPathArray('vendas'), sale.id), sale);
                    }
                    document.getElementById('excel-upload').value = '';
                    document.getElementById('excel-filename').textContent = "Nenhum arquivo...";
                    window.showToast(`${newSales.length} vendas gravadas na nuvem com sucesso!`, "success");
                } else {
                    window.showToast("Nenhuma venda nova encontrada para importar.", "info");
                }
            } catch (error) { console.error(error); window.showToast("Erro ao processar o arquivo Excel.", "error"); }
        };
        reader.readAsArrayBuffer(file);
    });
}

function calculateFields(costInput, sellInput, profitInput, percentInput, previewDiv) {
    const cost = parseFloat(costInput.value) || 0; const sell = parseFloat(sellInput.value) || 0;
    if(costInput.value !== '' && sellInput.value !== '') {
        const profit = sell - cost; const percent = cost > 0 ? ((profit / cost) * 100) : 0;
        profitInput.value = formatter.format(profit); percentInput.value = percent.toFixed(2).replace('.', ',') + '%';
        
        if(previewDiv) {
            const taxDebit = parseFloat(localStorage.getItem('sys_tax_debit')) || 0;
            const taxCredit = parseFloat(localStorage.getItem('sys_tax_credit')) || 0;
            const debProfit = sell - (sell * (taxDebit/100)) - cost; 
            const credProfit = sell - (sell * (taxCredit/100)) - cost;
            previewDiv.innerHTML = `Líquido c/ Taxas: Débito <b style="color:${debProfit>0?'#10b981':'#ef4444'}">${formatter.format(debProfit)}</b> | Crédito <b style="color:${credProfit>0?'#10b981':'#ef4444'}">${formatter.format(credProfit)}</b>`;
        }
    } else {
        profitInput.value = ''; percentInput.value = ''; if(previewDiv) previewDiv.innerHTML = 'Preencha os valores.';
    }
}

const iCost = document.getElementById('cost'), iSell = document.getElementById('sell');
if(iCost && iSell) {
    [iCost, iSell].forEach(el => el.addEventListener('input', () => calculateFields(iCost, iSell, document.getElementById('profit'), document.getElementById('percent'), document.getElementById('fee-preview'))));
}

// CADASTRAR PRODUTO NO FIREBASE
if (document.getElementById('product-form')) {
    document.getElementById('product-form').addEventListener('submit', function(e) {
        e.preventDefault();
        if(!userId) return window.showToast("Carregando banco de dados, aguarde...", "error");

        const btn = document.getElementById('btn-save'); btn.disabled = true; btn.innerHTML = 'Gravando na nuvem...';
        compressImage(document.getElementById('photo').files[0], async (photoBase64) => {
            const cost = parseFloat(iCost.value), sell = parseFloat(iSell.value);
            try {
                const newProduct = {
                    id: Date.now().toString(),
                    name: document.getElementById('name').value, photo: photoBase64, tag: document.getElementById('tag').value,
                    cost: cost, sell: sell, profit: sell - cost, percent: cost > 0 ? (((sell - cost) / cost) * 100) : 0,
                    stock: parseInt(document.getElementById('stock').value) || 1,
                    notes: document.getElementById('notes').value, createdAt: new Date().toISOString()
                };
                
                // Gravação no Firebase (Path Global)
                await setDoc(doc(db, ...window.getDbPathArray('produtos'), newProduct.id), newProduct);

                this.reset(); document.getElementById('photo-filename').textContent = "Nenhum arquivo...";
                calculateFields(iCost, iSell, document.getElementById('profit'), document.getElementById('percent'), document.getElementById('fee-preview'));
                btn.innerHTML = '<i data-lucide="check"></i> Gravado!'; btn.style.backgroundColor = '#10b981';
                window.showToast("Produto salvo na nuvem com sucesso!", "success");
                window.closeRegisterModal();
            } catch (err) { window.showToast("Erro ao salvar produto.", "error"); console.error(err); }
            setTimeout(() => { btn.innerHTML = '<i data-lucide="save"></i> Registrar Produto'; btn.style.backgroundColor = ''; btn.disabled = false; if(typeof lucide !== 'undefined') lucide.createIcons(); }, 2000);
        });
    });
}

window.toggleSelectMode = () => {
    isSelectMode = !isSelectMode;
    document.getElementById('products-table').classList.toggle('select-mode-active', isSelectMode);
    const btn = document.getElementById('btn-select-mode');
    
    if(isSelectMode) {
        btn.classList.add('btn-active-dark');
        btn.innerHTML = '<i data-lucide="x-square" style="width: 16px; height: 16px;"></i> Cancelar Seleção';
    } else {
        btn.classList.remove('btn-active-dark');
        btn.innerHTML = '<i data-lucide="check-square" style="width: 16px; height: 16px;"></i> Selecionar';
        selectedProducts.clear();
        document.getElementById('chk-all').checked = false;
        document.querySelectorAll('.row-chk').forEach(c => c.checked = false);
        updateSelectionToolbar();
    }
    if(typeof lucide !== 'undefined') lucide.createIcons();
};

window.toggleSelection = (id, isChecked) => {
    if(isChecked) selectedProducts.add(id);
    else selectedProducts.delete(id);
    updateSelectionToolbar();
};

window.toggleAllSelections = (isChecked) => {
    const checkboxes = document.querySelectorAll('.row-chk');
    if(isChecked) {
        checkboxes.forEach(c => { c.checked = true; selectedProducts.add(c.value); });
    } else {
        checkboxes.forEach(c => { c.checked = false; selectedProducts.delete(c.value); });
    }
    updateSelectionToolbar();
};

function updateSelectionToolbar() {
    const toolbar = document.getElementById('selection-toolbar');
    if(toolbar) {
        if (selectedProducts.size > 0) {
            toolbar.classList.remove('hidden');
            document.getElementById('sel-count').innerText = selectedProducts.size;
        } else {
            toolbar.classList.add('hidden');
        }
    }
}

window.showNotes = (text) => {
    document.getElementById('notes-content').innerText = text;
    document.getElementById('notes-modal').classList.remove('hidden');
};

function getTagHTML(tag) {
    const map = { 'mais-vendido': '<span class="tag-pill tag-mais-vendido">Mais Vendido</span>', 'promocao': '<span class="tag-pill tag-promocao">Promoção</span>', 'lancamento': '<span class="tag-pill tag-lancamento">Lançamento</span>', 'esgotado': '<span class="tag-pill tag-esgotado">Esgotado</span>' };
    return map[tag] || '';
}

function renderTable(filter = '') {
    const tbody = document.getElementById('table-body'); 
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const sortedDB = [...productsDatabase].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Filtros avançados
    const qtdMinStr = document.getElementById('filter-qtd-min') ? document.getElementById('filter-qtd-min').value : '';
    const qtdMaxStr = document.getElementById('filter-qtd-max') ? document.getElementById('filter-qtd-max').value : '';
    const priceMinStr = document.getElementById('filter-price-min') ? document.getElementById('filter-price-min').value : '';
    const priceMaxStr = document.getElementById('filter-price-max') ? document.getElementById('filter-price-max').value : '';
    
    const qtdMin = qtdMinStr !== '' ? parseInt(qtdMinStr) : -Infinity;
    const qtdMax = qtdMaxStr !== '' ? parseInt(qtdMaxStr) : Infinity;
    const priceMin = priceMinStr !== '' ? parseFloat(priceMinStr) : -Infinity;
    const priceMax = priceMaxStr !== '' ? parseFloat(priceMaxStr) : Infinity;

    const filtered = sortedDB.filter(p => {
        const nameMatch = p.name.toLowerCase().includes(filter.toLowerCase());
        const stock = p.stock !== undefined ? p.stock : 1;
        const qtdMatch = stock >= qtdMin && stock <= qtdMax;
        const priceMatch = p.sell >= priceMin && p.sell <= priceMax;
        return nameMatch && qtdMatch && priceMatch;
    });

    if(filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--muted-foreground); padding: 2rem;">Nenhum produto.</td></tr>`;
        return;
    }

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        const photoHTML = p.photo ? `<img src="${p.photo}" class="prod-img">` : '';
        const notesBtn = p.notes ? `<button onclick="window.showNotes('${p.notes.replace(/'/g, "\\'")}')" class="btn-icon-tbl info" title="Ver Anotação"><i data-lucide="file-text" style="width:16px;height:16px;"></i></button>` : '';
        const isChecked = selectedProducts.has(p.id) ? 'checked' : '';
        
        tr.innerHTML = `
            <td class="col-select"><input type="checkbox" class="row-chk" value="${p.id}" ${isChecked} onchange="window.toggleSelection('${p.id}', this.checked)"></td>
            <td>
                <div class="prod-cell">
                    ${photoHTML}
                    <div>
                        <div style="font-weight: 500;">${p.name.toUpperCase()} ${notesBtn}</div>
                        ${getTagHTML(p.tag)}
                        <div style="font-size: 0.8rem; color: var(--muted-foreground); margin-top: 2px;">Estoque: ${p.stock !== undefined ? p.stock : 1} unid.</div>
                    </div>
                </div>
            </td>
            <td class="hide-catalog">${formatter.format(p.cost)}</td>
            <td style="font-weight:600;">${formatter.format(p.sell)}</td>
            <td class="hide-catalog">${formatter.format(p.profit)}</td>
            <td class="hide-catalog ${p.percent > 0 ? 'text-green' : (p.percent < 0 ? 'text-red' : '')}">${p.percent.toFixed(2).replace('.', ',')}%</td>
            <td class="hide-catalog" style="text-align: center;">
                <button onclick="window.openEditModal('${p.id}')" class="btn-icon-tbl"><i data-lucide="pencil" style="width:16px;height:16px;"></i></button>
                <button onclick="window.openDeleteConfirm1('${p.id}')" class="btn-icon-tbl danger"><i data-lucide="trash-2" style="width:16px;height:16px;"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    const allChecked = Array.from(document.querySelectorAll('.row-chk')).every(c => c.checked) && document.querySelectorAll('.row-chk').length > 0;
    if(document.getElementById('chk-all')) document.getElementById('chk-all').checked = allChecked;
    
    if(typeof lucide !== 'undefined') lucide.createIcons();
}
window.renderTable = renderTable;

if(document.getElementById('search')) {
    const searchInput = document.getElementById('search');
    const update = () => renderTable(searchInput.value);
    
    searchInput.addEventListener('input', update);
    ['filter-qtd-min', 'filter-qtd-max', 'filter-price-min', 'filter-price-max'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', update);
    });
}

window.clearFilters = () => {
    if(document.getElementById('filter-qtd-min')) document.getElementById('filter-qtd-min').value = '';
    if(document.getElementById('filter-qtd-max')) document.getElementById('filter-qtd-max').value = '';
    if(document.getElementById('filter-price-min')) document.getElementById('filter-price-min').value = '';
    if(document.getElementById('filter-price-max')) document.getElementById('filter-price-max').value = '';
    if(document.getElementById('search')) document.getElementById('search').value = '';
    renderTable();
};



window.downloadBackupCSV = () => {
    if (productsDatabase.length === 0) return window.showToast('Nenhum produto para fazer backup.', 'error');
    
    let csvContent = "id;name;stock;cost;sell;profit;percent;tag;notes;createdAt\n";
    productsDatabase.forEach(p => { 
        csvContent += `"${p.id}";"${p.name}";${p.stock !== undefined ? p.stock : 1};${p.cost};${p.sell};${p.profit};${p.percent};"${p.tag||''}";"${p.notes||''}";"${p.createdAt||''}"\n`; 
    });
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' }));
    link.download = `backup_estoque_${new Date().toISOString().split('T')[0]}.csv`; link.click();
    if(window.closeBackupModal) window.closeBackupModal();
};

window.openBackupModal = () => document.getElementById('backup-modal').classList.remove('hidden');
window.closeBackupModal = () => document.getElementById('backup-modal').classList.add('hidden');



// Modal Auth & EXCLUSÕES FIREBASE
window.requestAuth = (type, id) => {
    pendingAction = { type, id }; document.getElementById('admin-pwd').value = '';
    document.getElementById('auth-modal').classList.remove('hidden'); document.getElementById('admin-pwd').focus();
};

window.requestAutocompleteAuth = (e) => {
    e.preventDefault();
    window.requestAuth('toggle-autocomplete');
};

window.closeAuthModal = () => document.getElementById('auth-modal').classList.add('hidden');

if(document.getElementById('auth-form')) {
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (document.getElementById('admin-pwd').value === localStorage.getItem('sys_admin_pwd')) {
            window.closeAuthModal();
            if(!userId) return window.showToast("Sem conexão com o banco.", "error");

            try {
                if (pendingAction.type === 'edit') window.openEditModal(pendingAction.id);
                
                if (pendingAction.type === 'delete') {
                    await deleteDoc(doc(db, ...window.getDbPathArray('produtos'), pendingAction.id));
                    window.showToast("Produto excluído da nuvem.", "info");
                }
                if (pendingAction.type === 'delete-final') {
                    await deleteDoc(doc(db, ...window.getDbPathArray('produtos'), pendingAction.id));
                    window.showToast("Produto excluído permanentemente.", "success");
                }
                if (pendingAction.type === 'bulk-delete-final') {
                    let count = 0;
                    for (let pId of selectedProducts) {
                        await deleteDoc(doc(db, ...window.getDbPathArray('produtos'), pId));
                        count++;
                    }
                    window.showToast(`${count} produto(s) excluído(s) da nuvem.`, "success");
                    selectedProducts.clear();
                    if (typeof updateSelectionToolbar === 'function') updateSelectionToolbar();
                }
                if (pendingAction.type === 'delete-sale') {
                    await deleteDoc(doc(db, ...window.getDbPathArray('vendas'), pendingAction.id));
                    window.closeSaleDetails();
                    window.showToast("Venda estornada da nuvem.", "info");
                }
                if (pendingAction.type === 'edit-sale') {
                    window.closeSaleDetails();
                    window.startEditSale(pendingAction.id);
                }
                if (pendingAction.type === 'toggle-autocomplete') {
                    const checkbox = document.getElementById('setting-autocomplete');
                    checkbox.checked = !checkbox.checked;
                    localStorage.setItem('sys_autocomplete', checkbox.checked ? 'true' : 'false');
                    window.showToast("Configuração alterada com sucesso!", "success");
                }
            } catch (error) {
                console.error(error); window.showToast("Erro ao processar no Firebase.", "error");
            }
        } else { window.showToast("Senha incorreta!", "error"); document.getElementById('admin-pwd').value = ''; }
    });
}

window.openEditModal = (id) => {
    const p = productsDatabase.find(x => x.id === id); currentEditId = id;
    document.getElementById('edit-name').value = p.name; document.getElementById('edit-photo').value = ''; 
    document.getElementById('edit-photo-filename').textContent = "Nenhum arquivo..."; 
    document.getElementById('edit-cost').value = p.cost; document.getElementById('edit-sell').value = p.sell;
    document.getElementById('edit-tag').value = p.tag || ''; document.getElementById('edit-notes').value = p.notes || '';
    document.getElementById('edit-stock').value = p.stock !== undefined ? p.stock : 1;
    document.getElementById('edit-modal').classList.remove('hidden');
};

window.closeEditModal = () => document.getElementById('edit-modal').classList.add('hidden');

// ATUALIZAR PRODUTO NO FIREBASE
if(document.getElementById('edit-form')) {
    document.getElementById('edit-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if(!userId) return;
        
        compressImage(document.getElementById('edit-photo').files[0], async (photoBase64) => {
            const cost = parseFloat(document.getElementById('edit-cost').value);
            const sell = parseFloat(document.getElementById('edit-sell').value);
            
            const idx = productsDatabase.findIndex(p => p.id === currentEditId);
            if(idx > -1) {
                const updateData = {
                    ...productsDatabase[idx],
                    name: document.getElementById('edit-name').value, tag: document.getElementById('edit-tag').value,
                    notes: document.getElementById('edit-notes').value,
                    stock: parseInt(document.getElementById('edit-stock').value) || 1,
                    cost: cost, sell: sell, profit: sell - cost, percent: cost > 0 ? (((sell - cost) / cost) * 100) : 0
                };
                if(photoBase64 !== '') updateData.photo = photoBase64;

                try {
                    await setDoc(doc(db, ...window.getDbPathArray('produtos'), currentEditId), updateData);
                    window.showToast("Produto sincronizado!", "success");
                } catch(err) { console.error(err); window.showToast("Erro ao sincronizar.", "error"); }
            }
            window.closeEditModal();
        });
    });
}

if(document.getElementById('fees-form')) {
    document.getElementById('fees-form').addEventListener('submit', (e) => {
        e.preventDefault(); localStorage.setItem('sys_tax_debit', document.getElementById('tax-debit').value);
        localStorage.setItem('sys_tax_credit', document.getElementById('tax-credit').value); window.showToast("Taxas salvas com sucesso!", "success");
    });
}

if(document.getElementById('password-form')) {
    document.getElementById('password-form').addEventListener('submit', function(e) {
        e.preventDefault();
        if (document.getElementById('current-pwd').value !== localStorage.getItem('sys_admin_pwd')) return window.showToast("Senha atual incorreta.", "error");
        localStorage.setItem('sys_admin_pwd', document.getElementById('new-pwd').value);
        window.showToast("Senha atualizada com sucesso!", "success"); this.reset();
    });
}

window.toggleTheme = () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
};

// ==========================================
// LÓGICA DO PDV / VENDAS
// ==========================================

window.openCartModal = () => {
    editingSaleId = null; 
    currentCart = [];
    renderCart();
    document.getElementById('add-to-cart-form').reset();
    window.handlePaymentChange();
    document.getElementById('cart-modal').classList.remove('hidden');
};

window.closeCartModal = () => document.getElementById('cart-modal').classList.add('hidden');

let multiPaymentRows = [];

window.renderMultiPayments = () => {
    const container = document.getElementById('multi-payments-container');
    if (!container) return;
    
    container.innerHTML = '';
    multiPaymentRows.forEach((row, index) => {
        const div = document.createElement('div');
        div.style.marginBottom = '0.75rem';
        div.style.paddingBottom = '0.75rem';
        div.style.borderBottom = index < multiPaymentRows.length - 1 ? '1px solid var(--border)' : 'none';
        
        let instHtml = '';
        if (row.type === 'Crédito') {
            instHtml = `
            <div style="margin-top: 0.5rem;">
                <label style="font-size: 0.75rem;">Parcelas</label>
                <select onchange="window.updateMultiRow(${index}, 'inst', this.value)" style="height: 30px; font-size: 0.8rem;">
                    ${[...Array(12)].map((_, i) => `<option value="${i+1}" ${row.inst == i+1 ? 'selected' : ''}>${i+1}x</option>`).join('')}
                </select>
            </div>`;
        }

        div.innerHTML = `
            <div style="display: flex; gap: 0.5rem; align-items: flex-end;">
                <div style="flex: 1;">
                    <label style="font-size: 0.75rem;">Forma ${index + 1}</label>
                    <select onchange="window.updateMultiRow(${index}, 'type', this.value)" style="height: 32px; font-size: 0.85rem;">
                        <option value="Dinheiro" ${row.type === 'Dinheiro' ? 'selected' : ''}>Dinheiro</option>
                        <option value="Pix" ${row.type === 'Pix' ? 'selected' : ''}>Pix</option>
                        <option value="Débito" ${row.type === 'Débito' ? 'selected' : ''}>Cartão de Débito</option>
                        <option value="Crédito" ${row.type === 'Crédito' ? 'selected' : ''}>Cartão de Crédito</option>
                    </select>
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 0.75rem;">Valor (R$)</label>
                    <input type="number" id="multi-val-${index}" step="0.01" min="0" value="${row.value}" oninput="window.updateMultiRow(${index}, 'value', this.value)" style="height: 32px; font-size: 0.85rem; ${(multiPaymentRows.length === 2 && index === 1) ? 'background: var(--background); opacity: 0.8;' : ''}" ${(multiPaymentRows.length === 2 && index === 1) ? 'readonly placeholder="R$ Restante"' : ''}>
                </div>
                ${index >= 2 ? `
                <button type="button" class="btn-icon-tbl danger" onclick="window.removeMultiRow(${index})" style="height: 32px; width: 32px; flex-shrink: 0; padding: 0;">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px; margin: 0 auto;"></i>
                </button>
                ` : ''}
            </div>
            ${instHtml}
        `;
        container.appendChild(div);
    });
    
    if(typeof lucide !== 'undefined') lucide.createIcons();
    window.calcMultiPayment();
};

window.addMultiPaymentRow = () => {
    multiPaymentRows.push({ type: 'Dinheiro', value: '', inst: '1' });
    window.renderMultiPayments();
};

window.removeMultiRow = (index) => {
    multiPaymentRows.splice(index, 1);
    window.renderMultiPayments();
};

window.updateMultiRow = (index, field, val) => {
    multiPaymentRows[index][field] = val;
    if (field === 'type') window.renderMultiPayments();
    else window.calcMultiPayment();
};

window.calcMultiPayment = () => {
    const qtd = parseInt(document.getElementById('pdv-qtd').value) || 1;
    const price = parseFloat(document.getElementById('pdv-price').value) || 0;
    const discountVal = parseFloat(document.getElementById('pdv-discount-value')?.value) || 0;
    
    let total = (qtd * price) - discountVal;
    if(total < 0) total = 0;
    
    if (multiPaymentRows.length === 2) {
        const val1 = parseFloat(multiPaymentRows[0].value) || 0;
        let val2 = total - val1;
        if (val2 < 0) val2 = 0;
        const val2Str = val2 > 0 ? val2.toFixed(2) : '';
        multiPaymentRows[1].value = val2Str;
        
        const input2 = document.getElementById('multi-val-1');
        if (input2 && input2.value !== val2Str) {
            input2.value = val2Str;
        }
    }
    
    let sum = 0;
    for(let i = 0; i < multiPaymentRows.length; i++) {
        sum += parseFloat(multiPaymentRows[i].value) || 0;
    }
    
    const remaining = total - sum;
    const remainingEl = document.getElementById('multi-total-remaining');
    if (remainingEl) {
        if (Math.abs(remaining) < 0.01) {
            remainingEl.innerText = 'Fechado!';
            remainingEl.style.color = '#10b981';
        } else if (remaining > 0) {
            remainingEl.innerText = `Falta: ${formatter.format(remaining)}`;
            remainingEl.style.color = 'var(--destructive)';
        } else {
            remainingEl.innerText = `Excesso: ${formatter.format(Math.abs(remaining))}`;
            remainingEl.style.color = 'var(--destructive)';
        }
    }
};

window.initMultiPayments = () => {
    multiPaymentRows = [
        { type: 'Dinheiro', value: '', inst: '1' },
        { type: 'Pix', value: '', inst: '1' }
    ];
    window.renderMultiPayments();
};

window.handleDiscountChange = (type) => {
    const qtd = parseInt(document.getElementById('pdv-qtd').value) || 1;
    const price = parseFloat(document.getElementById('pdv-price').value) || 0;
    const baseTotal = qtd * price;
    
    if (type === 'percent') {
        const pct = parseFloat(document.getElementById('pdv-discount-percent').value) || 0;
        const val = baseTotal * (pct / 100);
        document.getElementById('pdv-discount-value').value = val > 0 ? val.toFixed(2) : '';
    } else {
        const val = parseFloat(document.getElementById('pdv-discount-value').value) || 0;
        const pct = baseTotal > 0 ? (val / baseTotal) * 100 : 0;
        document.getElementById('pdv-discount-percent').value = pct > 0 ? pct.toFixed(2) : '';
    }
    window.calcMultiPayment();
};

window.handleProductAutocomplete = () => {
    if (localStorage.getItem('sys_autocomplete') !== 'true') return;
    
    const input = document.getElementById('pdv-product');
    const list = document.getElementById('pdv-autocomplete-list');
    if(!list) return;
    const val = input.value.toLowerCase();
    
    list.innerHTML = '';
    if (!val) {
        const topSellers = productsDatabase.filter(p => p.tag === 'mais-vendido').slice(0, 5);
        if (topSellers.length === 0) { list.classList.add('hidden'); return; }
        
        topSellers.forEach(p => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.innerHTML = `<span style="display:flex;align-items:center;gap:0.5rem;">${p.name.toUpperCase()} <span class="tag-pill tag-mais-vendido" style="margin:0;">Top</span></span> <span>${formatter.format(p.sell)}</span>`;
            div.onclick = () => window.selectAutocompleteItem(p);
            list.appendChild(div);
        });
        list.classList.remove('hidden');
        return;
    }
    
    const filtered = productsDatabase.filter(p => p.name.toLowerCase().includes(val));
    if (filtered.length === 0) {
        list.classList.add('hidden');
        return;
    }
    
    filtered.slice(0, 8).forEach(p => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.innerHTML = `<span>${p.name.toUpperCase()}</span> <span>${formatter.format(p.sell)}</span>`;
        div.onclick = () => window.selectAutocompleteItem(p);
        list.appendChild(div);
    });
    list.classList.remove('hidden');
};

window.selectAutocompleteItem = (p) => {
    document.getElementById('pdv-product').value = p.name;
    document.getElementById('pdv-price').value = p.sell;
    document.getElementById('pdv-autocomplete-list').classList.add('hidden');
    document.getElementById('pdv-discount-percent').value = '';
    document.getElementById('pdv-discount-value').value = '';
    window.calcMultiPayment();
};

document.addEventListener('click', (e) => {
    // Autocomplete pdv
    const list = document.getElementById('pdv-autocomplete-list');
    if (list && !e.target.closest('#pdv-product') && !e.target.closest('#pdv-autocomplete-list')) {
        list.classList.add('hidden');
    }
    
    // Fechar modais ao clicar fora (no overlay)
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.add('hidden');
    }
});

window.handlePaymentChange = () => {
    const payType = document.getElementById('pdv-payment').value;
    const creditOpt = document.getElementById('pdv-credit-options');
    const fiadoOpt = document.getElementById('pdv-fiado-options');
    const multiOpt = document.getElementById('pdv-multi-options');
    
    if(creditOpt) creditOpt.classList.add('hidden');
    if(fiadoOpt) fiadoOpt.classList.add('hidden');
    if(multiOpt) multiOpt.classList.add('hidden');

    if(payType === 'Crédito' && creditOpt) creditOpt.classList.remove('hidden');
    if(payType === 'Fiado' && fiadoOpt) fiadoOpt.classList.remove('hidden');
    if(payType === 'Multiplo' && multiOpt) {
        multiOpt.classList.remove('hidden');
        if (!multiPaymentRows || multiPaymentRows.length === 0) window.initMultiPayments();
        else window.calcMultiPayment();
    }
    
    window.handleEntryChange();
};

window.handleEntryChange = () => {
    const hasEntry = document.getElementById('pdv-has-entry');
    const entryGroup = document.getElementById('pdv-entry-group');
    if(hasEntry && entryGroup) {
        if(hasEntry.checked) entryGroup.classList.remove('hidden');
        else { entryGroup.classList.add('hidden'); document.getElementById('pdv-entry-value').value = 0; }
    }
};

if(document.getElementById('add-to-cart-form')) {
    document.getElementById('add-to-cart-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('pdv-product').value.toUpperCase();
        
        if (localStorage.getItem('sys_autocomplete') === 'true') {
            const prodExists = productsDatabase.find(p => p.name.toUpperCase() === name);
            if (!prodExists) {
                window.showToast("Produto não encontrado no estoque! (Modo restrito ativado)", "error");
                return;
            }
        }
        
        const qtd = parseInt(document.getElementById('pdv-qtd').value);
        const price = parseFloat(document.getElementById('pdv-price').value);
        const discountVal = parseFloat(document.getElementById('pdv-discount-value')?.value) || 0;
        let totalItem = (qtd * price) - discountVal;
        if(totalItem < 0) totalItem = 0;
        const payment = document.getElementById('pdv-payment').value;
        
        let paymentDetails = payment;
        if(payment === 'Crédito') {
            const inst = document.getElementById('pdv-installments').value;
            paymentDetails = `Crédito (${inst}x)`;
        } else if(payment === 'Fiado') {
            const hasEntry = document.getElementById('pdv-has-entry').checked;
            const entryVal = parseFloat(document.getElementById('pdv-entry-value').value) || 0;
            if(hasEntry && entryVal > 0) {
                const restante = totalItem - entryVal;
                paymentDetails = `Fiado (Entrada: ${formatter.format(entryVal)} | Resta: ${formatter.format(restante)})`;
            } else {
                paymentDetails = `Fiado (Sem entrada)`;
            }
        } else if (payment === 'Multiplo') {
            let sum = 0;
            let parts = [];
            multiPaymentRows.forEach(row => {
                const val = parseFloat(row.value) || 0;
                if (val > 0) {
                    sum += val;
                    let tStr = row.type;
                    if (tStr === 'Crédito') tStr = `Crédito (${row.inst}x)`;
                    parts.push(`${tStr}: ${formatter.format(val)}`);
                }
            });
            
            if (Math.abs(totalItem - sum) > 0.01) {
                window.showToast("A soma das formas não bate com o total do item.", "error");
                return;
            }
            if (parts.length < 2) {
                window.showToast("Múltiplo exige pelo menos 2 formas com valor.", "error");
                return;
            }
            
            paymentDetails = `Múltiplo (${parts.join(' | ')})`;
        }
        
        if (discountVal > 0) {
            paymentDetails += ` (Desc: ${formatter.format(discountVal)})`;
        }

        const item = { id: Date.now().toString(), name, qtd, price, discount: discountVal, total: totalItem, payment, paymentDetails };
        currentCart.push(item);
        
        document.getElementById('add-to-cart-form').reset();
        document.getElementById('pdv-qtd').value = 1;
        document.getElementById('pdv-discount-percent').value = '';
        document.getElementById('pdv-discount-value').value = '';
        window.handlePaymentChange();
        document.getElementById('pdv-product').focus();
        
        renderCart();
        window.showToast("Item adicionado ao carrinho", "success");
    });
}

window.removeCartItem = (id) => {
    currentCart = currentCart.filter(item => item.id !== id);
    renderCart();
};

window.removeCartGroup = (groupId) => {
    currentCart = currentCart.filter(item => item.groupId !== groupId);
    renderCart();
};

window.renderCart = function renderCart() {
    const list = document.getElementById('cart-items-list');
    const totalDisplay = document.getElementById('cart-total-display');
    const btnFinish = document.getElementById('btn-finish-sale');
    const groupToggle = document.getElementById('toggle-group-inst');
    const groupToolbar = document.getElementById('group-inst-toolbar');
    if(!list) return;
    
    if (groupToggle && groupToolbar) {
        if (groupToggle.checked) groupToolbar.classList.remove('hidden');
        else groupToolbar.classList.add('hidden');
    }

    list.innerHTML = '';
    let total = 0;

    if(currentCart.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--muted-foreground); padding: 3rem 0; font-size: 0.9rem;">Carrinho vazio.</div>';
        totalDisplay.innerText = 'Total: R$ 0,00';
        btnFinish.disabled = true;
        return;
    }

    const renderedGroups = new Set();

    currentCart.forEach(item => {
        total += item.total;
        
        if (item.groupId) {
            if (renderedGroups.has(item.groupId)) return;
            renderedGroups.add(item.groupId);
            
            const groupItems = currentCart.filter(i => i.groupId === item.groupId);
            const groupTotal = groupItems.reduce((sum, i) => sum + i.total, 0);
            const namesList = groupItems.map(i => `${i.qtd}x ${i.name}`).join(' + ');
            
            const div = document.createElement('div');
            div.className = 'cart-item';
            div.style.backgroundColor = 'var(--muted)';
            div.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <div class="cart-item-info">
                        <span class="cart-item-title" style="color: var(--foreground); font-weight: 700;">Agrupado: ${namesList}</span>
                        <span class="cart-item-details">${item.paymentDetails}</span>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-weight: 600;">${formatter.format(groupTotal)}</span>
                    <button onclick="window.removeCartGroup('${item.groupId}')" class="btn-icon-tbl danger" title="Remover Grupo"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
                </div>
            `;
            list.appendChild(div);
        } else {
            let checkHtml = '';
            if (groupToggle && groupToggle.checked) {
                checkHtml = `<input type="checkbox" class="cart-item-chk" value="${item.id}" style="margin-right: 0.75rem; accent-color: var(--foreground); cursor: pointer; width: 16px; height: 16px;">`;
            }
            
            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `
                <div style="display: flex; align-items: center;">
                    ${checkHtml}
                    <div class="cart-item-info">
                        <span class="cart-item-title">${item.qtd}x ${item.name}</span>
                        <span class="cart-item-details">${item.paymentDetails} | ${formatter.format(item.price)} un.</span>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-weight: 600;">${formatter.format(item.total)}</span>
                    <button onclick="window.removeCartItem('${item.id}')" class="btn-icon-tbl danger" title="Remover"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
                </div>
            `;
            list.appendChild(div);
        }
    });

    totalDisplay.innerText = `Total: ${formatter.format(total)}`;
    btnFinish.disabled = false;
    if(typeof lucide !== 'undefined') lucide.createIcons();
}

window.applyGroupInstallments = () => {
    const checkboxes = document.querySelectorAll('.cart-item-chk:checked');
    if (checkboxes.length === 0) {
        window.showToast("Selecione pelo menos um item.", "info");
        return;
    }
    const inst = document.getElementById('group-inst-select').value;
    const newPaymentDetails = `Crédito (${inst}x)`;
    const groupId = 'GRP-' + Date.now();
    
    checkboxes.forEach(chk => {
        const item = currentCart.find(i => i.id === chk.value);
        if (item) {
            item.payment = 'Crédito';
            item.paymentDetails = newPaymentDetails;
            item.groupId = groupId;
            if (item.discount > 0) {
                item.paymentDetails += ` (Desc: ${formatter.format(item.discount)})`;
            }
        }
    });
    
    document.getElementById('toggle-group-inst').checked = false;
    renderCart();
    window.showToast(`Parcelamento em ${inst}x aplicado aos itens selecionados!`, "success");
};

// SALVAR VENDA NO FIREBASE
window.finishSale = async () => {
    if(currentCart.length === 0 || !userId) return;
    
    const btn = document.getElementById('btn-finish-sale');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Processando...';
    if(typeof lucide !== 'undefined') lucide.createIcons();
    
    const totalSale = currentCart.reduce((sum, item) => sum + item.total, 0);
    
    try {
        if (editingSaleId) {
            const index = salesDatabase.findIndex(s => s.id === editingSaleId);
            if(index > -1) {
                const updatedSale = { ...salesDatabase[index], items: [...currentCart], total: totalSale };
                await setDoc(doc(db, ...window.getDbPathArray('vendas'), editingSaleId), updatedSale);
            }
            editingSaleId = null;
            window.showToast("Venda corrigida e salva na nuvem!", "success");
        } else {
            const newSale = { id: 'VND-' + Date.now(), date: new Date().toISOString(), items: [...currentCart], total: totalSale };
            await setDoc(doc(db, ...window.getDbPathArray('vendas'), newSale.id), newSale);
            
            for (const item of currentCart) {
                const prod = productsDatabase.find(p => p.name.toUpperCase() === item.name.toUpperCase());
                if (prod) {
                    const newStock = Math.max(0, (prod.stock !== undefined ? prod.stock : 1) - item.qtd);
                    await setDoc(doc(db, ...window.getDbPathArray('produtos'), prod.id), { ...prod, stock: newStock });
                }
            }

            window.showToast("Venda transmitida à nuvem com sucesso!", "success");
            
            // Envio de notificação Push via Ntfy
            const ntfyTopic = localStorage.getItem('sys_ntfy_topic');
            if (ntfyTopic && ntfyTopic.trim() !== '') {
                const title = `🛍️ Nova Venda — ${formatter.format(totalSale)}`;
                const storeName = localStorage.getItem('sys_store_name') || 'Ju Magazine';
                
                let payMethods = new Set();
                currentCart.forEach(i => {
                    let p = i.paymentDetails || i.payment || '';
                    if (p.startsWith('Múltiplo')) {
                        const m = p.match(/\((.*?)\)/);
                        if (m && m[1]) {
                            m[1].split('|').forEach(x => {
                                payMethods.add(x.split(':')[0].trim());
                            });
                        }
                    } else {
                        payMethods.add(p.split(' ')[0].replace(':', '').trim());
                    }
                });
                const paymentsStr = Array.from(payMethods).join(' / ');
                const message = `${storeName} • ${paymentsStr}`;
                
                fetch('https://ntfy.sh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        topic: ntfyTopic.trim(),
                        message: message,
                        title: title,
                        tags: ["moneybag", "shopping_cart"]
                    })
                }).catch(e => console.error("Ntfy Error: ", e));
            }
        }

        window.closeCartModal();
        if(!document.getElementById('view-sales').classList.contains('active')) {
            window.switchTab('sales');
        }
    } catch (err) {
        console.error(err);
        window.showToast("Erro de conexão ao finalizar venda.", "error");
    }
    
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="check-circle"></i> Fechar Transação Comercial';
    if(typeof lucide !== 'undefined') lucide.createIcons();
};

function isToday(dateString) {
    if(!dateString) return false;
    const date = new Date(dateString);
    if(isNaN(date.getTime())) return false;
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
}

window.setSalesViewMode = (mode) => {
    salesViewMode = mode;
    localStorage.setItem('sales_view_mode', mode);
    
    const btnGrid = document.getElementById('btn-sales-view-grid');
    const btnList = document.getElementById('btn-sales-view-list');
    if (btnGrid && btnList) {
        if (mode === 'grid') {
            btnGrid.classList.add('active');
            btnList.classList.remove('active');
        } else {
            btnList.classList.add('active');
            btnGrid.classList.remove('active');
        }
    }
    renderTodaySales();
};

window.setHistoryViewMode = (mode) => {
    historyViewMode = mode;
    localStorage.setItem('history_view_mode', mode);
    
    const btnGrid = document.getElementById('btn-hist-view-grid');
    const btnList = document.getElementById('btn-hist-view-list');
    if (btnGrid && btnList) {
        if (mode === 'grid') {
            btnGrid.classList.add('active');
            btnList.classList.remove('active');
        } else {
            btnList.classList.add('active');
            btnGrid.classList.remove('active');
        }
    }
    window.renderHistory();
};

window.setHistSort = (mode) => {
    historySortMode = mode;
    const menu = document.getElementById('hist-sort-menu');
    if(menu) menu.classList.add('hidden');
    window.renderHistory();
};

function renderTodaySales() {
    const list = document.getElementById('today-sales-list');
    const displayDate = document.getElementById('sales-date-display');
    const displayTotal = document.getElementById('today-total');
    if(!list || !displayDate) return;
    
    const todayObj = new Date();
    displayDate.innerText = todayObj.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    list.innerHTML = '';
    
    const btnGrid = document.getElementById('btn-sales-view-grid');
    const btnList = document.getElementById('btn-sales-view-list');
    if (btnGrid && btnList) {
        if (salesViewMode === 'grid') {
            btnGrid.classList.add('active');
            btnList.classList.remove('active');
        } else {
            btnList.classList.add('active');
            btnGrid.classList.remove('active');
        }
    }

    const todaySales = salesDatabase.filter(s => isToday(s.date)).sort((a,b) => new Date(b.date) - new Date(a.date));
    let totalDia = 0;

    if(todaySales.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i data-lucide="receipt" style="width: 48px; height: 48px; opacity: 0.5;"></i>
                <p>Nenhuma venda registrada hoje.</p>
            </div>
        `;
        displayTotal.innerText = 'R$ 0,00';
        if(typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    if (salesViewMode === 'grid') {
        const gridDiv = document.createElement('div');
        gridDiv.className = 'sales-grid-container';

        todaySales.forEach(sale => {
            totalDia += sale.total;
            const saleTime = new Date(sale.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            const card = document.createElement('div');
            card.className = 'sale-grid-card';
            card.innerHTML = `
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <span class="sale-badge">#${sale.id.slice(-5)}</span>
                        <span style="font-size: 0.75rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 0.25rem;">
                            <i data-lucide="clock" style="width: 13px; height: 13px;"></i> ${saleTime}
                        </span>
                    </div>
                    <div style="font-size: 1.35rem; font-weight: 700; color: #10b981; margin-bottom: 0.25rem;">
                        ${formatter.format(sale.total)}
                    </div>
                    <div style="font-size: 0.8rem; color: var(--muted-foreground); margin-bottom: 1rem;">
                        ${sale.items.length} item(ns)
                    </div>
                </div>

                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <button onclick="window.openSaleDetails('${sale.id}')" class="btn" style="flex: 1; height: 36px; font-size: 0.82rem; gap: 0.35rem; padding: 0 0.5rem;" title="Ver Detalhes">
                        <i data-lucide="eye" style="width: 16px; height: 16px;"></i> Ver mais
                    </button>
                    <button onclick="window.printReceipt('${sale.id}')" class="btn-secondary" style="height: 36px; padding: 0 0.6rem;" title="Imprimir Recibo">
                        <i data-lucide="printer" style="width: 15px; height: 15px;"></i>
                    </button>
                    <button onclick="window.requestAuth('delete-sale', '${sale.id}')" class="btn-icon-tbl danger" style="height: 36px; width: 36px; display: flex; align-items: center; justify-content: center;" title="Excluir">
                        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
            `;
            gridDiv.appendChild(card);
        });

        list.appendChild(gridDiv);
    } else {
        const listDiv = document.createElement('div');
        listDiv.style.display = 'flex';
        listDiv.style.flexDirection = 'column';

        todaySales.forEach(sale => {
            totalDia += sale.total;
            const saleTime = new Date(sale.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            const div = document.createElement('div');
            div.className = 'sale-card';
            div.innerHTML = `
                <div class="sale-card-info" style="flex-direction: row; align-items: center; gap: 1rem;">
                    <div style="width: 40px; height: 40px; border-radius: 10px; background: var(--muted); display: flex; align-items: center; justify-content: center; color: var(--primary); border: 1px solid var(--border);">
                        <i data-lucide="shopping-bag" style="width: 20px; height: 20px;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; font-size: 1rem;">Venda #${sale.id.slice(-5)}</div>
                        <div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.15rem;">
                            ${saleTime} • ${sale.items.length} item(ns)
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                    <div class="sale-card-total">
                        ${formatter.format(sale.total)}
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <button onclick="window.openSaleDetails('${sale.id}')" class="btn" style="height: 36px; width: auto; padding: 0 0.85rem; font-size: 0.82rem; gap: 0.35rem;" title="Ver Detalhes">
                            <i data-lucide="eye" style="width: 16px; height: 16px;"></i> Ver mais
                        </button>
                        <button onclick="window.printReceipt('${sale.id}')" class="btn-secondary" style="height: 36px; padding: 0 0.6rem;" title="Imprimir Recibo">
                            <i data-lucide="printer" style="width: 15px; height: 15px;"></i>
                        </button>
                        <button onclick="window.requestAuth('delete-sale', '${sale.id}')" class="btn-icon-tbl danger" style="height: 36px; width: 36px; display: flex; align-items: center; justify-content: center;" title="Excluir">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                </div>
            `;
            listDiv.appendChild(div);
        });

        list.appendChild(listDiv);
    }

    displayTotal.innerText = formatter.format(totalDia);
    if(typeof lucide !== 'undefined') lucide.createIcons();
}

window.openSaleDetails = (id) => {
    window.currentViewSaleId = id;
    const sale = salesDatabase.find(s => s.id === id);
    if(!sale) return;

    document.getElementById('details-sale-title').innerText = `Venda #${sale.id.slice(-5)}`;
    document.getElementById('details-sale-time').innerText = new Date(sale.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date(sale.date).toLocaleDateString('pt-BR');

    const list = document.getElementById('details-items-list');
    list.innerHTML = '';
    
    sale.items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'cart-item';
        div.style.background = 'var(--card)';
        div.innerHTML = `
            <div class="cart-item-info">
                <span class="cart-item-title">${item.qtd}x ${item.name}</span>
                <span class="cart-item-details">${item.paymentDetails} | ${formatter.format(item.price)} un.</span>
            </div>
            <div style="font-weight: 600;">${formatter.format(item.total)}</div>
        `;
        list.appendChild(div);
    });

    document.getElementById('details-sale-total').innerText = formatter.format(sale.total);
    document.getElementById('sale-details-modal').classList.remove('hidden');
    if(typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeSaleDetails = () => document.getElementById('sale-details-modal').classList.add('hidden');

window.startEditSale = (id) => {
    const sale = salesDatabase.find(s => s.id === id);
    if(!sale) return;
    editingSaleId = id;
    currentCart = [...sale.items];
    renderCart();
    document.getElementById('add-to-cart-form').reset();
    window.handlePaymentChange();
    document.getElementById('cart-modal').classList.remove('hidden');
};

/* ==========================================
   LÓGICA DO HISTÓRICO DE VENDAS
========================================== */
window.handleHistPeriodChange = () => {
    const val = document.getElementById('hist-period').value;
    document.getElementById('hist-date-container').classList.add('hidden');
    document.getElementById('hist-month-container').classList.add('hidden');
    
    if(val === 'day') document.getElementById('hist-date-container').classList.remove('hidden');
    if(val === 'month') {
        document.getElementById('hist-month-container').classList.remove('hidden');
        if (typeof window.populateMonthSelector === 'function') {
            window.populateMonthSelector('hist-month');
        }
    }
};

window.renderHistory = () => {
    const period = document.getElementById('hist-period').value;
    let filteredSales = [];

    if (period === 'today') {
        filteredSales = salesDatabase.filter(s => isToday(s.date));
    } else if (period === 'day') {
        const dateVal = document.getElementById('hist-date').value;
        if (!dateVal) return window.showToast("Por favor, selecione uma data no calendário.", "error");
        
        const [yyyy, mm, dd] = dateVal.split('-');
        filteredSales = salesDatabase.filter(s => {
            const d = new Date(s.date);
            return d.getFullYear() == yyyy && (d.getMonth() + 1) == mm && d.getDate() == dd;
        });
    } else if (period === 'month') {
        const monthVal = document.getElementById('hist-month').value;
        if (!monthVal) return window.showToast("Por favor, selecione o mês desejado.", "error");
        
        const [yyyy, mm] = monthVal.split('-');
        filteredSales = salesDatabase.filter(s => {
            const d = new Date(s.date);
            return d.getFullYear() == yyyy && (d.getMonth() + 1) == mm;
        });
    }

    const payFilter = document.getElementById('hist-payment-filter')?.value || 'all';
    const idSearch = document.getElementById('hist-id-filter')?.value?.trim().toLowerCase() || '';

    if (payFilter !== 'all') {
        filteredSales = filteredSales.filter(s => {
            return s.items.some(i => {
                let p = i.paymentDetails || i.payment || '';
                return p.includes(payFilter);
            });
        });
    }

    if (idSearch !== '') {
        filteredSales = filteredSales.filter(s => {
            return s.id.toLowerCase().includes(idSearch) || s.id.slice(-5).includes(idSearch);
        });
    }

    if (historySortMode === 'date_desc') {
        filteredSales.sort((a,b) => new Date(b.date) - new Date(a.date));
    } else if (historySortMode === 'date_asc') {
        filteredSales.sort((a,b) => new Date(a.date) - new Date(b.date));
    } else if (historySortMode === 'val_desc') {
        filteredSales.sort((a,b) => b.total - a.total);
    } else if (historySortMode === 'val_asc') {
        filteredSales.sort((a,b) => a.total - b.total);
    }

    const gross = filteredSales.reduce((sum, s) => sum + s.total, 0);
    const count = filteredSales.length;
    const ticket = count > 0 ? gross / count : 0;

    document.getElementById('hist-gross').innerText = formatter.format(gross);
    document.getElementById('hist-count').innerText = count;
    document.getElementById('hist-ticket').innerText = formatter.format(ticket);

    const list = document.getElementById('history-sales-list');
    list.innerHTML = '';
    
    const btnGrid = document.getElementById('btn-hist-view-grid');
    const btnList = document.getElementById('btn-hist-view-list');
    if (btnGrid && btnList) {
        if (historyViewMode === 'grid') {
            btnGrid.classList.add('active');
            btnList.classList.remove('active');
        } else {
            btnList.classList.add('active');
            btnGrid.classList.remove('active');
        }
    }

    if(filteredSales.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i data-lucide="receipt" style="width: 48px; height: 48px; opacity: 0.5;"></i>
                <p>Nenhuma venda encontrada para o período selecionado.</p>
            </div>
        `;
        if(typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    if (historyViewMode === 'grid') {
        const gridDiv = document.createElement('div');
        gridDiv.className = 'sales-grid-container';

        filteredSales.forEach(sale => {
            const saleDate = new Date(sale.date);
            const dateStr = saleDate.toLocaleDateString('pt-BR');
            const timeStr = saleDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            const card = document.createElement('div');
            card.className = 'sale-grid-card';
            card.innerHTML = `
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <span class="sale-badge">#${sale.id.slice(-5)}</span>
                        <span style="font-size: 0.75rem; color: var(--muted-foreground); display: flex; align-items: center; gap: 0.25rem;">
                            <i data-lucide="calendar" style="width: 13px; height: 13px;"></i> ${dateStr} ${timeStr}
                        </span>
                    </div>
                    <div style="font-size: 1.35rem; font-weight: 700; color: #10b981; margin-bottom: 0.25rem;">
                        ${formatter.format(sale.total)}
                    </div>
                    <div style="font-size: 0.8rem; color: var(--muted-foreground); margin-bottom: 1rem;">
                        ${sale.items.length} item(ns)
                    </div>
                </div>

                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <button onclick="window.openSaleDetails('${sale.id}')" class="btn" style="flex: 1; height: 36px; font-size: 0.82rem; gap: 0.35rem; padding: 0 0.5rem;" title="Ver Detalhes">
                        <i data-lucide="eye" style="width: 16px; height: 16px;"></i> Ver mais
                    </button>
                    <button onclick="window.printReceipt('${sale.id}')" class="btn-secondary" style="height: 36px; padding: 0 0.6rem;" title="Imprimir Recibo">
                        <i data-lucide="printer" style="width: 15px; height: 15px;"></i>
                    </button>
                    <button onclick="window.requestAuth('delete-sale', '${sale.id}')" class="btn-icon-tbl danger" style="height: 36px; width: 36px; display: flex; align-items: center; justify-content: center;" title="Excluir">
                        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
            `;
            gridDiv.appendChild(card);
        });

        list.appendChild(gridDiv);
    } else {
        filteredSales.forEach(sale => {
            const saleDate = new Date(sale.date);
            const dateStr = saleDate.toLocaleDateString('pt-BR');
            const timeStr = saleDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            const div = document.createElement('div');
            div.className = 'sale-card';
            div.innerHTML = `
                <div class="sale-card-info" style="flex-direction: row; align-items: center; gap: 1rem;">
                    <div style="width: 40px; height: 40px; border-radius: 8px; background: var(--muted); display: flex; align-items: center; justify-content: center; color: var(--primary); border: 1px solid var(--border);">
                        <i data-lucide="shopping-bag" style="width: 20px; height: 20px;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; font-size: 1rem;">Venda #${sale.id.slice(-5)}</div>
                        <div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.15rem;">
                            ${dateStr} às ${timeStr} • ${sale.items.length} item(ns)
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 1.5rem;">
                    <div class="sale-card-total">
                        ${formatter.format(sale.total)}
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <button onclick="window.printReceipt('${sale.id}')" class="btn-secondary" style="height: 36px; padding: 0 0.75rem;" title="Imprimir Recibo">
                            <i data-lucide="printer" style="width:16px;height:16px;"></i>
                        </button>
                        <button onclick="window.openSaleDetails('${sale.id}')" class="btn-secondary" style="height: 36px; padding: 0 0.75rem;" title="Ver Detalhes">
                            <i data-lucide="eye" style="width:16px;height:16px;"></i>
                        </button>
                        <button onclick="window.requestAuth('delete-sale', '${sale.id}')" class="btn-icon-tbl danger" style="height: 36px; display: flex; align-items: center; justify-content: center;" title="Excluir Venda">
                            <i data-lucide="trash-2" style="width:18px;height:18px;"></i>
                        </button>
                    </div>
                </div>
            `;
            list.appendChild(div);
        });
    }

    if(typeof lucide !== 'undefined') lucide.createIcons();
};

// ==========================================
// IMPRESSÃO NATIVA SEM IFRAME (À PROVA DE FALHAS)
// ==========================================
window.printReceipt = (saleId) => {
    const sale = salesDatabase.find(s => s.id === saleId);
    if(!sale) return;

    const dateObj = new Date(sale.date);
    const dateStr = dateObj.toLocaleDateString('pt-BR');
    const timeStr = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const storeName = localStorage.getItem('sys_store_name') || 'JÚ MAGAZINE';
    const storeDoc = localStorage.getItem('sys_store_doc') || '';
    const storeAddress = localStorage.getItem('sys_store_address') || '';

    let headerInfo = `<div class="r-center r-bold" style="font-size: 16px; margin-bottom: 5px;">${storeName}</div>`;
    if (storeDoc) headerInfo += `<div class="r-center">${storeDoc}</div>`;
    if (storeAddress) headerInfo += `<div class="r-center">${storeAddress}</div>`;

    let itemsHtml = '';
    sale.items.forEach(item => {
        itemsHtml += `
            <tr>
                <td colspan="3" class="r-left r-bold" style="padding-top: 6px; padding-bottom: 2px;">${item.qtd}x ${item.name}</td>
            </tr>
            <tr>
                <td></td>
                <td class="r-left">${formatter.format(item.price)}</td>
                <td class="r-right">${formatter.format(item.total)}</td>
            </tr>
        `;
    });

    const payments = [...new Set(sale.items.map(i => i.paymentDetails || i.payment))].join(', ');

    const receiptContent = `
        ${headerInfo}
        <div class="r-divider"></div>
        
        <div><span class="r-bold">DATA:</span> ${dateStr} ${timeStr}</div>
        <div><span class="r-bold">CUPOM:</span> #${sale.id.slice(-6).toUpperCase()}</div>
        
        <div class="r-divider"></div>
        <div class="r-center r-bold" style="margin-bottom: 4px;">CUPOM NÃO FISCAL</div>
        <table class="r-table">
            <thead>
                <tr>
                    <th class="r-left" colspan="3" style="border-bottom: 1px solid #000;">DESCRIÇÃO</th>
                </tr>
                <tr>
                    <th class="r-left"></th>
                    <th class="r-left" style="border-bottom: 1px solid #000;">VL.UN(R$)</th>
                    <th class="r-right" style="border-bottom: 1px solid #000;">VL.TOT(R$)</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>
        <div class="r-divider"></div>
        
        <table class="r-table">
            <tr>
                <td class="r-bold r-left" style="font-size: 14px !important;">TOTAL</td>
                <td class="r-bold r-right" style="font-size: 14px !important;">${formatter.format(sale.total)}</td>
            </tr>
            <tr>
                <td class="r-left" style="padding-top:4px;">Pagto:</td>
                <td class="r-right" style="padding-top:4px; max-width: 140px; word-wrap: break-word;">${payments}</td>
            </tr>
        </table>
        <div class="r-divider"></div>
        
        <div class="r-center">Obrigado pela preferência!</div>
        <div class="r-center" style="margin-top: 4px;">Volte Sempre!</div>
    `;

    const printContainer = document.getElementById('print-receipt-container');
    printContainer.innerHTML = receiptContent;
    
    window.print();
};

// DASHBOARD
window.populateMonthSelector = (selectorId) => {
    const sel = document.getElementById(selectorId);
    if (!sel) return;
    const months = new Set();
    salesDatabase.forEach(s => {
        if(s.date) months.add(s.date.substring(0, 7));
    });
    
    const currentMonth = new Date().toISOString().substring(0, 7);
    months.add(currentMonth);
    
    const sorted = Array.from(months).sort().reverse();
    const currVal = sel.value || currentMonth;
    
    sel.innerHTML = '';
    sorted.forEach(m => {
        const [yy, mm] = m.split('-');
        let name = new Date(yy, parseInt(mm)-1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        name = name.charAt(0).toUpperCase() + name.slice(1);
        if (m === currentMonth) name += ' (Atual)';
        
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = name;
        if (m === currVal) opt.selected = true;
        sel.appendChild(opt);
    });
    
    if(!sel.value) sel.value = currentMonth;
};

window.renderDashboard = () => {
    window.populateMonthSelector('dash-month-selector');
    const sel = document.getElementById('dash-month-selector');
    if (!sel) return;
    const selectedMonth = sel.value;
    
    const monthSales = salesDatabase.filter(s => s.date && s.date.startsWith(selectedMonth));
    
    let totalRev = 0;
    const productCount = {};
    const productRev = {};
    const paymentCount = {};
    const paymentRev = {};
    
    monthSales.forEach(sale => {
        totalRev += parseFloat(sale.total) || 0;
        
        if (sale.items && Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                const name = item.name || 'Desconhecido';
                productCount[name] = (productCount[name] || 0) + (parseInt(item.qtd) || 1);
                productRev[name] = (productRev[name] || 0) + (parseFloat(item.total) || 0);
                
                const pInfo = item.paymentDetails || item.payment || 'Desconhecido';
                if (pInfo.startsWith('Múltiplo')) {
                    const match = pInfo.match(/\((.*?)\)/);
                    if (match && match[1]) {
                        const parts = match[1].split('|');
                        parts.forEach(p => {
                            const [pType, pValStr] = p.split(':');
                            if (pType && pValStr) {
                                const cleanType = pType.trim().split(' ')[0];
                                let baseType = cleanType.trim();
                                if(baseType === 'Crédito') baseType = 'Cartão de Crédito';
                                if(baseType === 'Débito') baseType = 'Cartão de Débito';
                                const cVal = parseFloat(pValStr.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
                                
                                paymentCount[baseType] = (paymentCount[baseType] || 0) + 1;
                                paymentRev[baseType] = (paymentRev[baseType] || 0) + cVal;
                            }
                        });
                    }
                } else {
                    let baseType = pInfo.split(' ')[0].trim();
                    if(baseType === 'Crédito') baseType = 'Cartão de Crédito';
                    if(baseType === 'Débito') baseType = 'Cartão de Débito';
                    if(baseType === 'Fiado') baseType = 'Fiado';
                    
                    paymentCount[baseType] = (paymentCount[baseType] || 0) + 1;
                    paymentRev[baseType] = (paymentRev[baseType] || 0) + (parseFloat(item.total) || 0);
                }
            });
        }
    });
    
    document.getElementById('dash-total-sales').innerText = monthSales.length;
    document.getElementById('dash-total-revenue').innerText = formatter.format(totalRev);
    const avg = monthSales.length > 0 ? (totalRev / monthSales.length) : 0;
    document.getElementById('dash-avg-ticket').innerText = formatter.format(avg);
    
    let topPay = 'Nenhuma';
    let maxPay = 0;
    Object.keys(paymentCount).forEach(k => {
        if(paymentCount[k] > maxPay) { maxPay = paymentCount[k]; topPay = k; }
    });
    document.getElementById('dash-top-payment').innerText = topPay;
    document.getElementById('dash-top-payment-desc').innerText = maxPay > 0 ? `${maxPay} transações` : 'Nenhum dado';

    let topRevPay = 'Nenhuma';
    let maxRev = 0;
    Object.keys(paymentRev).forEach(k => {
        if(paymentRev[k] > maxRev) { maxRev = paymentRev[k]; topRevPay = k; }
    });
    const revEl = document.getElementById('dash-top-revenue-payment');
    if (revEl) revEl.innerText = topRevPay;
    const revDescEl = document.getElementById('dash-top-revenue-payment-desc');
    if (revDescEl) revDescEl.innerText = maxRev > 0 ? formatter.format(maxRev) : 'Nenhum dado';
    
    const prodArray = Object.keys(productCount).map(k => ({ name: k, count: productCount[k], rev: productRev[k] }));
    prodArray.sort((a,b) => b.count - a.count);
    
    const prodContainer = document.getElementById('dash-ranking-products');
    prodContainer.innerHTML = '';
    if(prodArray.length === 0) prodContainer.innerHTML = '<p class="desc">Sem vendas neste mês.</p>';
    prodArray.slice(0, 10).forEach(p => {
        prodContainer.innerHTML += `
        <div class="ranking-item">
            <div class="ranking-info">
                <span class="ranking-name">${p.name}</span>
                <span class="ranking-sub">${p.count} unid. vendidas</span>
            </div>
            <div class="ranking-val">${formatter.format(p.rev)}</div>
        </div>`;
    });
    
    const payArray = Object.keys(paymentCount).map(k => ({ name: k, count: paymentCount[k], rev: paymentRev[k] }));
    payArray.sort((a,b) => b.rev - a.rev);
    
    const payContainer = document.getElementById('dash-ranking-payments');
    payContainer.innerHTML = '';
    if(payArray.length === 0) payContainer.innerHTML = '<p class="desc">Sem pagamentos neste mês.</p>';
    payArray.forEach(p => {
        payContainer.innerHTML += `
        <div class="ranking-item">
            <div class="ranking-info">
                <span class="ranking-name">${p.name}</span>
                <span class="ranking-sub">${p.count} vezes utilizada</span>
            </div>
            <div class="ranking-val">${formatter.format(p.rev)}</div>
        </div>`;
    });
    
    if(typeof lucide !== 'undefined') lucide.createIcons();
};

// INICIALIZADORES EXTRAS
if (typeof flatpickr !== 'undefined') {
    flatpickr("#hist-date", {
        locale: "pt",
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        disableMobile: "true"
    });
}

// ==========================================
// CONTA DO USUÁRIO E POPOVER
// ==========================================

window.toggleAccountPopover = (e) => {
    e.stopPropagation();
    const popover = document.getElementById('account-popover');
    if (popover) {
        popover.classList.toggle('popover-active');
        const chevron = document.querySelector('.account-chevron');
        if (chevron) {
            chevron.style.transform = popover.classList.contains('popover-active') ? 'rotate(90deg)' : 'rotate(0deg)';
        }
    }
};

document.addEventListener('click', (e) => {
    const popover = document.getElementById('account-popover');
    if (popover && popover.classList.contains('popover-active') && !e.target.closest('.sidebar-account')) {
        popover.classList.remove('popover-active');
        const chevron = document.querySelector('.account-chevron');
        if (chevron) {
            chevron.style.transform = 'rotate(0deg)';
        }
    }
});

window.openProfileModal = () => {
    const popover = document.getElementById('account-popover');
    if (popover) popover.classList.remove('popover-active');
    
    const savedName = localStorage.getItem('sys_profile_name') || 'Usuário Logado';
    
    document.getElementById('profile-name-input').value = savedName;
    document.getElementById('profile-admin-pwd').value = '';
    
    document.getElementById('profile-modal').classList.remove('hidden');
};

window.closeProfileModal = () => {
    document.getElementById('profile-modal').classList.add('hidden');
};

window.openNotificationsModal = () => {
    const popover = document.getElementById('account-popover');
    if (popover) popover.classList.remove('popover-active');
    document.getElementById('notifications-modal').classList.remove('hidden');
};

window.renderChangelogsMain = (list) => {
    const container = document.getElementById('changelogs-container-main');
    if (!container) return;
    
    container.innerHTML = '';
    list.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--muted-foreground); font-size: 0.9rem; padding: 2rem 0;">Nenhuma novidade no momento.</div>';
        return;
    }

    list.forEach(cl => {
        const dateObj = new Date(cl.date);
        let dateStr = dateObj.toLocaleDateString('pt-BR');
        // se for hoje, mostrar 'Hoje'
        const today = new Date();
        if (dateObj.toDateString() === today.toDateString()) {
            dateStr = 'Hoje';
        }

        const item = document.createElement('div');
        item.className = 'card';
        item.style.padding = '1rem';
        item.style.boxShadow = 'none';
        item.style.border = '1px solid var(--border)';
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <h3 style="margin: 0; font-size: 1rem;">${cl.title}</h3>
                <span style="font-size: 0.75rem; color: var(--muted-foreground);">${dateStr}</span>
            </div>
            <p style="margin: 0; font-size: 0.85rem; color: var(--muted-foreground); white-space: pre-wrap;">${cl.description}</p>
        `;
        container.appendChild(item);
    });
};

window.closeNotificationsModal = () => {
    document.getElementById('notifications-modal').classList.add('hidden');
};

window.logout = async () => {
    window.showToast("Saindo da conta...", "info");
    try {
        const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
        const auth = getAuth();
        await signOut(auth);
        window.location.replace("login.html");
    } catch(e) {
        console.error(e);
        window.location.replace("login.html");
    }
};

window.saveProfile = async (e) => {
    e.preventDefault();
    if(!userId) return window.showToast("Carregando banco de dados, aguarde...", "error");

    const adminPwd = document.getElementById('profile-admin-pwd').value;
    
    if (adminPwd !== localStorage.getItem('sys_admin_pwd')) {
        return window.showToast("Senha Admin incorreta!", "error");
    }
    
    const newName = document.getElementById('profile-name-input').value;
    const photoFile = document.getElementById('profile-photo').files[0];
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Salvando na nuvem...';

    const saveToCloud = async (name, photoBase64) => {
        try {
            const userData = { name: name, adminPwd: adminPwd, updatedAt: new Date().toISOString() };
            if (photoBase64) userData.photo = photoBase64;
            else if (localStorage.getItem('sys_profile_photo')) userData.photo = localStorage.getItem('sys_profile_photo');
            
            await setDoc(doc(db, ...window.getDbPathArray('usuarios'), userId), userData, { merge: true });
            
            localStorage.setItem('sys_profile_name', name);
            if (photoBase64) localStorage.setItem('sys_profile_photo', photoBase64);
            updateProfileUI();
            window.showToast("Perfil atualizado com sucesso na nuvem!", "success");
            window.closeProfileModal();
        } catch (error) {
            console.error(error);
            window.showToast("Erro ao salvar perfil na nuvem.", "error");
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    if (photoFile) {
        compressImage(photoFile, (base64) => {
            saveToCloud(newName, base64);
        });
    } else {
        saveToCloud(newName, null);
    }
};

function updateProfileUI() {
    const savedName = localStorage.getItem('sys_profile_name') || 'Usuário Logado';
    const savedPhoto = localStorage.getItem('sys_profile_photo');
    
    const nameDisplay = document.getElementById('account-name-display');
    if (nameDisplay) nameDisplay.innerText = savedName;
    
    const imgDisplay = document.getElementById('account-avatar-img');
    if (imgDisplay && savedPhoto) {
        imgDisplay.src = savedPhoto;
    } else if (imgDisplay) {
        imgDisplay.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(savedName)}&background=random`;
    }
}

if (typeof bindFileInput === 'function') {
    bindFileInput('profile-photo', 'profile-photo-filename');
}
updateProfileUI();

window.toggleFilterPopover = (e) => {
    e.stopPropagation();
    const popover = document.getElementById('filter-popover');
    if (popover) {
        popover.classList.toggle('popover-active');
    }
};

document.addEventListener('click', (e) => {
    const filterPopover = document.getElementById('filter-popover');
    if (filterPopover && filterPopover.classList.contains('popover-active') && !e.target.closest('.filter-popover-wrapper')) {
        filterPopover.classList.remove('popover-active');
    }
});

let pendingDeleteProductId = null;

window.openDeleteConfirm1 = (id) => {
    pendingDeleteProductId = id;
    document.getElementById('delete-confirm1-modal').classList.remove('hidden');
};

window.closeDeleteConfirm1 = () => {
    document.getElementById('delete-confirm1-modal').classList.add('hidden');
};

window.openDeleteConfirm2 = () => {
    const p = productsDatabase.find(x => x.id === pendingDeleteProductId);
    if (!p) return;
    
    window.closeDeleteConfirm1();
    
    let photoHTML = '';
    if (p.photo) photoHTML = `<img src="${p.photo}" style="width: 80px; height: 80px; border-radius: 8px; object-fit: cover; margin: 0 auto; display: block; margin-bottom: 1rem;">`;
    else photoHTML = `<div style="width: 80px; height: 80px; border-radius: 8px; background: var(--muted); margin: 0 auto; display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;"><i data-lucide="image" style="color: var(--muted-foreground);"></i></div>`;
    
    document.getElementById('delete-confirm2-content').innerHTML = `
        ${photoHTML}
        <h3 style="margin-bottom: 0.25rem;">${p.name.toUpperCase()}</h3>
        <p style="color: var(--muted-foreground); font-size: 0.9rem;">Estoque: ${p.stock !== undefined ? p.stock : 1} unid.</p>
    `;
    if(typeof lucide !== 'undefined') lucide.createIcons();
    
    document.getElementById('delete-confirm2-modal').classList.remove('hidden');
};

window.closeDeleteConfirm2 = () => {
    document.getElementById('delete-confirm2-modal').classList.add('hidden');
};

window.executeDeleteProduct = async () => {
    if(!userId || !pendingDeleteProductId) return;
    
    const btn = document.getElementById('btn-execute-delete');
    if(btn) { btn.disabled = true; btn.innerHTML = 'Excluindo...'; }
    
    try {
        await deleteDoc(doc(db, ...window.getDbPathArray('produtos'), pendingDeleteProductId));
        window.showToast("Produto excluído da nuvem.", "success");
        window.closeDeleteConfirm2();
    } catch (error) {
        console.error(error); window.showToast("Erro ao excluir do Firebase.", "error");
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = 'Excluir Definitivamente'; }
    }
};

window.handleBackupUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById('backup-filename').innerText = file.name;
    
    if(!confirm("Atenção: A restauração pode adicionar produtos novos ou sobrescrever os atuais (sem imagens) se o ID coincidir. Deseja continuar?")) {
        event.target.value = '';
        document.getElementById('backup-filename').innerText = 'Nenhum arquivo...';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const lines = text.split('\\n');
        if (lines.length < 2) return window.showToast("Arquivo CSV inválido ou vazio.", "error");
        
        window.showToast("Restaurando backup...", "info");
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            // Regex for CSV parsing (handles quotes)
            const regex = /(".*?"|[^";\\n]+)(?=\\s*;|\\s*$)/g;
            const values = lines[i].match(regex) || [];
            if (values.length === 0) continue;
            
            const clean = (val) => val ? val.replace(/^"|"$/g, '') : '';
            
            const pId = clean(values[0]);
            const pName = clean(values[1]);
            const pStock = parseInt(clean(values[2]));
            const pCost = parseFloat(clean(values[3]));
            const pSell = parseFloat(clean(values[4]));
            const pProfit = parseFloat(clean(values[5]));
            const pPercent = parseFloat(clean(values[6]));
            const pTag = clean(values[7]);
            const pNotes = clean(values[8]);
            const pCreatedAt = clean(values[9]);
            
            if (pId && pName) {
                const prodData = {
                    id: pId,
                    name: pName,
                    stock: isNaN(pStock) ? 1 : pStock,
                    cost: isNaN(pCost) ? 0 : pCost,
                    sell: isNaN(pSell) ? 0 : pSell,
                    profit: isNaN(pProfit) ? 0 : pProfit,
                    percent: isNaN(pPercent) ? 0 : pPercent,
                    tag: pTag,
                    notes: pNotes,
                    createdAt: pCreatedAt || new Date().toISOString()
                };
                
                try {
                    await setDoc(doc(db, ...window.getDbPathArray('produtos'), pId), prodData, { merge: true });
                } catch (err) {
                    console.error("Erro ao restaurar", pId, err);
                }
            }
        }
        window.showToast("Restauração concluída com sucesso!", "success");
        event.target.value = '';
        document.getElementById('backup-filename').innerText = 'Nenhum arquivo...';
    };
    reader.readAsText(file);
};

window.openBulkDeleteConfirm = () => {
    if (selectedProducts.size === 0) return;
    document.getElementById('bulk-delete-count').innerText = selectedProducts.size;
    document.getElementById('bulk-delete-modal').classList.remove('hidden');
};

window.closeBulkDeleteConfirm = () => {
    document.getElementById('bulk-delete-modal').classList.add('hidden');
};

window.executeDeleteProductAuth = () => {
    window.closeDeleteConfirm2();
    window.requestAuth('delete-final', pendingDeleteProductId);
};

window.executeBulkDeleteAuth = () => {
    window.closeBulkDeleteConfirm();
    window.requestAuth('bulk-delete-final');
};

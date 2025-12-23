// Global variables
let activities = [];
let progressData = {};
let weldsData = {}; // Track completed welds for activities with soldas
let currentRecordIndex = 0; // Index of currently displayed record
let itemsPerPage = 5; // Number of records to show at once
let sCurveChart = null; // Chart.js instance for S-Curve
let isLoadingActivities = false; // Flag to prevent duplicate loads

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadProgressData();
    loadWeldsData(); // Load welds tracking data
    loadActivities(); // Try to load saved activities first
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    const filterSearch = document.getElementById('filterSearch');
    if (filterSearch) {
        filterSearch.addEventListener('input', () => {
            currentRecordIndex = 0; // Reset to first record when filtering
            renderActivities();
        });
    }
    const filterID = document.getElementById('filterID');
    if (filterID) {
        filterID.addEventListener('change', () => {
            currentRecordIndex = 0; // Reset to first record when filtering
            renderActivities();
        });
    }
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) {
        filterStatus.addEventListener('change', () => {
            currentRecordIndex = 0; // Reset to first record when filtering
            renderActivities();
        });
    }
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.addEventListener('change', handleFileUpload);

    const pBtn = document.getElementById('prevRecord');
    if (pBtn) pBtn.addEventListener('click', previousRecord);

    const nBtn = document.getElementById('nextRecord');
    if (nBtn) nBtn.addEventListener('click', nextRecord);
}

// Load progress data from localStorage
function loadProgressData() {
    const saved = localStorage.getItem('caldeira_progress');
    if (saved) {
        progressData = JSON.parse(saved);
    }
}

// Save progress data to localStorage
function saveProgressData() {
    localStorage.setItem('caldeira_progress', JSON.stringify(progressData));
}

// Load activities (try saved first, then file)
async function loadActivities() {
    if (isLoadingActivities) return;
    isLoadingActivities = true;

    // Try to load from saved activities first
    let savedActivities = await loadSavedActivities();

    if (savedActivities && savedActivities.length > 0) {
        // Remover duplicatas por uniqueKey por segurança
        const unique = [];
        const seen = new Set();
        savedActivities.forEach(a => {
            if (!seen.has(a.uniqueKey)) {
                seen.add(a.uniqueKey);
                unique.push(a);
            }
        });
        activities = unique;

        // Migrate existing activities to add welds info if missing
        let needsUpdate = false;
        activities.forEach(activity => {
            if (activity.hasWelds === undefined || activity.totalWelds === undefined) {
                const weldsInfo = extractWeldsInfo(activity.name);
                activity.hasWelds = weldsInfo.hasWelds;
                activity.totalWelds = weldsInfo.totalWelds;
                needsUpdate = true;
            }
        });

        // Save updated activities if migration was needed
        if (needsUpdate) {
            saveActivities();
            console.log('Atividades migradas com informações de soldas.');
        }

        console.log(`${activities.length} atividades carregadas.`);
        populateFilters();
        renderActivities();
        isLoadingActivities = false;
        return;
    }

    // If no saved activities, try to load from file
    await loadActivitiesFromFile();
    isLoadingActivities = false;
}

// Load saved activities from localStorage or Firestore
async function loadSavedActivities() {
    // If logged in, try to load from Firestore first
    if (typeof currentUser !== 'undefined' && currentUser) {
        const firestoreActivities = await loadActivitiesFromFirestore();
        if (firestoreActivities && firestoreActivities.length > 0) {
            console.log('Atividades carregadas do Firestore.');
            return firestoreActivities;
        }
    }

    // Fallback to localStorage
    try {
        const saved = localStorage.getItem('caldeira_activities');
        if (saved) {
            console.log('Atividades carregadas do localStorage.');
            return JSON.parse(saved);
        }
    } catch (error) {
        console.error('Erro ao carregar atividades salvas:', error);
    }
    return null;
}

// Load activities from Firestore
async function loadActivitiesFromFirestore() {
    if (typeof currentUser === 'undefined' || !currentUser) return null;

    try {
        if (typeof showSyncIndicator === 'function') showSyncIndicator('Carregando atividades da nuvem...');

        const doc = await db.collection('shared_data')
            .doc('activities')
            .get();

        if (typeof hideSyncIndicator === 'function') hideSyncIndicator();

        if (doc.exists && doc.data().activities) {
            return doc.data().activities;
        }
    } catch (error) {
        console.error('Erro ao carregar atividades do Firestore:', error);
        if (typeof hideSyncIndicator === 'function') hideSyncIndicator();
    }
    return null;
}

// Save activities to localStorage or Firestore
async function saveActivities() {
    try {
        // Always save to localStorage as backup
        localStorage.setItem('caldeira_activities', JSON.stringify(activities));
        console.log(`${activities.length} atividades salvas no localStorage.`);

        // If logged in, also save to Firestore
        if (typeof currentUser !== 'undefined' && currentUser) {
            await saveActivitiesToFirestore();
        }
    } catch (error) {
        console.error('Erro ao salvar atividades:', error);
    }
}

// Save activities to Firestore
async function saveActivitiesToFirestore() {
    if (typeof currentUser === 'undefined' || !currentUser) return;

    try {
        if (typeof showSyncIndicator === 'function') showSyncIndicator('Salvando atividades na nuvem...');

        // Save activities array to shared location
        await db.collection('shared_data')
            .doc('activities')
            .set({
                activities: activities,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                lastUpdatedBy: currentUser.email
            }, { merge: true });

        console.log(`${activities.length} atividades salvas no Firestore.`);
        if (typeof hideSyncIndicator === 'function') hideSyncIndicator();
    } catch (error) {
        console.error('Erro ao salvar atividades no Firestore:', error);
        if (typeof hideSyncIndicator === 'function') hideSyncIndicator();
    }
}

// Load activities from the text file
async function loadActivitiesFromFile() {
    try {
        const response = await fetch('Novo(a) Documento de Texto.txt');
        if (!response.ok) throw new Error('File not found');
        const text = await response.text();
        parseActivitiesFromText(text);
        saveActivities(); // Save activities after loading from file
        populateFilters();
        renderActivities();
    } catch (error) {
        console.log('Arquivo padrão não encontrado. Por favor, carregue um arquivo via interface.');
    }
}

// Parse activities from text content
function parseActivitiesFromText(text) {
    const lines = text.split('\n').filter(line => line.trim());
    activities = []; // Clear existing to prevent duplication

    if (lines.length < 2) return;

    const headerLine = lines[0];
    const headers = headerLine.split('\t').map((h, i) => ({
        name: h.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
        index: i
    }));

    const getIndex = (possibleNames) => {
        for (const name of possibleNames) {
            const match = headers.find(h => h.name === name);
            if (match) return match.index;
        }
        return -1;
    };

    const colMap = {
        id: getIndex(['ID']),
        activity: getIndex(['ATIVIDADE', 'NOME', 'TOPICO']),
        summary: getIndex(['RESUMO', 'RESUMO?']),
        start: getIndex(['INICIO', 'INÍCIO', 'DATA DE INICIO', 'DATA_INICIO']),
        end: getIndex(['TERMINO', 'TÉRMINO', 'FIM', 'DATA DE FIM', 'DATA_FIM']),
        calendar: getIndex(['DURACAO', 'DURAÇÃO', 'CALENDARIO', 'HORAS']),
        progress: getIndex(['AVANCO', '% AVANCO', 'V AVANCO']),
        status: getIndex(['STATUS', 'SITUACAO', 'ESTADO'])
    };

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split('\t');
        const getVal = (index) => (index >= 0 && index < parts.length) ? parts[index].trim() : '';

        const id = getVal(colMap.id);
        const name = getVal(colMap.activity);
        if (!id || !name) continue;

        const uniqueKey = generateUniqueKey(id, name);
        const avancoValue = getVal(colMap.progress);

        if (avancoValue && avancoValue.trim() !== '') {
            let numericProgress = parseInt(avancoValue.replace(/[%]/g, ''), 10);
            if (!isNaN(numericProgress)) {
                if (!progressData[uniqueKey]) {
                    progressData[uniqueKey] = {
                        current: numericProgress,
                        history: [{ value: numericProgress, timestamp: new Date().toISOString() }]
                    };
                } else {
                    progressData[uniqueKey].current = numericProgress;
                }
            }
        }

        const weldsInfo = extractWeldsInfo(name);
        const activity = {
            id, name,
            summary: getVal(colMap.summary),
            startDate: getVal(colMap.start),
            endDate: getVal(colMap.end),
            calendar: getVal(colMap.calendar),
            statusText: getVal(colMap.status),
            uniqueKey,
            hasWelds: weldsInfo.hasWelds,
            totalWelds: weldsInfo.totalWelds
        };
        activities.push(activity);
    }
}

// Handle file upload
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const password = prompt('Digite a senha para carregar o arquivo:');
    if (password !== '789512') {
        alert('Senha incorreta! O arquivo não será carregado.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            try {
                const workbook = XLSX.read(data, { type: 'array' });
                parseActivitiesFromWorkbook(workbook);
                saveActivities();
                populateFilters();
                renderActivities();
                alert(`✅ Arquivo Excel carregado com sucesso!\n\n${activities.length} atividades importadas.`);
            } catch (error) {
                console.error('Erro ao ler arquivo Excel:', error);
                alert('Erro ao ler o arquivo Excel.');
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        reader.onload = (e) => {
            parseActivitiesFromText(e.target.result);
            saveActivities();
            populateFilters();
            renderActivities();
            alert('✅ Arquivo carregado com sucesso!');
        };
        reader.readAsText(file);
    }
}

// Parse activities from Excel Workbook
function parseActivitiesFromWorkbook(workbook) {
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) return;
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (jsonData.length < 2) return;

    let headerRowIndex = 0;
    let headers = [];
    for (let i = 0; i < jsonData.length; i++) {
        if (jsonData[i].length > 0) {
            headerRowIndex = i;
            headers = jsonData[i].map((h, index) => ({
                original: String(h).trim(),
                name: String(h).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
                index: index
            }));
            break;
        }
    }

    activities = [];
    const getIndex = (possibleNames) => {
        for (const name of possibleNames) {
            const match = headers.find(h => h.name === name);
            if (match) return match.index;
        }
        return -1;
    };

    const colMap = {
        id: getIndex(['ID']),
        activity: getIndex(['ATIVIDADE', 'NOME', 'TOPICO', 'NOME DA TAREFA']),
        summary: getIndex(['RESUMO', 'RESUMO?']),
        start: getIndex(['INICIO', 'INÍCIO', 'DATA DE INICIO', 'DATA_INICIO']),
        end: getIndex(['TERMINO', 'TÉRMINO', 'FIM', 'DATA DE FIM', 'DATA_FIM']),
        calendar: getIndex(['DURACAO', 'DURAÇÃO', 'CALENDARIO', 'HORAS']),
        progress: getIndex(['AVANCO', '% AVANCO', 'V AVANCO', '% CONCLUIDA']),
        status: getIndex(['STATUS', 'SITUACAO', 'ESTADO']),
        critical: getIndex(['CRITICA', 'CRÍTICA', 'CRITICAL'])
    };

    const parseDate = (val) => {
        if (!val) return '';
        if (typeof val === 'number') {
            const d = XLSX.SSF.parse_date_code(val);
            if (d) return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
        }
        const str = String(val).trim();
        const match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (match) {
            let [_, d, m, y] = match;
            if (y.length === 2) y = '20' + y;
            return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
        }
        return str;
    };

    const parseDuration = (val) => {
        if (!val) return '';
        const str = String(val).trim();
        const match = str.match(/(\d+(?:\.\d+)?)/);
        return match ? `${match[1]} h` : str;
    };

    for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;

        const getVal = (index) => {
            if (index >= 0 && index < row.length && row[index] !== undefined) {
                if (index === colMap.start || index === colMap.end) return parseDate(row[index]);
                if (index === colMap.calendar) return parseDuration(row[index]);
                return String(row[index]).trim();
            }
            return '';
        };

        const id = getVal(colMap.id);
        const name = getVal(colMap.activity);
        if (!id && !name) continue;

        const uniqueKey = generateUniqueKey(id || 'TEMP_' + i, name || 'Sem Nome');
        const avancoValue = getVal(colMap.progress);

        if (avancoValue !== '') {
            let num = 0;
            if (avancoValue.includes('%')) num = parseInt(avancoValue.replace(/[%]/g, ''), 10);
            else {
                const val = parseFloat(avancoValue);
                if (!isNaN(val)) num = (val <= 1 && val >= 0) ? Math.round(val * 100) : Math.round(val);
            }
            if (!isNaN(num)) {
                if (!progressData[uniqueKey]) progressData[uniqueKey] = { current: num, history: [{ value: num, timestamp: new Date().toISOString() }] };
                else progressData[uniqueKey].current = num;
            }
        }

        const weldsInfo = extractWeldsInfo(name || '');
        activities.push({
            id: id || '-',
            name: name || '(Sem descrição)',
            summary: getVal(colMap.summary),
            startDate: getVal(colMap.start),
            endDate: getVal(colMap.end),
            calendar: getVal(colMap.calendar),
            statusText: getVal(colMap.status),
            critical: getVal(colMap.critical),
            uniqueKey,
            hasWelds: weldsInfo.hasWelds,
            totalWelds: weldsInfo.totalWelds
        });
    }
}

// Generate stable unique key
function generateUniqueKey(id, name) {
    const normalizedName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_');
    return `${id}_${normalizedName}`;
}

// Get gradient color
function getProgressGradient(percentage) {
    const p = Math.max(0, Math.min(100, percentage));
    if (p <= 50) {
        const r = p / 50;
        const R = Math.round(239 + (249 - 239) * r);
        const G = Math.round(68 + (115 - 68) * r);
        const B = Math.round(68 + (22 - 68) * r);
        return `linear-gradient(90deg, rgb(${R}, ${G}, ${B}), rgb(249, 115, 22))`;
    } else {
        const r = (p - 50) / 50;
        const R = Math.round(249 + (34 - 249) * r);
        const G = Math.round(115 + (197 - 115) * r);
        const B = Math.round(22 + (94 - 22) * r);
        return `linear-gradient(90deg, rgb(249, 115, 22), rgb(${R}, ${G}, ${B}))`;
    }
}

// Extract welds information
function extractWeldsInfo(name) {
    const match = name.match(/\((\d+)\s*SOLDAS?\)/i);
    return match ? { hasWelds: true, totalWelds: parseInt(match[1], 10) } : { hasWelds: false, totalWelds: 0 };
}

// Load welds data
function loadWeldsData() {
    try {
        const saved = localStorage.getItem('caldeira_welds');
        if (saved) weldsData = JSON.parse(saved);
    } catch (e) { console.error(e); }
}

// Save welds data
function saveWeldsData() {
    try { localStorage.setItem('caldeira_welds', JSON.stringify(weldsData)); } catch (e) { console.error(e); }
}

// Welds logic
function getWeldsCompleted(key) { return weldsData[key]?.completed || 0; }
function setWeldsCompleted(key, val, total) {
    if (!weldsData[key]) weldsData[key] = {};
    weldsData[key].completed = Math.max(0, Math.min(total, val));
    weldsData[key].total = total;
    saveWeldsData();
}
function incrementWelds(key) {
    const a = activities.find(x => x.uniqueKey === key);
    if (a && a.hasWelds) {
        const cur = getWeldsCompleted(key);
        if (cur < a.totalWelds) {
            setWeldsCompleted(key, cur + 1, a.totalWelds);
            updateWeldsDisplay(key, cur + 1, a.totalWelds);
        }
    }
}
function decrementWelds(key) {
    const a = activities.find(x => x.uniqueKey === key);
    if (a && a.hasWelds) {
        const cur = getWeldsCompleted(key);
        if (cur > 0) {
            setWeldsCompleted(key, cur - 1, a.totalWelds);
            updateWeldsDisplay(key, cur - 1, a.totalWelds);
        }
    }
}
function updateWeldsDisplay(key, val, total) {
    const el = document.querySelector(`.welds-value[data-key="${key}"]`);
    if (el) {
        el.textContent = val;
        const percEl = el.closest('.welds-display').querySelector('.welds-percentage');
        const p = total > 0 ? Math.round((val / total) * 100) : 0;
        if (percEl) percEl.textContent = `(${p}%)`;
        const bar = el.closest('.welds-control').querySelector('.welds-bar-fill');
        if (bar) { bar.style.width = `${p}%`; bar.style.background = getProgressGradient(p); }
    }
}

// Progress logic
function getProgress(key) {
    const d = progressData[key];
    if (!d) return 0;
    return typeof d === 'number' ? d : (d.current || 0);
}
function setProgress(key, val, skipRender = false) {
    const old = getProgress(key);
    const n = Math.max(0, Math.min(100, val));
    if (typeof progressData[key] !== 'object') {
        progressData[key] = { current: old, history: old > 0 ? [{ value: old, timestamp: new Date().toISOString() }] : [] };
    }
    if (n !== old) {
        progressData[key].current = n;
        progressData[key].history.push({ value: n, timestamp: new Date().toISOString() });
    }
    if (typeof currentUser !== 'undefined' && currentUser) saveProgressToFirestore(key, progressData[key]);
    else saveProgressData();
    if (!skipRender) updateActivityProgress(key);
}
function incrementProgress(key) { const cur = getProgress(key); if (cur < 100) setProgress(key, cur + 1); }
function decrementProgress(key) { const cur = getProgress(key); if (cur > 0) setProgress(key, cur - 1); }

function updateActivityProgress(key) {
    const p = getProgress(key);
    const item = document.querySelector(`.activity-item[data-key="${key}"]`);
    if (!item) return;
    const percEl = item.querySelector('.progress-percentage');
    if (percEl) percEl.textContent = `${p}%`;
    const bar = item.querySelector('.progress-bar');
    if (bar) { bar.style.width = `${p}%`; bar.style.background = getProgressGradient(p); }
    if (p === 100) item.classList.add('completed'); else item.classList.remove('completed');
    const a = activities.find(x => x.uniqueKey === key);
    if (a) updateSectionStats(a.id);
    updateStats();
}

function updateSectionStats(id) {
    const list = activities.filter(x => x.id === id);
    const p = calculateSectionProgress(list);
    const comp = list.filter(x => getProgress(x.uniqueKey) === 100).length;
    document.querySelectorAll('.activity-section').forEach(sec => {
        const sid = sec.querySelector('.section-id');
        if (sid && sid.textContent === id) {
            const pel = sec.querySelector('.section-progress');
            const cel = sec.querySelector('.section-count');
            if (pel) pel.textContent = `${p}%`;
            if (cel) cel.textContent = `${comp}/${list.length} concluídas`;
        }
    });
}

function resetAllProgress() {
    if (confirm('Resetar progresso de TODAS as atividades?')) { progressData = {}; saveProgressData(); renderActivities(); }
}

function clearAllData() {
    if (prompt('Senha admin:') !== '789512') return;
    if (confirm('APAGAR TODOS OS DADOS?')) {
        localStorage.removeItem('caldeira_activities');
        localStorage.removeItem('caldeira_progress');
        localStorage.removeItem('caldeira_welds');
        activities = []; progressData = {}; weldsData = {};
        if (typeof currentUser !== 'undefined' && currentUser) db.collection('users').doc(currentUser.uid).delete();
        populateFilters(); renderActivities(); alert('✅ Limpo!');
    }
}

// Filters & Hierarchy
function normalizeText(t) { return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function filterActivities() {
    const s = normalizeText(document.getElementById('filterSearch')?.value || '');
    const id = document.getElementById('filterID')?.value;
    const st = document.getElementById('filterStatus')?.value;
    return activities.filter(a => {
        if (s && !normalizeText(a.name).includes(s)) return false;
        if (id && a.id !== id) return false;
        if (st) {
            const p = getProgress(a.uniqueKey);
            if (st === 'completed' && p !== 100) return false;
            if (st === 'inProgress' && (p === 0 || p === 100)) return false;
            if (st === 'notStarted' && p !== 0) return false;
        }
        return true;
    });
}

function populateFilters() {
    const el = document.getElementById('filterID');
    if (!el) return;
    const ids = [...new Set(activities.map(a => a.id))].sort((a, b) => parseInt(a) - parseInt(b));
    el.innerHTML = '<option value="">Todos os IDs</option>';
    ids.forEach(id => { const opt = document.createElement('option'); opt.value = id; opt.textContent = `ID ${id}`; el.appendChild(opt); });
}

function createActivityHierarchy(list) {
    const grouped = {};
    list.forEach(a => { if (!grouped[a.id]) grouped[a.id] = []; grouped[a.id].push(a); });
    const hierarchy = [];
    Object.keys(grouped).sort((a, b) => parseInt(a) - parseInt(b)).forEach(id => {
        const group = grouped[id];
        const parent = group.find(x => (x.summary || '').toUpperCase().trim() === 'SIM');
        const children = group.filter(x => ['NAO', 'NÃO'].includes((x.summary || '').toUpperCase().trim()));
        const others = group.filter(x => !['SIM', 'NAO', 'NÃO'].includes((x.summary || '').toUpperCase().trim()));
        if (parent) hierarchy.push({ type: 'group', id, parent, children, others });
        else if (children.length > 0) hierarchy.push({ type: 'group', id, parent: null, children, others });
        else others.forEach(x => hierarchy.push({ type: 'standalone', id, activity: x }));
    });
    return hierarchy;
}

// Stats
function calculateSectionProgress(list) {
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, a) => sum + getProgress(a.uniqueKey), 0) / list.length);
}
function calculateStats() {
    const t = activities.length;
    const c = activities.filter(a => getProgress(a.uniqueKey) === 100).length;
    const crit = activities.filter(a => (a.critical || '').toUpperCase().trim() === 'SIM').length;
    const p = t > 0 ? Math.round(activities.reduce((sum, a) => sum + getProgress(a.uniqueKey) / 100, 0) / t * 100) : 0;

    // Welds stats
    let totalWelds = 0;
    let completedWelds = 0;
    activities.forEach(a => {
        if (a.hasWelds) {
            totalWelds += a.totalWelds || 0;
            completedWelds += getWeldsCompleted(a.uniqueKey);
        }
    });

    return { total: t, completed: c, critical: crit, overallProgress: p, totalWelds, completedWelds };
}
function updateStats() {
    const s = calculateStats();
    const tel = document.getElementById('totalActivities'); if (tel) tel.textContent = s.total;
    const cel = document.getElementById('completedActivities'); if (cel) cel.textContent = s.completed;
    const oel = document.getElementById('overallProgress'); if (oel) oel.textContent = `${s.overallProgress}%`;
    const crel = document.getElementById('criticalActivities'); if (crel) crel.textContent = s.critical;

    const wel = document.getElementById('totalWeldsStat');
    if (wel) {
        const perc = s.totalWelds > 0 ? Math.round((s.completedWelds / s.totalWelds) * 100) : 0;
        wel.textContent = `${s.completedWelds} / ${s.totalWelds} (${perc}%)`;
    }
}

// Rendering
function renderActivities() {
    const container = document.getElementById('activitiesContainer');
    if (!container) return;
    const filtered = filterActivities();
    container.innerHTML = '';
    if (filtered.length === 0) {
        container.innerHTML = '<div class="activity-section"><div style="text-align: center; padding: 2rem; color: var(--text-secondary);">📋 Nenhuma atividade encontrada.</div></div>';
        updateRecordNavigator(0, 0, 0); updateStats(); return;
    }
    const hierarchy = createActivityHierarchy(filtered);
    if (currentRecordIndex >= hierarchy.length) currentRecordIndex = Math.max(0, hierarchy.length - itemsPerPage);
    const end = Math.min(currentRecordIndex + itemsPerPage, hierarchy.length);
    const slice = hierarchy.slice(currentRecordIndex, end);

    slice.forEach(group => {
        const sec = document.createElement('div');
        sec.className = 'activity-section';
        if (group.type === 'standalone') {
            const a = group.activity;
            const p = getProgress(a.uniqueKey);
            const crit = (a.critical || '').toUpperCase().trim() === 'SIM' ? '<span class="critical-indicator" style="display: inline-block; width: 10px; height: 10px; background: #ff0000; border-radius: 50%; margin-left: 8px; box-shadow: 0 0 10px #ff0000; animation: pulse 2s infinite;" title="Crítica"></span>' : '';
            sec.innerHTML = `
                <div class="section-header">
                    <div class="section-id">${a.id}</div>
                    <div class="section-title"><h2>${a.name}${crit}</h2><p>Individual</p></div>
                    <div class="section-stats">
                        <div class="section-progress">${p}%</div>
                        <div class="section-count">${p === 100 ? 'Concluída' : 'Em andamento'}</div>
                        <div class="section-actions" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
                            <button class="btn-control edit" onclick="editActivity('${a.uniqueKey}')" style="background: var(--warning); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Editar">✏️</button>
                            <button class="btn-control delete" onclick="deleteActivity('${a.uniqueKey}')" style="background: var(--danger); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Excluir">🗑️</button>
                        </div>
                    </div>
                </div>
                <div class="activities-list">${renderActivity(a, false)}</div>`;
        } else {
            const p = Math.round((group.parent ? getProgress(group.parent.uniqueKey) : 0 + group.children.reduce((s, c) => s + getProgress(c.uniqueKey), 0) + (group.others || []).reduce((s, o) => s + getProgress(o.uniqueKey), 0)) / ((group.parent ? 1 : 0) + group.children.length + (group.others || []).length));
            const all = (group.parent ? [group.parent] : []).concat(group.children, group.others || []);
            const comp = all.filter(x => getProgress(x.uniqueKey) === 100).length;
            const title = group.parent ? group.parent.name : (group.children[0]?.name || 'Grupo');
            const crit = group.parent && (group.parent.critical || '').toUpperCase().trim() === 'SIM' ? '<span class="critical-indicator" style="display: inline-block; width: 10px; height: 10px; background: #ff0000; border-radius: 50%; margin-left: 8px; box-shadow: 0 0 10px #ff0000; animation: pulse 2s infinite;" title="Crítica"></span>' : '';
            const meta = group.parent ? `<div class="section-meta" style="display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);"><span>📅 ${group.parent.startDate} - ${group.parent.endDate}</span><span>⏱️ ${group.parent.calendar || '0 h'}</span></div>` : '';
            sec.innerHTML = `
                <div class="section-header">
                    <div class="section-id">${group.id}</div>
                    <div class="section-title"><h2>${title}${crit}</h2><p>${group.parent ? 'Atividade com sub-tarefas' : 'Grupo'}</p>${meta}</div>
                    <div class="section-stats">
                        <div class="section-progress">${p}%</div>
                        <div class="section-count">${comp}/${all.length} concluídas</div>
                        ${group.parent ? `
                        <div class="section-actions" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
                            <button class="btn-control edit" onclick="editActivity('${group.parent.uniqueKey}')" style="background: var(--warning); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Editar">✏️</button>
                            <button class="btn-control delete" onclick="deleteActivity('${group.parent.uniqueKey}')" style="background: var(--danger); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Excluir">🗑️</button>
                        </div>` : ''}
                    </div>
                </div>
                <div class="activities-list">${group.children.map(c => renderActivity(c, true)).join('')}${(group.others || []).map(o => renderActivity(o, true)).join('')}</div>`;
        }
        container.appendChild(sec);
    });
    updateRecordNavigator(currentRecordIndex + 1, end, hierarchy.length);
    updateStats(); attachEventListeners();
}

function calculateExpectedProgress(a) {
    try {
        const [sd, sm, sy] = a.startDate.split('/').map(Number);
        const [ed, em, ey] = a.endDate.split('/').map(Number);
        const s = new Date(sy, sm - 1, sd); const e = new Date(ey, em - 1, ed); const n = new Date();
        if (n < s) return 0; if (n > e) return 100;
        return Math.round(Math.min(100, Math.max(0, ((n - s) / (e - s)) * 100)));
    } catch (e) { return 0; }
}

function renderActivity(a, isChild = false) {
    const p = getProgress(a.uniqueKey); const exp = calculateExpectedProgress(a);
    const isComp = p === 100; const crit = (a.critical || '').toUpperCase().trim() === 'SIM' ? '<span class="critical-indicator" style="display: inline-block; width: 10px; height: 10px; background: #ff0000; border-radius: 50%; margin-left: 8px; box-shadow: 0 0 10px #ff0000; animation: pulse 2s infinite;" title="Crítica"></span>' : '';
    const hist = progressData[a.uniqueKey]?.history || [];
    const markers = hist.map(h => `<div class="timeline-marker" style="left: ${h.value}%" title="${h.value}% em ${new Date(h.timestamp).toLocaleDateString()}"></div>`).join('');

    return `
        <div class="activity-item ${isChild ? 'sub-activity' : ''} ${isComp ? 'completed' : ''}" data-key="${a.uniqueKey}">
            <div class="activity-header">
                <div class="activity-info">
                    <div class="activity-name">${isChild ? '└── ' : ''}${a.name}${crit}</div>
                    <div class="activity-meta">
                        ${(() => {
            const summary = (a.summary || '').toUpperCase().trim();
            if (summary === 'SIM' || summary === 'NÃO' || summary === 'NAO') return '';
            return a.summary ? `<span class="meta-item">📝 ${a.summary}</span>` : '';
        })()}
                        ${a.statusText ? `<span class="meta-item">📌 ${a.statusText}</span>` : ''}
                        <span class="meta-item">📅 ${a.startDate} - ${a.endDate}</span>
                        <span class="meta-item">⏱️ ${a.calendar || '0 h'}</span>
                    </div>
                </div>
                <div class="controls">
                    <button class="btn-control decrement" data-key="${a.uniqueKey}" data-action="decrement">▼</button>
                    <button class="btn-control increment" data-key="${a.uniqueKey}" data-action="increment">▲</button>
                </div>
                <div class="item-actions" style="display: flex; gap: 0.5rem; align-items: center; margin-left: 1rem;">
                    <button class="btn-control edit" onclick="editActivity('${a.uniqueKey}')" title="Editar" style="background: var(--warning); padding: 0.3rem; height: 32px; width: 32px;">✏️</button>
                    <button class="btn-control delete" onclick="deleteActivity('${a.uniqueKey}')" title="Excluir" style="background: var(--danger); padding: 0.3rem; height: 32px; width: 32px;">🗑️</button>
                </div>
            </div>
            <div class="progress-bars-wrapper">
                <div class="progress-bar-row"><span class="progress-label">Real:</span><div class="progress-bar-container"><div class="progress-bar" style="width: ${p}%; background: ${getProgressGradient(p)};"></div>${markers}</div><span class="progress-percentage">${p}%</span></div>
                <div class="progress-bar-row"><span class="progress-label">Previsto:</span><div class="progress-bar-container"><div class="progress-bar expected" style="width: ${exp}%"></div></div><span class="progress-percentage">${exp}%</span></div>
            </div>
            ${a.hasWelds ? `
                <div class="welds-control">
                    <div class="welds-header"><span class="welds-icon">🔧</span><span class="welds-label">SOLDAS OK:</span></div>
                    <div class="welds-controls-wrapper">
                        <button class="btn-control welds-decrement" data-key="${a.uniqueKey}" data-action="welds-decrement">▼</button>
                        <div class="welds-display"><span class="welds-value" data-key="${a.uniqueKey}">${getWeldsCompleted(a.uniqueKey)}</span><span class="welds-separator">/</span><span class="welds-total">${a.totalWelds}</span><span class="welds-percentage">(${a.totalWelds > 0 ? Math.round((getWeldsCompleted(a.uniqueKey) / a.totalWelds) * 100) : 0}%)</span></div>
                        <button class="btn-control welds-increment" data-key="${a.uniqueKey}" data-action="welds-increment">▲</button>
                    </div>
                    <div class="welds-progress-bar"><div class="welds-bar-fill" style="width: ${a.totalWelds > 0 ? Math.round((getWeldsCompleted(a.uniqueKey) / a.totalWelds) * 100) : 0}%; background: ${getProgressGradient(a.totalWelds > 0 ? Math.round((getWeldsCompleted(a.uniqueKey) / a.totalWelds) * 100) : 0)};"></div></div>
                </div>` : ''}
        </div>`;
}

function attachEventListeners() {
    document.querySelectorAll('.btn-control').forEach(btn => {
        btn.onclick = (e) => {
            const k = e.currentTarget.getAttribute('data-key');
            const act = e.currentTarget.getAttribute('data-action');
            if (act === 'increment') incrementProgress(k);
            else if (act === 'decrement') decrementProgress(k);
            else if (act === 'welds-increment') incrementWelds(k);
            else if (act === 'welds-decrement') decrementWelds(k);
        };
    });
}

function previousRecord() { if (currentRecordIndex > 0) { currentRecordIndex = Math.max(0, currentRecordIndex - itemsPerPage); renderActivities(); } }
function nextRecord() { const total = createActivityHierarchy(filterActivities()).length; if (currentRecordIndex + itemsPerPage < total) { currentRecordIndex += itemsPerPage; renderActivities(); } }
function updateRecordNavigator(start, end, total) {
    const el = document.getElementById('recordInfo'); if (!el) return;
    const p = document.getElementById('prevRecord'); const n = document.getElementById('nextRecord');
    if (total === 0) { el.textContent = 'NENHUM REGISTRO'; if (p) p.disabled = true; if (n) n.disabled = true; }
    else { el.textContent = `REGISTROS ${start}-${end} de ${total}`; if (p) p.disabled = start <= 1; if (n) n.disabled = end >= total; }
}

// Tab management
function showActivitiesTab() { document.getElementById('activitiesTab').classList.add('active'); document.getElementById('sCurveTab').classList.remove('active'); document.getElementById('activitiesTabContent').classList.remove('hidden'); document.getElementById('sCurveTabContent').classList.add('hidden'); }
function showSCurveTab() { document.getElementById('activitiesTab').classList.remove('active'); document.getElementById('sCurveTab').classList.add('active'); document.getElementById('activitiesTabContent').classList.add('hidden'); document.getElementById('sCurveTabContent').classList.remove('hidden'); renderSCurve(); }

// S-Curve
function calculateSCurveData() {
    if (activities.length === 0) return { dates: [], planned: [], real: [] };
    let min = null; let max = null;
    activities.forEach(a => {
        const s = parseDateSimple(a.startDate); const e = parseDateSimple(a.endDate);
        if (!min || s < min) min = s; if (!max || e > max) max = e;
    });
    if (!min || !max) return { dates: [], planned: [], real: [] };
    const dates = []; const planned = []; const real = []; let cur = new Date(min);
    while (cur <= max) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    dates.forEach(d => {
        let pSum = 0; let rSum = 0;
        activities.forEach(a => {
            const s = parseDateSimple(a.startDate); const e = parseDateSimple(a.endDate);
            if (d >= e) pSum++; else if (d >= s) pSum += (d - s) / (e - s);
            rSum += getProgress(a.uniqueKey) / 100;
        });
        planned.push((pSum / activities.length) * 100); real.push((rSum / activities.length) * 100);
    });
    return { dates, planned, real };
}
function parseDateSimple(s) { const p = s.split('/'); return p.length === 3 ? new Date(p[2], p[1] - 1, p[0]) : new Date(); }

function renderSCurve() {
    const canv = document.getElementById('sCurveChart'); if (!canv) return;
    const { dates, planned, real } = calculateSCurveData(); if (dates.length === 0) return;
    const labs = dates.map(d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (sCurveChart) sCurveChart.destroy();
    sCurveChart = new Chart(canv.getContext('2d'), {
        type: 'line', data: {
            labels: labs, datasets: [
                { label: 'Planejado', data: planned, borderColor: '#3b82f6', tension: 0.4, fill: true, backgroundColor: 'rgba(59, 130, 246, 0.1)' },
                { label: 'Real', data: real, borderColor: '#10b981', tension: 0.4, fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)' }
            ]
        }, options: { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } } }
    });
}

// Auth handlers
async function handleLogin() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const errorMsg = document.getElementById('errorMessage');
    if (!email || !password) { errorMsg.textContent = 'Preencha email e senha.'; errorMsg.classList.add('show'); return; }
    errorMsg.classList.remove('show');
    const result = await loginUser(email, password);
    if (!result.success) {
        errorMsg.textContent = result.error === 'pending-approval' ? '⏳ Sua conta está aguardando aprovação.' : getErrorMessage(result.error);
        errorMsg.classList.add('show');
    }
}
async function handleRegister() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const errorMsg = document.getElementById('errorMessage');
    if (!email || !password || password.length < 6) { errorMsg.textContent = 'Dados inválidos ou senha curta.'; errorMsg.classList.add('show'); return; }
    errorMsg.classList.remove('show');
    const result = await registerUser(email, password);
    if (!result.success) { errorMsg.textContent = getErrorMessage(result.error); errorMsg.classList.add('show'); }
    else if (result.needsApproval) {
        errorMsg.textContent = '✅ Conta criada! Aguarde aprovação.';
        errorMsg.style.color = '#10b981'; errorMsg.classList.add('show');
    }
}
async function handleLogout() { if (confirm('Deseja realmente sair?')) await logoutUser(); }
function getErrorMessage(e) {
    if (e.includes('user-not-found') || e.includes('wrong-password')) return 'Email ou senha incorretos.';
    if (e.includes('email-already-in-use')) return 'Este email já está cadastrado.';
    return 'Erro: ' + e;
}

// Admin panel
async function openAdminPanel() { document.getElementById('adminModal').classList.add('show'); await loadPendingUsers(); }
function closeAdminPanel() { document.getElementById('adminModal').classList.remove('show'); }
async function loadPendingUsers() {
    const list = document.getElementById('pendingUsersList'); if (!list) return;
    list.innerHTML = 'Carregando...';
    try {
        const users = await getPendingUsers();
        if (users.length === 0) { list.innerHTML = '✅ Nenhum usuário pendente'; return; }
        list.innerHTML = users.map(u => `
            <div class="pending-user-item">
                <div class="user-info"><div>📧 ${u.email}</div></div>
                <div class="user-actions">
                    <button onclick="approveUserFromPanel('${u.uid}')">✅ Aprovar</button>
                    <button onclick="rejectUserFromPanel('${u.uid}')">❌ Rejeitar</button>
                </div>
            </div>`).join('');
    } catch (e) { list.innerHTML = 'Erro: ' + e.message; }
}
async function approveUserFromPanel(uid) { if (confirm('Aprovar usuário?')) { await approveUser(uid); alert('✅ Aprovado!'); await loadPendingUsers(); } }
async function rejectUserFromPanel(uid) { if (confirm('Rejeitar usuário?')) { await rejectUser(uid); alert('✅ Rejeitado!'); await loadPendingUsers(); } }

// Manual Activities
function openAddActivityModal() {
    const pw = prompt("Senha admin:");
    if (pw === "789512") {
        document.getElementById('addActivityModal').classList.add('show');
        document.getElementById('modalTitle').textContent = "➕ Novo Registro Manual";
        document.getElementById('editingUniqueKey').value = "";
        document.getElementById('addActivityForm').reset();
    } else if (pw !== null) alert("❌ Senha incorreta!");
}
function closeAddActivityModal() { document.getElementById('addActivityModal').classList.remove('show'); }
function editActivity(key) {
    const pw = prompt("Senha admin:");
    if (pw !== "789512") { if (pw !== null) alert("❌ Senha incorreta!"); return; }
    const a = activities.find(x => x.uniqueKey === key); if (!a) return;
    document.getElementById('addActivityModal').classList.add('show');
    document.getElementById('modalTitle').textContent = "✏️ Editar Registro";
    document.getElementById('editingUniqueKey').value = key;
    document.getElementById('manualId').value = a.id || '';
    document.getElementById('manualName').value = a.name || '';
    document.getElementById('manualStart').value = a.startDate || '';
    document.getElementById('manualEnd').value = a.endDate || '';
    document.getElementById('manualDuration').value = a.calendar || '';
    document.getElementById('manualCritical').value = (a.critical || 'NÃO').toUpperCase().trim() === 'SIM' ? 'SIM' : 'NÃO';
    document.getElementById('manualSummary').value = (a.summary || 'NÃO').toUpperCase().trim() === 'SIM' ? 'SIM' : 'NÃO';
    if (typeof weldsData !== 'undefined' && weldsData[key]) document.getElementById('manualTotalWelds').value = weldsData[key].total || '';
}
async function deleteActivity(key) {
    const pw = prompt("Senha admin:");
    if (pw !== "789512") { if (pw !== null) alert("❌ Senha incorreta!"); return; }
    if (!confirm("Excluir permanentemente?")) return;
    const i = activities.findIndex(x => x.uniqueKey === key);
    if (i !== -1) {
        activities.splice(i, 1); saveActivities(); renderActivities(); alert("🗑️ Excluído!");
    }
}
async function saveManualActivity() {
    const key = document.getElementById('editingUniqueKey').value;
    const id = document.getElementById('manualId').value.trim();
    const name = document.getElementById('manualName').value.trim();
    const start = document.getElementById('manualStart').value.trim();
    const end = document.getElementById('manualEnd').value.trim();
    const dur = document.getElementById('manualDuration').value.trim();
    const tw = document.getElementById('manualTotalWelds').value;
    const crit = document.getElementById('manualCritical').value;
    const sum = document.getElementById('manualSummary').value;

    if (!id || !name || !start || !end) { alert("Campos obrigatórios!"); return; }

    if (key) {
        const a = activities.find(x => x.uniqueKey === key);
        if (a) {
            Object.assign(a, { id, name, startDate: start, endDate: end, calendar: dur || '-', critical: crit, summary: sum });
            if (tw && !isNaN(tw)) {
                a.hasWelds = true;
                a.totalWelds = parseInt(tw);
                if (!a.name.toLowerCase().includes('solda')) a.name += ` (${tw} SOLDAS)`;
            }
        }
    } else {
        const uk = generateUniqueKey(id, name);
        const newAct = { id, name, startDate: start, endDate: end, calendar: dur || '-', critical: crit, summary: sum, uniqueKey: uk, statusText: 'PROXIMO' };
        if (tw && !isNaN(tw)) {
            newAct.hasWelds = true;
            newAct.totalWelds = parseInt(tw);
            if (!newAct.name.toLowerCase().includes('solda')) newAct.name += ` (${tw} SOLDAS)`;
        }
        activities.push(newAct);
    }

    if (tw && !isNaN(tw)) setWeldsCompleted(key || generateUniqueKey(id, name), getWeldsCompleted(key || generateUniqueKey(id, name)), parseInt(tw));

    saveActivities(); closeAddActivityModal(); renderActivities(); alert("✅ Salvo!");
}

function exportToExcel() {
    if (activities.length === 0) {
        alert("Não há dados para exportar.");
        return;
    }

    const data = activities.map(a => {
        const p = getProgress(a.uniqueKey);
        const exp = calculateExpectedProgress(a);
        const weldsOk = getWeldsCompleted(a.uniqueKey);
        const weldsTotal = a.totalWelds || 0;
        const weldsPerc = weldsTotal > 0 ? Math.round((weldsOk / weldsTotal) * 100) : 0;

        return {
            "ID": a.id,
            "Nome da Tarefa": a.name,
            "Início": a.startDate,
            "Término": a.endDate,
            "Duração": a.calendar || a.duration || '',
            "% Real": `${p}%`,
            "% Previsto": `${exp}%`,
            "Soldas OK": weldsOk,
            "Soldas Total": weldsTotal,
            "Soldas %": `${weldsPerc}%`,
            "Crítica": a.critical || 'NÃO',
            "Status": a.statusText || ''
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Atividades");

    // Auto-size columns
    const max_width = data.reduce((w, r) => Math.max(w, ...Object.values(r).map(v => v.toString().length)), 10);
    worksheet["!cols"] = Object.keys(data[0]).map(() => ({ wch: max_width + 2 }));

    XLSX.writeFile(workbook, `Controle_Caldeira_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Global variables
let activities = [];
let progressData = {};
let weldsData = {}; // Track completed welds for activities with soldas
let currentRecordIndex = 0; // Index of currently displayed record
let itemsPerPage = 1; // Number of records to show at once (Changed to 1 for "Next/Prev" ID behavior)
let sCurveChart = null; // Chart.js instance for S-Curve
let isLoadingActivities = false; // Flag to prevent duplicate loads
let securityRecords = []; // Tracking security records separately
let mksRecords = []; // Tracking MKS records
let activeMKSDays = Array.from({ length: 31 }, (_, i) => i + 1); // Tracking active days configuration for MKS
let mksOpenedFromMain = false; // Flag for MKS navigation
let activeSecurityDays = Array.from({ length: 31 }, (_, i) => i + 1); // Moved from bottom to here for clarity
let currentViewMode = 'activities'; // 'activities' or 'rotina'

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Clear search field to prevent autocomplete - IMMEDIATE
    const searchField = document.getElementById('filterSearch');
    if (searchField) {
        searchField.value = '';

        // Remove readonly after a short delay to allow typing
        setTimeout(() => {
            searchField.removeAttribute('readonly');
        }, 50);

        // Also clear after delays to counter browser autocomplete
        setTimeout(() => { searchField.value = ''; }, 100);
        setTimeout(() => { searchField.value = ''; }, 300);
        setTimeout(() => { searchField.value = ''; }, 600);
        setTimeout(() => { searchField.value = ''; }, 1000);

        // Add input listener to prevent any programmatic filling
        searchField.addEventListener('input', (e) => {
            // If value contains '@' (likely an email), clear it
            if (e.target.value.includes('@') && !e.isTrusted) {
                e.target.value = '';
            }
        });
    }

    loadProgressData();
    loadWeldsData(); // Load welds tracking data
    loadActivities(); // Try to load saved activities first
    loadSecurityData(); // NEW: Load security records
    setupEventListeners();

    // FAIL-SAFE: Add specialized listener for security button
    const secBtn = document.getElementById('securityBtnMain');
    if (secBtn) {
        secBtn.addEventListener('click', (e) => {
            openSecurityModal();
        });
    }
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
    const filterDate = document.getElementById('filterDate');
    if (filterDate) {
        filterDate.addEventListener('change', () => {
            currentRecordIndex = 0;
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
            let infoChanged = false;
            // Migration for missing info
            if (activity.hasWelds === undefined || activity.totalWelds === undefined) {
                const weldsInfo = extractWeldsInfo(activity.name);
                activity.hasWelds = weldsInfo.hasWelds;
                activity.totalWelds = weldsInfo.totalWelds;
                infoChanged = true;
            }

            // Correction for 0 welds (Legacy data might have hasWelds=true for 0 welds)
            if (activity.hasWelds && (activity.totalWelds === 0 || !activity.totalWelds)) {
                activity.hasWelds = false;
                activity.totalWelds = 0;
                infoChanged = true;
            }

            if (infoChanged) needsUpdate = true;
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

// Helper to update Observation (Main Activity)
function updateObservation(key, val) {
    const a = activities.find(x => x.uniqueKey === key);
    if (a) {
        a.observation = val;
        saveActivities();
    }
}

// Helper to update Observation (MKS Group)
function updateMKSObservation(id, val) {
    let updated = false;
    mksRecords.forEach(r => {
        if (String(r.id) === String(id)) {
            r.observation = val;
            updated = true;
        }
    });
    if (updated && typeof saveMKSData === 'function') saveMKSData();
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
        status: getIndex(['STATUS', 'SITUACAO', 'ESTADO']),
        rotina: getIndex(['ROTINA', 'ROTINA?']),
        totalWelds: getIndex(['TOTAL SOLDAS', 'TOTAL DE SOLDAS', 'QTD SOLDAS', 'QUANTIDADE DE SOLDAS'])
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
            totalWelds: weldsInfo.totalWelds,
            rotina: 'NÃO' // Default for text import, can add mapping if needed later
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

                const routineCount = activities.filter(a => a.rotina && (a.rotina.toUpperCase().includes('SIM') || a.rotina.toUpperCase() === 'S')).length;
                alert(`✅ Arquivo Excel carregado com sucesso!\n\n${activities.length} atividades importadas.\n${routineCount} identificadas como ROTINA (não somam no total soldas).`);
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
    // Intelligent Header Search
    // scan the first 20 rows to find a row that contains "ID" and ("ATIVIDADE" or "NOME")
    for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
        const row = jsonData[i].map(c => String(c).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        const hasID = row.includes('ID');
        const hasName = row.some(c => c.includes('ATIVIDADE') || c.includes('NOME') || c.includes('TAREFA'));

        if (hasID && hasName) {
            headerRowIndex = i;
            headers = jsonData[i].map((h, index) => ({
                original: String(h).trim(),
                name: String(h).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
                index: index
            }));
            break;
        }
    }

    // Fallback: If not found, use first non-empty (legacy behavior)
    if (headers.length === 0) {
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
    }

    if (headers.length === 0) {
        alert("ERRO: Não foi possível encontrar a linha de cabeçalho no arquivo Excel.\nVerifique se há uma linha com 'ID' e 'ATIVIDADE' ou 'NOME'.\n\nConteúdo da primeira linha encontrada: " + JSON.stringify(jsonData[0] || []));
        return;
    }

    // DEBUG: Alert found headers
    const foundHeaders = headers.map(h => h.name);
    alert("Cabeçalhos detectados:\n" + foundHeaders.join(", "));

    activities = [];
    const getIndex = (possibleNames) => {
        for (const name of possibleNames) {
            const match = headers.find(h => h.name === name);
            if (match) return match.index;
        }
        return -1;
    };

    // DEBUG: Alert found headers to diagnose missing Total Soldas
    // const foundHeaders = headers.map(h => h.name);
    // console.log('Headers found:', foundHeaders); 


    const colMap = {
        id: getIndex(['ID']),
        activity: getIndex(['ATIVIDADE', 'NOME', 'TOPICO', 'NOME DA TAREFA']),
        summary: getIndex(['RESUMO', 'RESUMO?']),
        start: getIndex(['INICIO', 'INÍCIO', 'DATA DE INICIO', 'DATA_INICIO']),
        end: getIndex(['TERMINO', 'TÉRMINO', 'FIM', 'DATA DE FIM', 'DATA_FIM']),
        calendar: getIndex(['DURACAO', 'DURAÇÃO', 'CALENDARIO', 'HORAS']),
        progress: getIndex(['AVANCO', '% AVANCO', 'V AVANCO', '% CONCLUIDA']),
        status: getIndex(['STATUS', 'SITUACAO', 'ESTADO']),
        critical: getIndex(['CRITICA', 'CRÍTICA', 'CRITICAL']),
        rotina: getIndex(['ROTINA', 'ROTINA?']),
        totalWelds: getIndex(['TOTAL SOLDAS', 'TOTAL DE SOLDAS', 'QTD SOLDAS', 'QUANTIDADE DE SOLDAS'])
    };

    // DIAGNOSTIC ALERT
    if (colMap.totalWelds === -1) {
        const confirmOld = confirm("ATENÇÃO: Coluna 'TOTAL SOLDAS' não encontrada.\n\nO sistema tentará ler as soldas do NOME da atividade (ex: '(10 SOLDAS)').\n\nSe o seu arquivo TEM a coluna 'TOTAL SOLDAS', verifique se o nome está correto.\n\nDeseja continuar com o método antigo?");
        if (!confirmOld) return;
    } else {
        alert("OK: Coluna 'TOTAL SOLDAS' detectada! As soldas serão importadas desta coluna.");
    }

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

    let weldsUpdatedCount = 0;
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

        let finalHasWelds = false;
        let finalTotalWelds = 0;

        // Check if the "TOTAL SOLDAS" column exists in the file headers
        if (colMap.totalWelds !== -1) {
            const colTotalWelds = getVal(colMap.totalWelds);
            if (colTotalWelds && !isNaN(colTotalWelds)) {
                const parsed = parseInt(colTotalWelds);
                if (parsed > 0) {
                    finalHasWelds = true;
                    finalTotalWelds = parsed;
                }
            }
        }

        // Fallback: If column didn't provide valid data, check name extraction
        if (!finalHasWelds && weldsInfo.hasWelds) {
            finalHasWelds = true;
            finalTotalWelds = weldsInfo.totalWelds;
        }

        // WELDS OK LOGIC (NEW)
        if (finalHasWelds && finalTotalWelds > 0) {
            let completed = 0;
            // 1. Try explicit column
            if (colMap.weldsOk !== -1) {
                const valOk = getVal(colMap.weldsOk);
                if (valOk && !isNaN(valOk)) {
                    completed = parseInt(valOk);
                }
            }
            // 2. Fallback: Calculate from Progress if explicit column missing or empty
            else if (!isNaN(numericProgress) && numericProgress > 0) {
                completed = Math.round((numericProgress / 100) * finalTotalWelds);
            }

            // Validations
            if (completed > finalTotalWelds) completed = finalTotalWelds;

            // UPDATE GLOBAL WELDS DATA
            if (!weldsData[uniqueKey]) weldsData[uniqueKey] = {};
            weldsData[uniqueKey].total = finalTotalWelds;
            weldsData[uniqueKey].completed = completed;
            weldsUpdatedCount++;
        }

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
            hasWelds: finalHasWelds,
            totalWelds: finalTotalWelds,
            rotina: getVal(colMap.rotina) ? getVal(colMap.rotina).toUpperCase().trim() : 'NÃO'
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
    if (match) {
        const total = parseInt(match[1], 10);
        return { hasWelds: total > 0, totalWelds: total };
    }
    return { hasWelds: false, totalWelds: 0 };
}

// Load welds data
function loadWeldsData() {
    try {
        const saved = localStorage.getItem('caldeira_welds');
        if (saved) {
            weldsData = JSON.parse(saved);

            // MIGRATION: Convert old format to new format
            for (const key in weldsData) {
                const entry = weldsData[key];
                // If entry is a number (old format), convert to object
                if (typeof entry === 'number') {
                    weldsData[key] = { completed: entry, total: 0 };
                }
            }
        } else {
            weldsData = {}; // Ensure it's an empty object
        }
    } catch (e) {
        console.error('Erro ao carregar weldsData:', e);
        weldsData = {}; // Reset to empty on error
    }
}

// Save welds data
async function saveWeldsData() {
    try {
        // Always save to localStorage as backup
        localStorage.setItem('caldeira_welds', JSON.stringify(weldsData));

        // If logged in, also save to Firestore
        if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') {
            await db.collection('users').doc(currentUser.uid).set({
                weldsData: weldsData,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (e) {
        console.error('Erro ao salvar weldsData:', e);
    }
}

// Welds logic
function getWeldsCompleted(key) {
    if (!weldsData || typeof weldsData !== 'object') return 0;
    if (!weldsData[key]) return 0;

    // Handle different data structures
    const entry = weldsData[key];

    // If entry is a number directly (old format)
    if (typeof entry === 'number' && !isNaN(entry)) return entry;

    // If entry is an object with completed property (new format)
    if (typeof entry === 'object' && entry !== null) {
        const val = entry.completed;
        if (typeof val === 'number' && !isNaN(val)) return val;
    }

    // Default fallback
    return 0;
}
function setWeldsCompleted(key, val, total) {
    if (!weldsData[key]) weldsData[key] = {};
    weldsData[key].completed = Math.max(0, Math.min(total, val));
    weldsData[key].total = total;
    saveWeldsData();
}
function incrementWelds(key) {
    const a = activities.find(x => x.uniqueKey === key);
    if (a && a.hasWelds) {
        const cur = Number(getWeldsCompleted(key));
        const limit = Number(a.totalWelds);
        if (cur < limit) {
            setWeldsCompleted(key, cur + 1, limit);
            updateWeldsDisplay(key);
        }
    }
}
function decrementWelds(key) {
    const a = activities.find(x => x.uniqueKey === key);
    if (a && a.hasWelds) {
        const cur = Number(getWeldsCompleted(key));
        if (cur > 0) {
            setWeldsCompleted(key, cur - 1, Number(a.totalWelds));
            updateWeldsDisplay(key);
        }
    }
}
function updateWeldsDisplay(key) {
    const completed = Number(getWeldsCompleted(key)) || 0;
    const a = activities.find(x => x.uniqueKey === key);
    if (!a) return;

    const total = Number(a.totalWelds) || 0;
    const remaining = Math.max(0, total - completed);

    // Update ALL matching DOM elements
    document.querySelectorAll(`.activity-item[data-key="${key}"]`).forEach(item => {
        // Update RESTAM fields
        item.querySelectorAll('.welds-remaining-value, .welds-value').forEach(el => {
            el.textContent = String(remaining);
        });

        // Update FEITO fields
        item.querySelectorAll('.welds-done-value').forEach(el => {
            el.textContent = String(completed);
        });

        // Update progress bar
        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        const bar = item.querySelector('.progress-bar-row:first-child .progress-bar');
        const perc = item.querySelector('.progress-bar-row:first-child .progress-percentage');

        if (bar) {
            bar.style.width = `${progress}%`;
            bar.style.background = getProgressGradient(progress);
        }
        if (perc) perc.textContent = `${progress}%`;

        if (progress === 100) item.classList.add('completed');
        else item.classList.remove('completed');
    });

    updateSectionStats(a.id);
    updateStats();
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
    const dt = document.getElementById('filterDate')?.value; // YYYY-MM-DD

    return activities.filter(a => {
        if (s && !normalizeText(a.name).includes(s)) return false;
        if (id && a.id !== id) return false;

        // Date Filter
        if (dt) {
            // Activity Date Format: DD/MM/YYYY - HH:mm
            try {
                const parts = a.startDate.split(' - ')[0].split('/');
                if (parts.length === 3) {
                    // Convert to YYYY-MM-DD
                    const actDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    if (actDate !== dt) return false;
                }
            } catch (e) { }
        }

        // Rotina Filter
        const isRotina = (a.rotina || 'NÃO') === 'SIM';
        if (currentViewMode === 'activities' && isRotina) return false;
        if (currentViewMode === 'rotina' && !isRotina) return false;

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

        // Fix: If an ID has only 1 item, treat it as standalone regardless of its Summary status.
        // Fix: If an ID has only 1 item, treat it as standalone
        if (group.length === 1) {
            hierarchy.push({ type: 'standalone', id, activity: group[0] });
            return;
        }

        // Logic update: Ensure the FIRST item is ALWAYS the parent/header
        const parent = group[0];
        const children = group.slice(1);

        // We create a group with the first item as parent, and the rest as children
        hierarchy.push({ type: 'group', id, parent, children, others: [] });
    });
    return hierarchy;
}

// Stats

// Helper function to get the REAL progress of an activity (soldas ou manual)
function getRealProgress(activity) {
    if (activity.hasWelds && activity.totalWelds > 0) {
        // Progresso baseado em soldas
        return Math.round((getWeldsCompleted(activity.uniqueKey) / activity.totalWelds) * 100);
    }
    // Progresso manual
    return getProgress(activity.uniqueKey);
}

function calculateSectionProgress(list) {
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, a) => sum + getRealProgress(a), 0) / list.length);
}
function calculateStats() {
    // Determine which list to use based on View Mode
    let list = [];
    if (typeof currentViewMode !== 'undefined' && currentViewMode === 'rotina') {
        list = activities.filter(a => a.rotina && (String(a.rotina).toUpperCase().includes('SIM') || String(a.rotina).toUpperCase() === 'S'));
    } else {
        // Default (Activities) - Exclude Routine
        list = activities.filter(a => !(a.rotina && (String(a.rotina).toUpperCase().includes('SIM') || String(a.rotina).toUpperCase() === 'S')));
    }

    const t = list.length;
    // Count completed based on Real Progress
    const c = list.filter(a => getRealProgress(a) === 100).length;
    const crit = list.filter(a => (a.critical || '').toUpperCase().trim() === 'SIM').length;
    // Calculate overall progress
    const p = t > 0 ? Math.round(list.reduce((sum, a) => sum + getRealProgress(a) / 100, 0) / t * 100) : 0;

    // Welds stats - FORCE NUMERIC TYPES
    let totalWelds = 0;
    let completedWelds = 0;

    list.forEach(a => {
        if (a.hasWelds) {
            const tw = Number(a.totalWelds) || 0;
            const cw = Number(getWeldsCompleted(a.uniqueKey)) || 0;
            totalWelds += tw;
            completedWelds += cw;
        }
    });

    return {
        total: t,
        completed: c,
        critical: crit,
        overallProgress: p,
        totalWelds: Number(totalWelds) || 0,
        completedWelds: Number(completedWelds) || 0
    };
}
function updateStats() {
    const s = calculateStats();
    const tel = document.getElementById('totalActivities'); if (tel) tel.textContent = s.total;
    const cel = document.getElementById('completedActivities'); if (cel) cel.textContent = s.completed;
    const oel = document.getElementById('overallProgress'); if (oel) oel.textContent = `${s.overallProgress}%`;
    const crel = document.getElementById('criticalActivities'); if (crel) crel.textContent = s.critical;

    const wel = document.getElementById('totalWeldsStat');
    const welLabel = document.getElementById('weldStatsLabel');

    if (welLabel) {
        if (typeof currentViewMode !== 'undefined' && currentViewMode === 'rotina') {
            welLabel.textContent = 'SOLDAS ROTINA';
        } else {
            welLabel.textContent = 'SOLDAS FORNALHA';
        }
    }

    if (wel) {
        const totalW = Number(s.totalWelds) || 0;
        const completedW = Number(s.completedWelds) || 0;
        const perc = totalW > 0 ? Math.round((completedW / totalW) * 100) : 0;
        wel.textContent = `${completedW} / ${totalW} (${perc}%)`;
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
            const p = getRealProgress(a);
            const exp = calculateExpectedProgress(a);
            const crit = (a.critical || '').toUpperCase().trim() === 'SIM' ? '<span class="critical-indicator" style="display: inline-block; width: 10px; height: 10px; background: #ff0000; border-radius: 50%; margin-left: 8px; box-shadow: 0 0 10px #ff0000; animation: pulse 2s infinite;" title="Crítica"></span>' : '';
            sec.innerHTML = `
                <div class="section-header">
                    <div class="section-id">${a.id}</div>
                    <div class="section-title"><h2>${a.name}${crit}</h2><p>Individual</p></div>
                    <div class="section-stats">
                        <div class="section-progress" style="color: #ffffff;">${p}%</div>
                        <div class="section-count">${p === 100 ? 'Concluída' : 'Em andamento'}</div>
                        <div class="section-expected" style="color: #ffffff; opacity: 0.7; font-size: 0.85rem; margin-top: 0.25rem;">Previsto: ${exp}%</div>
                        <div class="section-actions" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
                            <button class="btn-control edit" onclick="editActivity('${a.uniqueKey}')" style="background: var(--warning); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Editar">✏️</button>
                            <button class="btn-control delete" onclick="deleteActivity('${a.uniqueKey}')" style="background: var(--danger); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Excluir">🗑️</button>
                        </div>
                    </div>
                </div>
                <div class="activities-list">${renderActivity(a, false)}</div>`;
        } else {
            // Calcular progresso médio do grupo (parent + children + others)
            const all = (group.parent ? [group.parent] : []).concat(group.children, group.others || []);
            const totalProgress = all.reduce((sum, activity) => sum + getRealProgress(activity), 0);
            const p = all.length > 0 ? Math.round(totalProgress / all.length) : 0;
            const comp = all.filter(x => getRealProgress(x) === 100).length;
            const title = group.parent ? group.parent.name : (group.children[0]?.name || 'Grupo');
            const crit = group.parent && (group.parent.critical || '').toUpperCase().trim() === 'SIM' ? '<span class="critical-indicator" style="display: inline-block; width: 10px; height: 10px; background: #ff0000; border-radius: 50%; margin-left: 8px; box-shadow: 0 0 10px #ff0000; animation: pulse 2s infinite;" title="Crítica"></span>' : '';
            const meta = group.parent ? `<div class="section-meta" style="display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);"><span>📅 ${group.parent.startDate} - ${group.parent.endDate}</span><span>⏱️ ${group.parent.calendar || '0 h'}</span></div>` : '';
            // Calcular progresso previsto para a seção
            const exp = group.parent ? calculateExpectedProgress(group.parent) : 0;
            sec.innerHTML = `
                <div class="section-header">
                    <div class="section-id">${group.id}</div>
                    <div class="section-title"><h2>${title}${crit}</h2><p>${group.parent ? 'Atividade com sub-tarefas' : 'Grupo'}</p>${meta}</div>
                    <div class="section-stats">
                        <div class="section-progress" style="color: #ffffff;">${p}%</div>
                        <!-- Count removed as requested -->
                        <div class="section-expected" style="color: #ffffff; opacity: 0.7; font-size: 0.85rem; margin-top: 0.25rem;">Previsto: ${exp}%</div>
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
        let [sd, sm, sy] = a.startDate.split('/').map(Number);
        let [ed, em, ey] = a.endDate.split('/').map(Number);

        // Normalize 2-digit years
        if (sy < 100) sy += 2000;
        if (ey < 100) ey += 2000;

        const s = new Date(sy, sm - 1, sd, 0, 0, 0); // Start of day
        const e = new Date(ey, em - 1, ed, 23, 59, 59, 999); // End of day
        const n = new Date(); // Now

        if (n < s) return 0;
        if (n > e) return 100;

        // Avoid division by zero
        const total = e - s;
        if (total <= 0) return 100;

        return Math.round(Math.min(100, Math.max(0, ((n - s) / total) * 100)));
    } catch (e) { return 0; }
}

function renderActivity(a, isChild = false) {
    // Se tiver soldas, usar progresso das soldas para a barra "Real", senão usar progresso manual
    let p, realProgress;
    if (a.hasWelds && a.totalWelds > 0) {
        // Progresso baseado em soldas
        realProgress = Math.round((getWeldsCompleted(a.uniqueKey) / a.totalWelds) * 100);
        p = realProgress;
    } else {
        // Progresso manual (setas)
        p = getProgress(a.uniqueKey);
        realProgress = p;
    }

    const exp = calculateExpectedProgress(a);
    const isComp = p === 100;
    const crit = (a.critical || '').toUpperCase().trim() === 'SIM' ? '<span class="critical-indicator" style="display: inline-block; width: 10px; height: 10px; background: #ff0000; border-radius: 50%; margin-left: 8px; box-shadow: 0 0 10px #ff0000; animation: pulse 2s infinite;" title="Crítica"></span>' : '';
    const hist = progressData[a.uniqueKey]?.history || [];
    const markers = hist.map(h => `<div class="timeline-marker" style="left: ${h.value}%" title="${h.value}% em ${new Date(h.timestamp).toLocaleDateString()}"></div>`).join('');

    return `
        <div class="activity-item ${isChild ? 'sub-activity' : ''} ${isComp ? 'completed' : ''}" data-key="${a.uniqueKey}" data-total="${a.totalWelds}">
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
                ${!a.hasWelds ? `
                <div class="controls">
                    <button class="btn-control decrement" data-key="${a.uniqueKey}" data-action="decrement">▼</button>
                    <button class="btn-control increment" data-key="${a.uniqueKey}" data-action="increment">▲</button>
                </div>` : ''}
                <div class="item-actions" style="display: flex; gap: 0.5rem; align-items: center; margin-left: ${a.hasWelds ? 'auto' : '1rem'};">
                    <button class="btn-control edit" onclick="editActivity('${a.uniqueKey}')" title="Editar" style="background: var(--warning); padding: 0.3rem; height: 32px; width: 32px;">✏️</button>
                    <button class="btn-control delete" onclick="deleteActivity('${a.uniqueKey}')" title="Excluir" style="background: var(--danger); padding: 0.3rem; height: 32px; width: 32px;">🗑️</button>
                </div>
            </div>
            ${!a.hasWelds ? `
            <div class="progress-bars-wrapper">
                <div class="progress-bar-row"><span class="progress-label">Real:</span><div class="progress-bar-container"><div class="progress-bar" style="width: ${realProgress}%; background: ${getProgressGradient(realProgress)};"></div></div><span class="progress-percentage">${realProgress}%</span></div>
                <div class="progress-bar-row"><span class="progress-label">Previsto:</span><div class="progress-bar-container"><div class="progress-bar expected" style="width: ${exp}%"></div></div><span class="progress-percentage">${exp}%</span></div>
            </div>` : ''}
            ${a.hasWelds ? `
                <div class="welds-control">
                    <div class="welds-header"><span class="welds-icon">🔧</span><span class="welds-label">SOLDAS FORNALHA:</span></div>
                    <div class="welds-controls-wrapper">
                        <button class="btn-control decrement" onclick="decrementWelds('${a.uniqueKey}')">▼</button>
                        
                        <!-- Restam Box -->
                        <div class="welds-box remaining" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); padding: 5px 10px; border-radius: 8px; text-align: center;">
                            <div style="font-size: 0.7rem; color: #fca5a5; text-transform: uppercase;">RESTAM</div>
                            <div class="welds-remaining-value" data-key="${a.uniqueKey}" style="font-size: 1.1rem; font-weight: 800; color: #fca5a5;">
                                ${Math.max(0, a.totalWelds - getWeldsCompleted(a.uniqueKey))}
                            </div>
                        </div>

                        <!-- Feito Box (New) -->
                        <div class="welds-box done" style="background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.3); padding: 5px 10px; border-radius: 8px; text-align: center;">
                            <div style="font-size: 0.7rem; color: #6ee7b7; text-transform: uppercase;">FEITO</div>
                            <div class="welds-done-value" data-key="${a.uniqueKey}" style="font-size: 1.1rem; font-weight: 800; color: #6ee7b7;">
                                ${getWeldsCompleted(a.uniqueKey)}
                            </div>
                        </div>

                        <!-- Total Box -->
                        <div class="welds-box total" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 5px 10px; border-radius: 8px; text-align: center;">
                            <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">TOTAL</div>
                            <div style="font-size: 1.1rem; font-weight: 800; color: #fff;">
                                ${a.totalWelds}
                            </div>
                        </div>

                        <button class="btn-control increment" onclick="incrementWelds('${a.uniqueKey}')">▲</button>
                    </div>
                </div>` : ''}
            
            <div class="observation-section" style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
                <textarea 
                    class="observation-input" 
                    placeholder="Observação..." 
                    style="width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 0.85rem; padding: 6px; border-radius: 4px; resize: vertical; min-height: 40px;"
                    onblur="updateObservation('${a.uniqueKey}', this.value)">${a.observation || ''}</textarea>
            </div>
        </div>`;
}

function attachEventListeners() {
    // Handle progress buttons (non-welds)
    document.querySelectorAll('.btn-control[data-action="increment"], .btn-control[data-action="decrement"]').forEach(btn => {
        btn.onclick = (e) => {
            const k = e.currentTarget.getAttribute('data-key');
            const act = e.currentTarget.getAttribute('data-action');
            if (act === 'increment') incrementProgress(k);
            else if (act === 'decrement') decrementProgress(k);
        };
    });

    // Handle welds buttons - DIRECT DOM UPDATE (PROVEN SOLUTION)
    document.querySelectorAll('button.btn-control').forEach(btn => {
        const isIncrement = btn.textContent.includes('▲');
        const isDecrement = btn.textContent.includes('▼');

        if (isIncrement || isDecrement) {
            btn.onclick = function (e) {
                e.stopPropagation();

                // Find parent container
                const container = this.closest('.welds-controls-wrapper') || this.closest('.welds-control');
                if (!container) return;

                // Find fields
                const feitoEl = container.querySelector('.welds-done-value');
                const restamEl = container.querySelector('.welds-remaining-value') || container.querySelector('.welds-value');
                const totalEl = container.querySelector('.welds-box.total div:last-child');

                if (!feitoEl || !restamEl || !totalEl) return;

                // Get current values
                let feito = parseInt(feitoEl.textContent) || 0;
                const total = parseInt(totalEl.textContent) || 0;

                // Increment or decrement
                if (isIncrement && feito < total) {
                    feito++;
                } else if (isDecrement && feito > 0) {
                    feito--;
                } else {
                    return; // No change needed
                }

                // Calculate remaining
                const restam = Math.max(0, total - feito);

                // UPDATE IMMEDIATELY - REAL-TIME
                feitoEl.textContent = feito;
                restamEl.textContent = restam;

                // Save to localStorage for persistence
                const key = this.closest('.activity-item')?.getAttribute('data-key');
                if (key) {
                    setWeldsCompleted(key, feito, total);
                    updateSectionStats(activities.find(x => x.uniqueKey === key)?.id);
                    updateStats();
                }
            };
        }
    });
}

function previousRecord() { if (currentRecordIndex > 0) { currentRecordIndex = Math.max(0, currentRecordIndex - itemsPerPage); renderActivities(); } }
function nextRecord() { const total = createActivityHierarchy(filterActivities()).length; if (currentRecordIndex + itemsPerPage < total) { currentRecordIndex += itemsPerPage; renderActivities(); } }
function updateRecordNavigator(start, end, total) {
    const el = document.getElementById('recordInfo');
    const floatEl = document.getElementById('floatRecordInfo');
    const floatNav = document.getElementById('floatingNavigator');
    const floatIn = document.getElementById('floatingInput');

    // Manage main navigator state
    const p = document.getElementById('prevRecord'); const n = document.getElementById('nextRecord');
    const fp = document.getElementById('floatPrev'); const fn = document.getElementById('floatNext');

    if (total === 0) {
        if (el) el.textContent = 'NENHUM REGISTRO';
        if (floatEl) floatEl.textContent = '0 / 0';
        if (p) p.disabled = true; if (n) n.disabled = true;
        if (fp) fp.disabled = true; if (fn) fn.disabled = true;
    } else {
        // If showing 1 item per page, show "ID X / Y", else "X-Y / Total"
        const isSingle = itemsPerPage === 1;
        const current = Math.floor(start / itemsPerPage) + (start % itemsPerPage > 0 ? 1 : 0); // Approx page logic
        // Actually start/end are indices + 1.
        // If itemsPerPage=1, start=1, end=1 -> "1 / Total"
        // If itemsPerPage=1, start=2, end=2 -> "2 / Total"

        const txt = isSingle ? `ID ${start} de ${total}` : `REGISTROS ${start}-${end} de ${total}`;
        const floatTxt = isSingle ? `${start} / ${total}` : `${start}-${end} / ${total}`;

        if (el) el.textContent = txt;
        if (floatEl) floatEl.textContent = floatTxt;

        const isFirst = start <= 1;
        const isLast = end >= total;

        if (p) p.disabled = isFirst; if (n) n.disabled = isLast;
        if (fp) fp.disabled = isFirst; if (fn) fn.disabled = isLast;
    }

    // Show floating navigator if there are records
    if (floatNav) {
        floatNav.style.display = total > 0 ? 'flex' : 'none';
        // Hide if admin modal is open? Handled by z-index if needed
    }
}

// Tab management
function showActivitiesTab() {
    currentViewMode = 'activities';
    document.getElementById('activitiesTabContent').style.display = 'block';
    document.getElementById('sCurveTabContent').style.display = 'none';
    document.getElementById('weldClustersTabContent').style.display = 'none';
    document.getElementById('activitiesTab').classList.add('active');
    document.getElementById('rotinaTab').classList.remove('active');
    document.getElementById('sCurveTab').classList.remove('active');
    document.getElementById('weldClustersTab').classList.remove('active');
    currentRecordIndex = 0;
    renderActivities();
}

function showRotinaTab() {
    currentViewMode = 'rotina';
    document.getElementById('activitiesTabContent').style.display = 'block'; // Uses the same content container
    document.getElementById('sCurveTabContent').style.display = 'none';
    document.getElementById('weldClustersTabContent').style.display = 'none';
    document.getElementById('activitiesTab').classList.remove('active');
    document.getElementById('rotinaTab').classList.add('active');
    document.getElementById('sCurveTab').classList.remove('active');
    document.getElementById('weldClustersTab').classList.remove('active');
    currentRecordIndex = 0;
    renderActivities();
}

function showSCurveTab() {
    document.getElementById('activitiesTabContent').style.display = 'none';
    document.getElementById('sCurveTabContent').style.display = 'block';
    document.getElementById('weldClustersTabContent').style.display = 'none';
    document.getElementById('activitiesTab').classList.remove('active');
    document.getElementById('sCurveTab').classList.add('active');
    document.getElementById('rotinaTab').classList.remove('active');
    document.getElementById('weldClustersTab').classList.remove('active');
    setTimeout(renderSCurve, 100);
}

function showWeldClustersTab() {
    document.getElementById('activitiesTabContent').style.display = 'none';
    document.getElementById('sCurveTabContent').style.display = 'none';
    document.getElementById('weldClustersTabContent').style.display = 'block';
    document.getElementById('activitiesTab').classList.remove('active');
    document.getElementById('sCurveTab').classList.remove('active');
    document.getElementById('weldClustersTab').classList.add('active');
    document.getElementById('weldClustersTab').classList.add('active');
    document.getElementById('rotinaTab').classList.remove('active');
    setTimeout(renderWeldClusters, 100);
}

// Weld Clusters
window.weldClusterMode = 'activities'; // Default

function setWeldClusterMode(mode) {
    window.weldClusterMode = mode;

    // Update UI buttons
    const actBtn = document.getElementById('weldClusterActBtn');
    const rotBtn = document.getElementById('weldClusterRotBtn');

    if (mode === 'rotina') {
        if (actBtn) actBtn.classList.remove('active');
        if (rotBtn) rotBtn.classList.add('active');
    } else {
        if (actBtn) actBtn.classList.add('active');
        if (rotBtn) rotBtn.classList.remove('active');
    }

    renderWeldClusters();
}

function renderWeldClusters() {
    const container = document.getElementById('weldClustersContainer');
    if (!container) return;

    // Calculate totals
    let totalWelds = 0;
    let completedWelds = 0;

    // Use stored welds data to be precise
    // Use stored welds data to be precise
    activities.forEach(a => {
        const isRoutine = a.rotina && (String(a.rotina).toUpperCase().includes('SIM') || String(a.rotina).toUpperCase() === 'S');

        let shouldInclude = false;
        if (window.weldClusterMode === 'rotina') {
            shouldInclude = isRoutine;
        } else {
            shouldInclude = !isRoutine;
        }

        if (a.hasWelds && shouldInclude) {
            const rawTotal = a.totalWelds;
            const t = parseInt(rawTotal);
            totalWelds += isNaN(t) ? 0 : t;

            const rawComp = getWeldsCompleted(a.uniqueKey);
            const c = parseInt(rawComp); // Double safety
            completedWelds += isNaN(c) ? 0 : c;
        }
    });

    // Update stats
    const totalEl = document.getElementById('clusterTotalWelds');
    const compEl = document.getElementById('clusterCompletedWelds');
    const progEl = document.getElementById('clusterProgress');

    if (totalEl) totalEl.textContent = totalWelds;
    if (compEl) compEl.textContent = completedWelds;
    if (progEl) {
        const p = totalWelds > 0 ? Math.round((completedWelds / totalWelds) * 100) : 0;
        progEl.textContent = `${p}%`;
    }

    // Generate Grid
    // Optimization: if simple total is enough, we just render boxes.
    // Order: Render all completed first? Or mixed by activity? 
    // "Cluster" usually implies contiguous blocks of memory. 
    // Let's render them linearly: first all completed, then pending? 
    // OR render them representing the actual state. Since we don't have "which exact weld is done", only "count", 
    // visual representation of "X completed out of Y total" is best represented as filled cells first.

    let html = '';
    // Render completed welds
    for (let i = 0; i < completedWelds; i++) {
        html += '<div class="weld-cluster completed" title="Solda Concluída"></div>';
    }
    // Render pending welds
    const pending = totalWelds - completedWelds;
    for (let i = 0; i < pending; i++) {
        html += '<div class="weld-cluster" title="Solda Pendente"></div>';
    }

    if (totalWelds === 0) {
        html = '<div style="color: var(--text-secondary); padding: 2rem;">Nenhuma atividade com soldas encontrada.</div>';
    }

    container.innerHTML = html;
}

// S-Curve
window.sCurveMode = 'activities'; // Default

function setSCurveMode(mode) {
    window.sCurveMode = mode;

    const actBtn = document.getElementById('sCurveActBtn');
    const rotBtn = document.getElementById('sCurveRotBtn');

    if (mode === 'rotina') {
        if (actBtn) actBtn.classList.remove('active');
        if (rotBtn) rotBtn.classList.add('active');
    } else {
        if (actBtn) actBtn.classList.add('active');
        if (rotBtn) rotBtn.classList.remove('active');
    }

    renderSCurve();
}

function calculateSCurveData() {
    // Filter list based on mode
    let list = [];
    if (window.sCurveMode === 'rotina') {
        list = activities.filter(a => a.rotina && (String(a.rotina).toUpperCase().includes('SIM') || String(a.rotina).toUpperCase() === 'S'));
    } else {
        list = activities.filter(a => !(a.rotina && (String(a.rotina).toUpperCase().includes('SIM') || String(a.rotina).toUpperCase() === 'S')));
    }

    if (list.length === 0) return { dates: [], planned: [], real: [] };
    let min = null; let max = null;
    list.forEach(a => {
        const s = parseDateSimple(a.startDate); const e = parseDateSimple(a.endDate);
        if (!min || s < min) min = s; if (!max || e > max) max = e;
    });
    if (!min || !max) return { dates: [], planned: [], real: [] };
    const dates = []; const planned = []; const real = []; let cur = new Date(min);
    while (cur <= max) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    dates.forEach(d => {
        let pSum = 0; let rSum = 0;
        list.forEach(a => {
            const s = parseDateSimple(a.startDate); const e = parseDateSimple(a.endDate);
            if (d >= e) pSum++; else if (d >= s) pSum += (d - s) / (e - s);
            rSum += getProgress(a.uniqueKey) / 100;
        });
        planned.push((pSum / list.length) * 100); real.push((rSum / list.length) * 100);
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
    document.getElementById('manualRotina').value = (a.rotina || 'NÃO').toUpperCase().trim() === 'SIM' ? 'SIM' : 'NÃO';
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
    const rot = document.getElementById('manualRotina').value;

    if (!id || !name || !start || !end) { alert("Campos obrigatórios!"); return; }

    if (key) {
        const a = activities.find(x => x.uniqueKey === key);
        if (a) {
            Object.assign(a, { id, name, startDate: start, endDate: end, calendar: dur || '-', critical: crit, summary: sum, rotina: rot });
            if (tw && !isNaN(tw) && parseInt(tw) > 0) {
                a.hasWelds = true;
                a.totalWelds = parseInt(tw);
                if (!a.name.toLowerCase().includes('solda')) a.name += ` (${tw} SOLDAS)`;
            } else {
                a.hasWelds = false;
                a.totalWelds = 0;
            }
        }
    } else {
        const uk = generateUniqueKey(id, name);
        const newAct = { id, name, startDate: start, endDate: end, calendar: dur || '-', critical: crit, summary: sum, rotina: rot, uniqueKey: uk, statusText: 'PROXIMO' };
        if (tw && !isNaN(tw) && parseInt(tw) > 0) {
            newAct.hasWelds = true;
            newAct.totalWelds = parseInt(tw);
            if (!newAct.name.toLowerCase().includes('solda')) newAct.name += ` (${tw} SOLDAS)`;
        } else {
            newAct.hasWelds = false;
            newAct.totalWelds = 0;
        }
        activities.push(newAct);
    }

    if (tw && !isNaN(tw)) setWeldsCompleted(key || generateUniqueKey(id, name), getWeldsCompleted(key || generateUniqueKey(id, name)), parseInt(tw));

    saveActivities(); closeAddActivityModal(); renderActivities(); alert("✅ Salvo!");
}

// Custom Clear Data Modal Logic
function openClearDataModal() {
    document.getElementById('clearDataModal').classList.add('show');
    document.getElementById('clearDataPassword').value = '';
    document.getElementById('clearDataPassword').focus();
}

function closeClearDataModal() {
    document.getElementById('clearDataModal').classList.remove('show');
}

function confirmClearData() {
    const pw = document.getElementById('clearDataPassword').value;

    if (pw !== "789512") {
        alert("❌ Senha incorreta!");
        return;
    }

    // Clear Memory
    activities = [];
    weldsData = {};
    progressData = {};
    currentRecordIndex = 0;

    // Clear Storage
    localStorage.removeItem('caldeira_activities');
    localStorage.removeItem('atividades_caldeira');
    localStorage.removeItem('caldeira_welds');
    localStorage.removeItem('caldeira_progress');

    // MKS & Security Data
    // securityRecords = [];
    // localStorage.removeItem('caldeira_security');

    // Save state
    saveActivities();
    saveWeldsData();

    // Update UI
    renderActivities();
    updateStats();
    closeClearDataModal();

    alert("✅ Todos os dados de atividades foram apagados!");
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
            "Soldas Total": weldsTotal, // Legacy, can keep or remove if redundant
            "Soldas %": `${weldsPerc}%`,
            "Crítica": a.critical || 'NÃO',
            "Status": a.statusText || '',
            "Rotina": a.rotina || 'NÃO',
            "TOTAL SOLDAS": a.totalWelds || '' // New column request
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

// ====== SECURITY CONTROL MODULE ======

async function loadSecurityData() {
    // Try localStorage first
    const saved = localStorage.getItem('caldeira_security');
    if (saved) {
        securityRecords = JSON.parse(saved);
        renderSecurityList();
    }

    // Then Firestore if logged in
    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            const doc = await db.collection('shared_data').doc('security').get();
            if (doc.exists && doc.data().records) {
                securityRecords = doc.data().records;
                localStorage.setItem('caldeira_security', JSON.stringify(securityRecords));
                renderSecurityList();
            }
        } catch (e) {
            console.error("Error loading security data:", e);
        }
    }
}

// Real-time listener for Security Data
function setupSecurityListener() {
    if (typeof currentUser === 'undefined' || !currentUser) return;

    // Listen for Records
    db.collection('shared_data').doc('security')
        .onSnapshot((doc) => {
            if (doc.exists && doc.data().records) {
                // Determine if we need to update
                // Simple check: compare JSON strings or timestamps
                // For now, always update to be safe
                securityRecords = doc.data().records;
                renderSecurityList();
                // Update config too if present
                if (doc.data().config) {
                    activeSecurityDays = doc.data().config.activeDays || [];
                    renderSecurityTableHeaders();
                    renderSecurityList(); // Re-render to show/hide columns
                }
            }
        }, (error) => {
            console.error("Error listening to security updates:", error);
        });
}

async function saveSecurityData() {
    // Optimistic update locally
    localStorage.setItem('caldeira_security', JSON.stringify(securityRecords));

    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            await db.collection('shared_data').doc('security').set({
                records: securityRecords,
                config: { activeDays: activeSecurityDays }, // Include config in save
                lastUpdated: new Date().toISOString()
            }, { merge: true }); // Merge to strictly update provided fields
        } catch (e) {
            console.error("Error saving security data:", e);
        }
    }
}

function openSecurityModal() {
    console.log("Opening Security Modal...");
    const modal = document.getElementById('securityModal');
    if (!modal) {
        console.error("ERRO: Elemento 'securityModal' não encontrado!");
        alert("Erro técnico: Janela de segurança não encontrada no HTML.");
        return;
    }
    modal.classList.add('show');
    renderSecurityList();
}



function openSecurityFormModal(id = null) {
    if (prompt('Senha admin:') !== '789512') return;

    document.getElementById('securityFormModal').classList.add('show');
    document.getElementById('securityEditId').value = id || '';

    // Generate dynamic day inputs (Previsto/Real)
    const grid = document.getElementById('securityDaysGrid');
    if (grid) {
        grid.innerHTML = '';
        activeSecurityDays.forEach(i => {
            grid.innerHTML += `
                <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #bfdbfe; padding: 4px; border-radius: 6px; background: #fff;">
                    <span style="font-size: 0.9rem; font-weight: 800; color: #1e3a8a; margin-bottom: 3px;">Dia ${i}</span>
                    <div style="display: flex; gap: 4px;">
                        <input type="text" id="secDay${i}_P" placeholder="P" class="day-input" 
                            style="width: 45px; text-align: center; border: 1px solid #93c5fd; font-size: 0.9rem; font-weight: 600; background: #eff6ff; color: #1e40af; border-radius: 4px; padding: 2px;" 
                            title="Previsto (%)" oninput="formatPercentInput(this)" onblur="blurPercentInput(this)" onfocus="focusPercentInput(this)">
                        <input type="text" id="secDay${i}_R" placeholder="R" class="day-input" 
                            style="width: 45px; text-align: center; border: 1px solid #86efac; font-size: 0.9rem; font-weight: 600; background: #f0fdf4; color: #166534; border-radius: 4px; padding: 2px;" 
                            title="Realizado (%)" oninput="formatPercentInput(this)" onblur="blurPercentInput(this)" onfocus="focusPercentInput(this)">
                    </div>
                </div>
            `;
        });
    }

    if (id) {
        document.getElementById('securityFormTitle').textContent = '🛡️ Editar Registro de Segurança';
        const record = securityRecords.find(r => r.id === id);
        if (record) {
            document.getElementById('secAtividade').value = record.atividade || '';
            document.getElementById('secTH').value = record.th || 'SIM';
            document.getElementById('secTurno').value = record.turno || 'M';
            document.getElementById('secContratado').value = record.contratado || '';
            document.getElementById('secSolicitante').value = record.solicitante || '';
            document.getElementById('secResponsavel').value = record.responsavel || '';
            document.getElementById('secObservacao').value = record.observacao || '';

            // Populate days (P and R)
            activeSecurityDays.forEach(i => {
                const elP = document.getElementById(`secDay${i}_P`);
                const elR = document.getElementById(`secDay${i}_R`);
                if (elP) elP.value = record[`day${i}_P`] || '';
                if (elR) elR.value = record[`day${i}_R`] || '';
            });
        }
    } else {
        document.getElementById('securityFormTitle').textContent = '🛡️ Novo Registro de Segurança';
        // Clear main inputs
        const mainInputs = ['secAtividade', 'secContratado', 'secSolicitante', 'secResponsavel', 'secObservacao'];
        mainInputs.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

        document.getElementById('secTH').value = 'SIM';
        document.getElementById('secTurno').value = 'M';
    }
}

function closeSecurityFormModal() {
    document.getElementById('securityFormModal').classList.remove('show');
}

function saveSecurityRecord() {
    const editId = document.getElementById('securityEditId').value;
    const record = {
        atividade: document.getElementById('secAtividade').value,
        th: document.getElementById('secTH').value,
        turno: document.getElementById('secTurno').value,
        contratado: document.getElementById('secContratado').value,
        solicitante: document.getElementById('secSolicitante').value,
        responsavel: document.getElementById('secResponsavel').value,
        observacao: document.getElementById('secObservacao').value,
    };

    // Collect days 1-31 (Previsto and Real)
    for (let i = 1; i <= 31; i++) {
        const valP = document.getElementById(`secDay${i}_P`)?.value;
        const valR = document.getElementById(`secDay${i}_R`)?.value;
        if (valP) record[`day${i}_P`] = valP;
        if (valR) record[`day${i}_R`] = valR;
    }

    if (editId) {
        const index = securityRecords.findIndex(r => r.id == editId);
        if (index !== -1) {
            record.id = parseInt(editId);
            securityRecords[index] = record;
        }
    } else {
        const maxId = securityRecords.reduce((max, r) => Math.max(max, r.id || 0), 0);
        record.id = maxId + 1;
        securityRecords.push(record);
    }

    saveSecurityData();
    renderSecurityList();
    closeSecurityFormModal();
    alert('✅ Registro salvo!');
}

function deleteSecurityRecord(id) {
    if (prompt('Senha admin:') !== '789512') return;
    if (!confirm('Deseja excluir este registro de segurança?')) return;

    securityRecords = securityRecords.filter(r => r.id != id);
    saveSecurityData();
    renderSecurityList();
}

function clearSecurityData() {
    const pw = prompt('Senha admin para LIMPAR TUDO:');
    if (pw !== '789512') {
        if (pw !== null) alert("❌ Senha incorreta!");
        return;
    }

    if (!confirm('ATENÇÃO: Isso apagará TODOS os registros de segurança permanentemente. Confirmar?')) return;

    securityRecords = [];
    saveSecurityData();
    renderSecurityList();
    alert('✅ Todos os registros de segurança foram apagados.');
}

function renderSecurityList() {
    const tbody = document.getElementById('securityTableBody');
    if (!tbody) return;

    tbody.innerHTML = securityRecords.map(r => {
        // Generate day cells (Previsto and Real)
        let dayCells = '';
        activeSecurityDays.forEach(i => {
            let valP = r[`day${i}_P`] || '';
            let valR = r[`day${i}_R`] || '';
            // Ensure value has % if it's a number
            if (valP && !String(valP).includes('%')) valP += '%';
            if (valR && !String(valR).includes('%')) valR += '%';

            dayCells += `
                <td class="day-cell sub-cell-p" style="min-width: 40px; text-align: center; border-left: 1px solid #ddd; background: #f0f9ff; color: #0c4a6e !important; font-weight: bold;">${valP}</td>
                <td class="day-cell sub-cell-r" style="min-width: 40px; text-align: center; border-left: 1px solid #eee; background: #f0fdf4; color: #14532d !important; font-weight: bold;">${valR}</td>
            `;
        });

        return `
        <tr>
            <td data-label="ID"><strong>${r.id}</strong></td>
            <td data-label="Atividade">${r.atividade || '-'}</td>
            <td data-label="TH"><span class="badge" style="background: ${r.th === 'SIM' ? 'var(--danger)' : 'var(--success)'}; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">${r.th}</span></td>
            <td data-label="Turno">${r.turno || '-'}</td>
            <td data-label="Contratado/Substituído">${r.contratado || '-'}</td>
            <td data-label="Solicitante">${r.solicitante || '-'}</td>
            <td data-label="Responsável">${r.responsavel || '-'}</td>
            <td data-label="Observação"><div style="max-height: 50px; overflow: hidden; text-overflow: ellipsis; font-size: 0.8rem;">${r.observacao || '-'}</div></td>
            ${dayCells}
            <td data-label="Ações" style="text-align: center;">
                <div style="display: flex; gap: 0.3rem; justify-content: center;">
                    <button class="btn-control edit" onclick="openSecurityFormModal(${r.id})" style="background: var(--warning); padding: 5px; height: 30px; width: 30px;">✏️</button>
                    <button class="btn-control delete" onclick="deleteSecurityRecord(${r.id})" style="background: var(--danger); padding: 5px; height: 30px; width: 30px;">🗑️</button>
                </div>
            </td>
        </tr>
    `}).join('');
}

function handleSecurityExcelUpload(event) {
    if (prompt('Senha admin:') !== '789512') return;

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        try {
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet);

            // Map Excel columns to our fields with case-insensitive support
            let nextId = securityRecords.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
            const imported = jsonData.map((row) => {
                const getVal = (possibleKeys) => {
                    const foundKey = Object.keys(row).find(k =>
                        possibleKeys.some(pk => k.trim().toUpperCase() === pk.toUpperCase())
                    );
                    return foundKey ? row[foundKey] : '';
                };

                const securityBaseId = securityRecords.reduce((max, r) => Math.max(max, r.id || 0), 0);

                // Parse TH: handle S/N, SIM/NAO
                let thVal = String(getVal(['TH', 'STATUS'])).toUpperCase();
                let thFinal = 'NÃO';
                if (thVal.includes('S') || thVal.includes('SIM')) thFinal = 'SIM';

                const record = {
                    id: nextId++,
                    atividade: getVal(['Atividade', 'ATIVIDADE', 'Tarefa', 'Tarefa', 'DESCRIÇÃO']),
                    th: thFinal,
                    turno: getVal(['TURNO', 'Turno']) || 'M',
                    contratado: getVal(['Contratado/Substituído', 'CONTRATADO/SUBSTITUÍDO', 'Contratado', 'Substituído', 'Substituto', 'Nome', 'Funcionário']),
                    solicitante: getVal(['Solicitante', 'SOLICITANTE']),
                    responsavel: getVal(['Responsável', 'RESPONSÁVEL']),
                    observacao: getVal(['Observação', 'OBSERVAÇÃO', 'Obs'])
                };

                // Import days 1-31 (Previsto and Real)
                for (let i = 1; i <= 31; i++) {
                    // Try to find Previsto (P)
                    const valP = getVal([`${i} Previsto`, `${i} P`, `${i}P`, `${i}Previsto`]);
                    if (valP !== undefined && valP !== '') record[`day${i}_P`] = valP;

                    // Try to find Real (R)
                    const valR = getVal([`${i} Real`, `${i} R`, `${i}R`, `${i}Real`]);
                    if (valR !== undefined && valR !== '') record[`day${i}_R`] = valR;
                }

                return record;
            }).filter(r => r.atividade && r.atividade !== 'GERAL' && r.atividade !== 'FORNALHA BAIXA');

            securityRecords = [...securityRecords, ...imported];
            saveSecurityData();
            renderSecurityList();

            // Determine found columns for the alert
            const firstRow = jsonData[0] || {};
            const foundCols = Object.keys(firstRow).filter(k => {
                const upperK = k.toUpperCase();
                return ['ATIVIDADE', 'TH', 'TURNO', 'CONTRATADO', 'SOLICITANTE', 'RESPONSÁVEL', 'OBSERVAÇÃO'].some(field => upperK.includes(field)) ||
                    /^\d+\s*(P|PREVISTO|R|REAL)$/i.test(k); // Matches "1 P", "1 Previsto", "1 R", "1 Real"
            });

            alert(`✅ Importação Concluída!\n\nRegistros importados: ${imported.length}\nColunas identificadas: ${foundCols.join(', ')}\n\nVerifique se os dados estão corretos.`);
        } catch (err) {
            console.error("Error importing security excel:", err);
            alert("Erro ao ler arquivo Excel.");
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset input
}

function downloadSecurityTemplate() {
    try {
        const templateData = [{
            "Atividade": "Exemplo de Atividade",
            "TH": "SIM",
            "Turno": "M",
            "Contratado/Substituído": "Nome",
            "Solicitante": "Nome",
            "Responsável": "Nome",
            "Observação": "Obs"
        }];

        // Add days 1-31 with Previsto and Real
        for (let i = 1; i <= 31; i++) {
            templateData[0][`${i} Previsto`] = "";
            templateData[0][`${i} Real`] = "";
        }

        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Modelo Segurança");

        // Set widths
        const wscols = [
            { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 30 }
        ];
        // Add widths for days (2 per day)
        for (let i = 1; i <= 31; i++) {
            wscols.push({ wch: 10 }); // Previsto
            wscols.push({ wch: 10 }); // Real
        }
        worksheet['!cols'] = wscols;

        console.log("Gerando arquivo Excel...");
        XLSX.writeFile(workbook, "Modelo_Importacao_Seguranca.xlsx");
        console.log("Template gerado.");
    } catch (e) {
        console.error("Erro template:", e);
        alert("Erro: " + e.message);
    }
}
// --- Dynamic Day Configuration ---
// (Variable activeSecurityDays moved to top)

// ... [Existing code continues] ...

// ====== MKS MODULE ======

async function loadMKSData() {
    // Try localStorage first
    const saved = localStorage.getItem('caldeira_mks');
    if (saved) {
        mksRecords = JSON.parse(saved);
        renderMKSList();
    }

    // Then Firestore if logged in
    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            const doc = await db.collection('shared_data').doc('mks').get();
            if (doc.exists) {
                const data = doc.data();
                if (data.records) {
                    mksRecords = data.records;
                    localStorage.setItem('caldeira_mks', JSON.stringify(mksRecords));
                    renderMKSList();
                }
                // Load Overall Progress
                if (data.overallProgress !== undefined) {
                    const overallEl = document.getElementById('mksOverallProgress');
                    if (overallEl) overallEl.textContent = `${data.overallProgress}%`;
                }
            }
        } catch (e) {
            console.error("Error loading mks data:", e);
        }
    }
}

// Real-time listener for MKS Data
function setupMKSListener() {
    if (typeof currentUser === 'undefined' || !currentUser) return;

    // Listen for Records
    db.collection('shared_data').doc('mks')
        .onSnapshot((doc) => {
            if (doc.exists && doc.data().records) {
                const incomingRecords = doc.data().records;

                // Deep Compare to avoid re-rendering local updates (prevents refresh loop)
                if (JSON.stringify(incomingRecords) === JSON.stringify(mksRecords)) {
                    return;
                }

                mksRecords = incomingRecords;
                renderMKSList();

                // Update config too if present
                if (doc.data().config) {
                    activeMKSDays = doc.data().config.activeDays || [];
                    // renderMKSTableHeaders(); // Deprecated
                    // renderMKSList(); // Already rendered above
                }
            }
        }, (error) => {
            console.error("Error listening to mks updates:", error);
        });
}

async function saveMKSData() {
    // Optimistic update locally
    localStorage.setItem('caldeira_mks', JSON.stringify(mksRecords));

    // Calculate current progress to save
    let currentOverall = 0;
    if (typeof updateMKSStats === 'function') {
        currentOverall = updateMKSStats();
    }
    // Paranoid check
    if (typeof currentOverall !== 'number' || isNaN(currentOverall)) {
        currentOverall = 0;
    }

    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            // Sanitize data
            const cleanRecords = JSON.parse(JSON.stringify(mksRecords || []));
            const safeDays = Array.isArray(activeMKSDays) ? activeMKSDays : [];

            await db.collection('shared_data').doc('mks').set({
                records: cleanRecords,
                config: { activeDays: safeDays },
                overallProgress: currentOverall, // SAVE TO DB
                lastUpdated: new Date().toISOString()
            }, { merge: true });

            // console.log("MKS Saved to Firestore");
        } catch (e) {
            console.error("Error saving mks data:", e);
            alert(`Erro ao salvar no banco: ${e.message}\nValor Overall: ${currentOverall}`);
        }
    } else {
        console.warn("MKS Save skipped: No User");
    }
}

function openMKSModal() {
    console.log("Opening MKS Modal...");
    const modal = document.getElementById('mksModal');
    if (!modal) {
        console.error("ERRO: Elemento 'mksModal' não encontrado!");
        alert("Erro: Janela MKS não encontrada no HTML.");
        return;
    }
    modal.classList.add('show');
    modal.style.display = 'flex'; // Force visibility

    try {
        renderMKSList();
    } catch (e) {
        console.error("Error rendering MKS list:", e);
    }
}

function openMKSFormModal(id = null) {
    if (prompt('Senha admin:') !== '789512') return;

    document.getElementById('mksFormModal').classList.add('show');
    document.getElementById('mksEditId').value = id || '';

    // Generate dynamic day inputs (Previsto/Real)
    const grid = document.getElementById('mksDaysGrid');
    if (grid) {
        grid.innerHTML = '';
        activeMKSDays.forEach(i => {
            grid.innerHTML += `
                <div style="display: flex; flex-direction: column; align-items: center; border: 1px solid #bfdbfe; padding: 4px; border-radius: 6px; background: #fff;">
                    <span style="font-size: 0.9rem; font-weight: 800; color: #1e3a8a; margin-bottom: 3px;">Dia ${i}</span>
                    <div style="display: flex; gap: 4px;">
                        <input type="text" id="mksDay${i}_P" placeholder="P" class="day-input"
                            style="width: 45px; text-align: center; border: 1px solid #93c5fd; font-size: 0.9rem; font-weight: 600; background: #eff6ff; color: #1e40af; border-radius: 4px; padding: 2px;"
                            title="Previsto (%)" oninput="formatPercentInput(this)" onblur="blurPercentInput(this)" onfocus="focusPercentInput(this)">
                        <input type="text" id="mksDay${i}_R" placeholder="R" class="day-input"
                            style="width: 45px; text-align: center; border: 1px solid #86efac; font-size: 0.9rem; font-weight: 600; background: #f0fdf4; color: #166534; border-radius: 4px; padding: 2px;"
                            title="Realizado (%)" oninput="formatPercentInput(this)" onblur="blurPercentInput(this)" onfocus="focusPercentInput(this)">
                    </div>
                </div>
            `;
        });
    }

    if (id) {
        document.getElementById('mksFormTitle').textContent = '🛡️ Editar Registro MKS';
        const record = mksRecords.find(r => r.id === id);
        if (record) {
            document.getElementById('mksAtividade').value = record.atividade || '';
            document.getElementById('mksTH').value = record.th || 'SIM';
            document.getElementById('mksTurno').value = record.turno || 'M';
            document.getElementById('mksContratado').value = record.contratado || '';
            document.getElementById('mksSolicitante').value = record.solicitante || '';
            document.getElementById('mksResponsavel').value = record.responsavel || '';
            document.getElementById('mksObservacao').value = record.observacao || '';

            // Populate days (P and R)
            activeMKSDays.forEach(i => {
                const elP = document.getElementById(`mksDay${i}_P`);
                const elR = document.getElementById(`mksDay${i}_R`);
                if (elP) elP.value = record[`day${i}_P`] || '';
                if (elR) elR.value = record[`day${i}_R`] || '';
            });
        }
    } else {
        document.getElementById('mksFormTitle').textContent = '🛡️ Novo Registro MKS';
        // Clear main inputs
        const mainInputs = ['mksAtividade', 'mksContratado', 'mksSolicitante', 'mksResponsavel', 'mksObservacao'];
        mainInputs.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

        document.getElementById('mksTH').value = 'SIM';
        document.getElementById('mksTurno').value = 'M';
    }
}

function closeMKSFormModal() {
    document.getElementById('mksFormModal').classList.remove('show');
}

function saveMKSRecord() {
    const editId = editingMKSId; // Use global variable set by openMKSFormModal

    // 1. Gather Data from Form
    const rawData = {
        atividade: document.getElementById('mksInputAtividade').value,
        inicio: document.getElementById('mksInputInicio').value,
        termino: document.getElementById('mksInputTermino').value,
        percentReal: document.getElementById('mksInputPercentReal').value,
        percentPrevisto: document.getElementById('mksInputPercentPrevisto').value,
        observacao: document.getElementById('mksInputObs').value,
        // Legacy/Default values if needed, or keep existing
    };

    if (editId) {
        // --- EDIT MODE ---
        const index = mksRecords.findIndex(r => r.id === editId);
        if (index !== -1) {
            // Update fields
            mksRecords[index] = { ...mksRecords[index], ...rawData };

            // Update Days
            activeMKSDays.forEach(i => {
                const inpP = document.getElementById(`mksDay${i}_P`);
                const inpR = document.getElementById(`mksDay${i}_R`);
                if (inpP) mksRecords[index][`day${i}_P`] = inpP.value;
                if (inpR) mksRecords[index][`day${i}_R`] = inpR.value;
            });
        }
    } else {
        // --- CREATE MODE ---
        const newId = mksRecords.reduce((max, r) => Math.max(max, parseInt(r.id) || 0), 0) + 1;
        const newRecord = {
            id: newId,
            ...rawData,
            th: 'NÃO', // Default
            turno: 'M'
        };

        // Save Days
        activeMKSDays.forEach(i => {
            const inpP = document.getElementById(`mksDay${i}_P`);
            const inpR = document.getElementById(`mksDay${i}_R`);
            if (inpP) newRecord[`day${i}_P`] = inpP.value;
            if (inpR) newRecord[`day${i}_R`] = inpR.value;
        });

        mksRecords.push(newRecord);
    }

    saveMKSData();
    renderMKSList();
    closeMKSFormModal();
    alert('✅ Registro salvo!');
}

function deleteMKSRecord(id) {
    if (prompt('Senha admin:') !== '789512') return;
    if (!confirm('Deseja excluir este registro MKS?')) return;

    mksRecords = mksRecords.filter(r => r.id != id);
    saveMKSData();
    renderMKSList();
}

function clearMKSData() {
    const pw = prompt('Senha admin para LIMPAR TUDO (MKS):');
    if (pw !== '789512') {
        if (pw !== null) alert("❌ Senha incorreta!");
        return;
    }

    if (!confirm('ATENÇÃO: Isso apagará TODOS os registros MKS permanentemente. Confirmar?')) return;

    mksRecords = [];
    saveMKSData();
    renderMKSList();
    alert('✅ Todos os registros MKS foram apagados.');
}

// MKS Pagination State
let currentMKSRecordIndex = 0;
const mksItemsPerPage = 1; // Show 1 GROUP at a time (like IDs 1, 2, 3...)

function prevMKSRecord() {
    if (currentMKSRecordIndex > 0) {
        currentMKSRecordIndex--;
        renderMKSList();
    }
}

function nextMKSRecord() {
    // Check against total unique IDs
    const uniqueIds = [...new Set(mksRecords.map(r => r.id))];
    if (currentMKSRecordIndex < uniqueIds.length - 1) {
        currentMKSRecordIndex++;
        renderMKSList();
    }
}

function renderMKSList() {
    const container = document.getElementById('mksContainer');
    if (!container) return;
    container.innerHTML = '';

    if (mksRecords.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-secondary); font-size: 1.2rem;">📋 Nenhum registro MKS encontrado.<br><span style="font-size: 0.9rem; opacity: 0.7;">Importe um arquivo Excel ou crie um novo registro.</span></div>';
        updateMKSNavigator(0, 0, 0);
        updateMKSStats();
        return;
    }
    // Hierarchy Logic: Groups by ID
    // 1. Group records by ID
    const grouped = {};
    const ids = [];
    mksRecords.forEach(r => {
        if (!grouped[r.id]) {
            grouped[r.id] = [];
            ids.push(r.id);
        }
        grouped[r.id].push(r);
    });

    // Pagination Logic
    const totalIDs = ids.length;

    // Sort IDS (optional, assume input order or numeric sort)
    ids.sort((a, b) => a - b);

    // If no records
    if (totalIDs === 0) {
        container.innerHTML = '<div style="color:white; padding:2rem; text-align:center;">Nenhum registro encontrado.</div>';
        updateMKSNavigator(0, 0, 0);
        return;
    }

    if (currentMKSRecordIndex >= totalIDs) currentMKSRecordIndex = totalIDs - 1;
    if (currentMKSRecordIndex < 0) currentMKSRecordIndex = 0;

    // Get current Group
    const currentID = ids[currentMKSRecordIndex];
    const groupRecords = grouped[currentID];

    // Card Container
    const section = document.createElement('div');
    section.className = 'activity-section';
    const masterRecord = groupRecords[0];

    // Master Header
    section.innerHTML = `
        <div class="section-header">
            <div class="section-id">${masterRecord.id}</div>
            <div class="section-title">
                <h2 style="display: flex; align-items: center; gap: 0.8rem;">
                    ${masterRecord.atividade}
                </h2>
                <p>ID Grupo: ${masterRecord.id} • ${groupRecords.length} item(s)</p>
            </div>
             <div class="section-actions" style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                 <button class="btn-control edit" onclick="openMKSFormModal(${masterRecord.id})" style="background: var(--warning); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Editar">✏️</button>
                 <button class="btn-control delete" onclick="deleteMKSRecord(${masterRecord.id})" style="background: var(--danger); padding: 0.3rem 0.6rem; font-size: 0.9rem; width: auto; height: auto;" title="Excluir">🗑️</button>
            </div>
        </div>
    `;

    // Items List
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'activities-list';

    groupRecords.forEach((record, idx) => {
        // Self-Healing UID if missing (legacy data)
        if (!record.uid) {
            record.uid = 'mks_legacy_' + record.id + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        }

        const isChild = idx > 0;
        const real = parseInt(record.percentReal) || 0;
        const prev = parseInt(record.percentPrevisto) || 0;
        const isComp = real === 100;

        // Match Main Dashboard UI
        let itemHtml = '';

        if (!isChild) {
            // Master Line Style (Section Header-like)
            itemHtml = `
            <div class="activity-item master-item" style="border-left: 4px solid var(--primary); background: rgba(30, 41, 59, 0.95); margin-bottom: 8px;">
                <div class="activity-header" style="justify-content: space-between; align-items: flex-start; padding-right: 1rem;">
                     <div class="activity-info">
                        <div class="activity-name" style="font-size: 1.1rem; color: #fff; font-weight: 700;">${record.atividade}</div>
                        <div class="activity-meta">
                             <span class="meta-item">📅 ${record.inicio || '--'} - ${record.termino || '--'}</span>
                             <span class="meta-item">ID: ${record.id}</span>
                        </div>
                    </div>
                    
                    </div>
                    
                    <div class="section-stats" style="text-align: right; min-width: 140px; display: flex; flex-direction: column; align-items: flex-end;">
                        <div class="section-progress" id="mks-master-prog-${record.uid}" style="color: #fff; font-size: 2rem; font-weight: 800; line-height: 1;">${real}%</div>
                        <div class="section-count" style="color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-top: 4px;">${real === 100 ? 'Concluída' : 'Em andamento'}</div>
                        <div class="section-expected" style="color: rgba(255,255,255,0.5); font-size: 0.85rem; margin-top: 2px;">Previsto: ${prev}%</div>
                        
                        <div class="section-actions" style="margin-top: 10px; display: flex; gap: 8px;">
                             <button class="btn-control edit" onclick="window.openMKSFormModal(${record.id})" style="background: var(--warning); padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 1rem;" title="Editar">✏️</button>
                             <button class="btn-control delete" onclick="window.deleteMKSRecord(${record.id})" style="background: var(--danger); padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 1rem;" title="Excluir">🗑️</button>
                        </div>
                    </div>
                </div>
                <div class="activity-observation" style="padding: 0 1rem 1rem 1rem;">
                     <textarea 
                        class="observation-input-mks" 
                        placeholder="Observação do Grupo..." 
                        style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; font-size: 0.9rem; padding: 8px; border-radius: 6px; resize: vertical; min-height: 45px;"
                        onblur="updateMKSObservation('${record.id}', this.value)">${record.observacao || ''}</textarea>
                </div>
            </div>`;
        } else {
            // Child Item Style (Existing)
            itemHtml = `
            <div class="activity-item sub-activity ${isComp ? 'completed' : ''}">
                <div class="activity-header">
                     <div class="activity-info">
                        <div class="activity-name">└── ${record.atividade}</div>
                        <div class="activity-meta">
                             <span class="meta-item">📅 Início: ${record.inicio || '--'}</span>
                             <span class="meta-item">🏁 Término: ${record.termino || '--'}</span>
                        </div>
                    </div>
                    
                    <div class="controls" style="visibility: visible;">
                        <button class="btn-control decrement" onclick="decrementMKS('${record.uid}')">▼</button>
                        <button class="btn-control increment" onclick="incrementMKS('${record.uid}')">▲</button>
                    </div>

                    <div class="item-actions" style="display: flex; gap: 0.5rem; align-items: center; margin-left: 1rem;">
                        <!-- Optional Item Edit -->
                    </div>
                </div>

                <div class="progress-bars-wrapper">
                    <div class="progress-bar-row">
                        <span class="progress-label">Real:</span>
                        <div class="progress-bar-container">
                            <div id="mks-prog-bar-${record.uid}" class="progress-bar" style="width: ${real}%; background: ${getProgressGradient(real)};"></div>
                        </div>
                        <span id="mks-prog-text-${record.uid}" class="progress-percentage">${real}%</span>
                    </div>
                    <div class="progress-bar-row">
                        <span class="progress-label">Previsto:</span>
                        <div class="progress-bar-container">
                             <div class="progress-bar expected" style="width: ${prev}%"></div>
                        </div>
                         <span class="progress-percentage">${prev}%</span>
                    </div>
                </div>
            </div>`;
        }
        itemsContainer.innerHTML += itemHtml;
    });

    section.appendChild(itemsContainer);
    container.appendChild(section);

    updateMKSNavigator(currentMKSRecordIndex + 1, 0, totalIDs); // Fix args: start, end(unused), total
    updateMKSStats(); // Ensure stats update dynamically
}


function updateMKSStats() {
    let finalVal = 0;
    try {
        const total = mksRecords.length;
        const totalEl = document.getElementById('mksTotalRecords');
        if (totalEl) totalEl.textContent = total;

        // Group (Same logic as renderMKSList)
        const groups = {};
        mksRecords.forEach(r => {
            if (!groups[r.id]) groups[r.id] = [];
            groups[r.id].push(r);
        });

        const masterIds = Object.keys(groups);
        let sumMasters = 0;

        masterIds.forEach(id => {
            // Trust Visual Logic: Master is index 0
            const master = groups[id][0];
            if (master) {
                let p = parseInt(master.percentReal);
                if (isNaN(p)) p = 0;
                sumMasters += p;
            }
        });

        finalVal = sumMasters;

        const overallEl = document.getElementById('mksOverallProgress');
        if (overallEl) {
            overallEl.textContent = `${finalVal}%`;
            overallEl.style.color = ""; // Reset color
            overallEl.style.fontWeight = "";
        }
    } catch (e) {
        console.error("Error in updateMKSStats:", e);
        const overallEl = document.getElementById('mksOverallProgress');
        if (overallEl) overallEl.textContent = "Erro";
    }
    return finalVal; // Return for DB saving
}


// Start, End, Total are now relative to GROUPS (IDs)
function updateMKSNavigator(start, end, total) {
    const info = document.getElementById('mksRecordInfo');
    const prev = document.getElementById('mksPrevRecord');
    const next = document.getElementById('mksNextRecord');

    if (info) info.textContent = total === 0 ? 'NENHUM REGISTRO' : `ID ${start} de ${total}`;
    if (prev) prev.disabled = start <= 1;
    if (next) next.disabled = end >= total;
}

// Helper for Unique ID
function generateUID() {
    return 'mks_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

function handleMKSExcelUpload(event) {
    if (prompt('Senha admin:') !== '789512') {
        event.target.value = ''; // Reset
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        try {
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];

            // Use raw: false to get formatted strings (dates as text)
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

            let headers = [];
            let headerRowIndex = -1;

            // Smart Header Search (First 20 rows)
            for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
                const row = jsonData[i].map(c => String(c || '').trim().toUpperCase());
                if (row.some(c => c.includes('ATIVIDADE') || c.includes('TAREFA') || c.includes('NOME DA TAREFA') || c.includes('DESCRIÇÃO'))) {
                    headerRowIndex = i;
                    headers = row.map((h, index) => ({ name: h, index: index }));
                    break;
                }
            }

            if (headerRowIndex === -1) {
                // Fallback to first row
                if (jsonData.length > 0) {
                    headers = jsonData[0].map((h, index) => ({ name: String(h || '').trim().toUpperCase(), index: index }));
                    headerRowIndex = 0;
                }
            }

            if (headers.length === 0) {
                alert("Erro: Não foi possível identificar o cabeçalho. Verifique as colunas.");
                event.target.value = '';
                return;
            }

            const getIndex = (possibleNames) => {
                // 1. Strict
                for (const name of possibleNames) {
                    const match = headers.find(h => h.name === name);
                    if (match) return match.index;
                }
                // 2. Fuzzy
                for (const name of possibleNames) {
                    const fuzzy = headers.find(h => h.name.includes(name));
                    if (fuzzy) return fuzzy.index;
                }
                return -1;
            };

            const colMap = {
                id: getIndex(['ID', 'COD', 'CÓD', 'CODIGO']),
                atividade: getIndex(['ATIVIDADE', 'TAREFA', 'DESCRIÇÃO', 'NOME DA TAREFA']),
                inicio: getIndex(['INICIO', 'INÍCIO', 'DATA DE INICIO', 'DATA_INICIO']),
                termino: getIndex(['TERMINO', 'TÉRMINO', 'FIM', 'DATA DE FIM', 'DATA_FIM']),
                // Strict-er mapping for Real/Previsto
                percentReal: getIndex(['% REAL', '% REALIZADO', 'REAL %', 'AVANÇO REAL']),
                percentPrevisto: getIndex(['% PREVISTO', 'PREVISTO %', '% PLANEJADO']),
                // Legacy
                th: getIndex(['TH', 'STATUS']),
                turno: getIndex(['TURNO']),
                contratado: getIndex(['CONTRATADO', 'SUBSTITUÍDO', 'NOME']),
                solicitante: getIndex(['SOLICITANTE']),
                responsavel: getIndex(['RESPONSÁVEL', 'RESPONSAVEL']),
                observacao: getIndex(['OBSERVAÇÃO', 'OBS'])
            };

            // STRICT FALLBACKs
            if (colMap.percentReal === -1) {
                const idx = headers.findIndex(h => h.name === 'REAL');
                if (idx !== -1) colMap.percentReal = idx;
            }
            if (colMap.percentPrevisto === -1) {
                const idx = headers.findIndex(h => h.name === 'PREVISTO');
                if (idx !== -1) colMap.percentPrevisto = idx;
            }

            let nextId = 1;
            // Reset logic: we are overwriting, so nextId starts at 1 usually, 
            // OR finding max if user wants merge? 
            // User complained about "wrong data", implies overwrite is desired.

            const imported = [];

            for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                const getVal = (idx) => (idx !== -1 && row[idx] !== undefined) ? String(row[idx]).trim() : '';
                const atividadeVal = getVal(colMap.atividade);

                if (!atividadeVal || atividadeVal.toUpperCase() === 'GERAL') continue;

                let recordId;
                const excelId = getVal(colMap.id);
                if (excelId && !isNaN(parseInt(excelId))) {
                    recordId = parseInt(excelId);
                } else {
                    recordId = nextId++;
                }

                const record = {
                    uid: generateUID() + '_' + i, // Unique ID for every row
                    id: recordId,
                    atividade: atividadeVal,
                    inicio: getVal(colMap.inicio),
                    termino: getVal(colMap.termino),
                    percentReal: getVal(colMap.percentReal) || '0',  // Default to 0 if empty
                    percentPrevisto: getVal(colMap.percentPrevisto) || '0',
                    th: getVal(colMap.th),
                    turno: getVal(colMap.turno),
                    contratado: getVal(colMap.contratado),
                    solicitante: getVal(colMap.solicitante),
                    responsavel: getVal(colMap.responsavel),
                    observacao: getVal(colMap.observacao)
                };

                // Days (optional)
                for (let d = 1; d <= 31; d++) {
                    // Similar fuzzy logic for days if needed, omitted for brevity/safety unless requested.
                    // If user grid is gone, maybe we don't need to parse days strictly?
                    // But keeping it doesn't hurt.
                    // Simplified day parsing:
                    const pIndex = headers.findIndex(h => {
                        const n = h.name.replace(/\s+/g, '');
                        return n === `${d}P` || n === `${d}PREVISTO` || n === `DIA${d}P`;
                    });
                    const rIndex = headers.findIndex(h => {
                        const n = h.name.replace(/\s+/g, '');
                        return n === `${d}R` || n === `${d}REAL` || n === `DIA${d}R`;
                    });
                    if (pIndex !== -1) record[`day${d}_P`] = getVal(pIndex);
                    if (rIndex !== -1) record[`day${d}_R`] = getVal(rIndex);
                }

                imported.push(record);
            }

            // OVERWRITE MODE
            mksRecords = imported;
            saveMKSData();
            renderMKSList();

            // Stats
            if (typeof updateMKSStats === 'function') updateMKSStats();

            // DEBUG ALERT - CONFIRMATION
            const colsFound = [];
            if (colMap.id !== -1) colsFound.push('ID');
            if (colMap.atividade !== -1) colsFound.push('Tarefa');
            if (colMap.percentReal !== -1) colsFound.push('% Real');

            alert(`✅ Importação MKS: ${imported.length} itens novos.\nColunas: ${colsFound.join(', ')}`);

        } catch (e) {
            console.error(e);
            alert("Erro importação: " + e.message);
        }
        event.target.value = ''; // Allow re-import
    };
    reader.readAsArrayBuffer(file);
}

function downloadMKSTemplate() {
    try {
        const templateData = [
            {
                "ID": 1,
                "Nome da Tarefa": "Exemplo de Tarefa",
                "Início": "18/01/2026 - 15:00",
                "Término": "19/01/2026 - 15:00",
                "% Real": "10%",
                "% Previsto": "20%"
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Modelo MKS");

        // Set widths matching screen
        const wscols = [
            { wch: 8 },  // ID
            { wch: 40 }, // Nome
            { wch: 20 }, // Início
            { wch: 20 }, // Término
            { wch: 10 }, // % Real
            { wch: 10 }  // % Previsto
        ];
        worksheet['!cols'] = wscols;

        XLSX.writeFile(workbook, "Modelo_MKS.xlsx");
    } catch (e) {
        console.error("Erro template:", e);
        alert("Erro: " + e.message);
    }
}

// Function to Export MKS Data
// Function to Export MKS Data (Strict Mode - MKS Competence Only)
function exportMKSData() {
    if (!mksRecords || mksRecords.length === 0) {
        alert("Não há dados MKS para exportar.");
        return;
    }

    try {
        const exportData = mksRecords.map(record => {
            // New Format Strictly "Validation MKS"
            return {
                "ID": record.id || "",
                "Nome da Tarefa": record.atividade || "",
                "Início": record.inicio || "",
                "Término": record.termino || "",
                "% Real": record.percentReal || "",
                "% Previsto": record.percentPrevisto || ""
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Dados MKS");

        // Set widths
        const wscols = [
            { wch: 8 },  // ID
            { wch: 40 }, // Nome
            { wch: 20 }, // Inicio
            { wch: 20 }, // Termino
            { wch: 10 }, // % Real
            { wch: 10 }  // % Previsto
        ];
        worksheet['!cols'] = wscols;

        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(workbook, `MKS_Export_${dateStr}.xlsx`);
        console.log("Exportação MKS concluída.");

    } catch (e) {
        console.error("Erro exportação:", e);
        alert("Erro ao exportar: " + e.message);
    }
}

// --- MKS Configuration ---

async function loadMKSConfig() {
    const stored = localStorage.getItem('mksDaysConfig');
    if (stored) {
        try {
            activeMKSDays = JSON.parse(stored).map(Number).sort((a, b) => a - b);
        } catch (e) { console.error("Erro config local:", e); }
    }

    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            const doc = await db.collection('shared_data').doc('mks').get();
            if (doc.exists && doc.data().config && doc.data().config.activeDays) {
                activeMKSDays = doc.data().config.activeDays.map(Number).sort((a, b) => a - b);
                localStorage.setItem('mksDaysConfig', JSON.stringify(activeMKSDays));
            }
        } catch (e) { console.error("Erro config firestore:", e); }
    }
    // renderMKSTableHeaders(); // Deprecated
}

function openMKSDaysConfig() {
    if (prompt('Senha admin:') !== '789512') return;

    document.getElementById('mksDaysModal').classList.add('show');
    const grid = document.getElementById('mksDaysConfigGrid');
    grid.innerHTML = '';

    for (let i = 1; i <= 31; i++) {
        const checked = activeMKSDays.includes(i) ? 'checked' : '';
        grid.innerHTML += `
            <label style="display: flex; flex-direction: column; align-items: center; cursor: pointer; border: 1px solid #ddd; padding: 5px; border-radius: 4px; background: ${checked ? '#e0f2fe' : '#fff'};">
                <span style="font-size: 0.8rem; font-weight: bold; color: #333; margin-bottom: 2px;">${i}</span>
                <input type="checkbox" class="day-config-checkbox-mks" value="${i}" ${checked} onclick="this.parentElement.style.background = this.checked ? '#e0f2fe' : '#fff'">
            </label>
        `;
    }
}

function closeMKSDaysModal() {
    document.getElementById('mksDaysModal').classList.remove('show');
}

function toggleAllMKSDays(state) {
    document.querySelectorAll('.day-config-checkbox-mks').forEach(cb => {
        cb.checked = state;
        cb.parentElement.style.background = state ? '#e0f2fe' : '#fff';
    });
}

async function saveMKSDays() {
    const checkboxes = document.querySelectorAll('.day-config-checkbox-mks:checked');
    activeMKSDays = Array.from(checkboxes).map(cb => parseInt(cb.value)).sort((a, b) => a - b);

    localStorage.setItem('mksDaysConfig', JSON.stringify(activeMKSDays));

    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            await db.collection('shared_data').doc('mks').set({
                config: { activeDays: activeMKSDays },
                lastConfigUpdate: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            console.error("Erro saving config firestore:", e);
        }
    }

    // renderMKSTableHeaders(); // Deprecated
    renderMKSList();
    closeMKSDaysModal();
    alert('✅ Configuração MKS salva!');
}

function toggleMKSMobileMenu() {
    const menu = document.getElementById('mksActionsMenu');
    menu.classList.toggle('show');
}

function openMKSModalDirectly() {
    mksOpenedFromMain = true;
    showMKSDashboard();
}

function closeMKSModal() {
    const modal = document.getElementById('mksModal');
    if (modal) {
        modal.classList.remove('show');
        modal.style.display = 'none';
    }
    if (mksOpenedFromMain) {
        returnToMainMenu();
        mksOpenedFromMain = false;
    }
}

// function renderMKSTableHeaders() {} // Removed (Deprecated by Card View)

// --- MKS Progress Controls ---

// Update Master Progress based on group average
function updateMKSGroupProgress(groupId) {
    const group = mksRecords.filter(r => r.id === groupId);
    if (group.length === 0) return;

    // Master is the first one (index 0 of the group filtering result if sorted, but usually they are consecutive)
    // Actually, mksRecords might be mixed. But usually imported in order.
    // The "Master" record is the one where isChild is false (or the first one in the filtered list if structure is strict).
    // Let's assume the first one with the ID is the master.
    const master = group[0];
    if (!master) return;

    // Check if we have children to average
    let total = 0;
    let count = 0;

    if (group.length > 1) {
        // Average of CHILDREN (all items except the first one)
        // Assumption: Index 0 is Master, 1..n are Children
        for (let i = 1; i < group.length; i++) {
            total += parseInt(group[i].percentReal) || 0;
            count++;
        }
    } else {
        // Standalone item
        total = parseInt(master.percentReal) || 0;
        count = 1;
    }

    const avg = count > 0 ? Math.round(total / count) : 0;
    master.percentReal = avg; // Update Master Record in Memory

    // Update Master DOM
    const masterProgEl = document.getElementById(`mks-master-prog-${master.uid}`);
    if (masterProgEl) {
        masterProgEl.textContent = `${avg}%`;
        // Also update status text sibling
        const parent = masterProgEl.parentElement; // section-stats
        if (parent) {
            const statusEl = parent.querySelector('.section-count');
            if (statusEl) statusEl.textContent = avg === 100 ? 'Concluída' : 'Em andamento';
        }
    }
}

function incrementMKS(uid) {
    const record = mksRecords.find(r => r.uid === uid);
    if (record) {
        let current = parseInt(record.percentReal) || 0;
        if (current < 100) {
            record.percentReal = current + 1;

            // Direct DOM Update (No Refresh)
            const bar = document.getElementById(`mks-prog-bar-${uid}`);
            const text = document.getElementById(`mks-prog-text-${uid}`);

            if (bar) {
                bar.style.width = `${record.percentReal}%`;
                if (typeof getProgressGradient === 'function') {
                    bar.style.background = getProgressGradient(record.percentReal);
                }
            }
            if (text) text.textContent = `${record.percentReal}%`;

            // Update Master Progress (Sync)
            updateMKSGroupProgress(record.id);

            saveMKSData(); // Sync silently
            if (typeof updateMKSStats === 'function') updateMKSStats();
        }
    }
}

function decrementMKS(uid) {
    const record = mksRecords.find(r => r.uid === uid);
    if (record) {
        let current = parseInt(record.percentReal) || 0;
        if (current > 0) {
            record.percentReal = current - 1;

            // Direct DOM Update (No Refresh)
            const bar = document.getElementById(`mks-prog-bar-${uid}`);
            const text = document.getElementById(`mks-prog-text-${uid}`);

            if (bar) {
                bar.style.width = `${record.percentReal}%`;
                if (typeof getProgressGradient === 'function') {
                    bar.style.background = getProgressGradient(record.percentReal);
                }
            }
            if (text) text.textContent = `${record.percentReal}%`;

            // Update Master Progress (Sync)
            updateMKSGroupProgress(record.id);

            saveMKSData(); // Sync silently
        }
    }
}

// Expose MKS functions globally
window.openMKSModalDirectly = openMKSModalDirectly;
window.handleMKSExcelUpload = handleMKSExcelUpload;
window.exportMKSData = exportMKSData;
window.saveMKSRecord = saveMKSRecord;
window.deleteMKSRecord = deleteMKSRecord;
window.prevMKSRecord = prevMKSRecord;
window.nextMKSRecord = nextMKSRecord;
window.openMKSFormModal = openMKSFormModal;
window.closeMKSFormModal = closeMKSFormModal;
window.incrementMKS = incrementMKS;
window.decrementMKS = decrementMKS;
window.toggleMKSMobileMenu = toggleMKSMobileMenu;

// Initial Load Hook
document.addEventListener('DOMContentLoaded', () => {
    loadMKSConfig();
});

// End of MKS Module
// ... [Existing code continues] ...

async function loadSecurityConfig() {
    // 1. Try LocalStorage (fast load)
    const stored = localStorage.getItem('securityDaysConfig');
    if (stored) {
        try {
            activeSecurityDays = JSON.parse(stored).map(Number).sort((a, b) => a - b);
        } catch (e) {
            console.error("Erro config local:", e);
        }
    }

    // 2. Try Firestore (authoritative)
    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            const doc = await db.collection('shared_data').doc('security').get();
            if (doc.exists && doc.data().config && doc.data().config.activeDays) {
                activeSecurityDays = doc.data().config.activeDays.map(Number).sort((a, b) => a - b);
                localStorage.setItem('securityDaysConfig', JSON.stringify(activeSecurityDays));
            }
        } catch (e) {
            console.error("Erro config firestore:", e);
        }
    }

    renderSecurityTableHeaders();
}

function openSecurityConfigModal() {
    if (prompt('Senha admin:') !== '789512') return;

    document.getElementById('securityDaysModal').classList.add('show');
    const grid = document.getElementById('securityDaysConfigGrid');
    grid.innerHTML = '';

    for (let i = 1; i <= 31; i++) {
        const checked = activeSecurityDays.includes(i) ? 'checked' : '';
        grid.innerHTML += `
            <label style="display: flex; flex-direction: column; align-items: center; cursor: pointer; border: 1px solid #ddd; padding: 5px; border-radius: 4px; background: ${checked ? '#e0f2fe' : '#fff'};">
                <span style="font-size: 0.8rem; font-weight: bold; color: #333; margin-bottom: 2px;">${i}</span>
                <input type="checkbox" class="day-config-checkbox" value="${i}" ${checked} onclick="this.parentElement.style.background = this.checked ? '#e0f2fe' : '#fff'">
            </label>
        `;
    }
}

function closeSecurityDaysModal() {
    document.getElementById('securityDaysModal').classList.remove('show');
}

function toggleAllSecurityDays(state) {
    document.querySelectorAll('.day-config-checkbox').forEach(cb => {
        cb.checked = state;
        cb.parentElement.style.background = state ? '#e0f2fe' : '#fff';
    });
}

async function saveSecurityDays() {
    const checkboxes = document.querySelectorAll('.day-config-checkbox:checked');
    activeSecurityDays = Array.from(checkboxes).map(cb => parseInt(cb.value)).sort((a, b) => a - b);

    // Save Local
    localStorage.setItem('securityDaysConfig', JSON.stringify(activeSecurityDays));

    // Save Firestore
    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            await db.collection('shared_data').doc('security').set({
                config: { activeDays: activeSecurityDays },
                lastConfigUpdate: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            console.error("Erro saving config firestore:", e);
            alert("⚠️ Salvo localmente, mas erro ao salvar na nuvem: " + e.message);
        }
    }

    renderSecurityTableHeaders();
    renderSecurityList();
    closeSecurityDaysModal();
    alert('✅ Configuração salva e sincronizada!');
}

function toggleSecurityMobileMenu() {
    const menu = document.getElementById('securityActionsMenu');
    menu.classList.toggle('show');
}

// --- Main Menu Navigation ---

function showMainMenu() {
    // Hide login modal properly
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
        loginModal.classList.remove('show');
        loginModal.style.display = 'none'; // Force hide just in case
    }

    document.getElementById('mainMenu').style.display = 'flex';
    document.getElementById('mainDashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'block';
    renderActivities();
    updateStats();
}

// Flag to track navigation source
let securityOpenedFromMain = false;

function openSecurityModalDirectly() {
    securityOpenedFromMain = true; // Set flag
    showDashboard();
    openSecurityModal();
}

function closeSecurityModal() {
    document.getElementById('securityModal').classList.remove('show');

    // If opened from Main Menu screen, return to it when closing
    if (securityOpenedFromMain) {
        returnToMainMenu();
        securityOpenedFromMain = false; // Reset flag
    }
}

function returnToMainMenu() {
    // Safety: Force close any open modals to prevent overlay issues
    document.getElementById('securityModal').classList.remove('show');
    const mksModal = document.getElementById('mksModal');
    if (mksModal) {
        mksModal.classList.remove('show');
        mksModal.style.display = 'none'; // Force hide
    }
    document.getElementById('mksDashboard').style.display = 'none'; // NEW: Hide MKS Dashboard
    document.getElementById('loginModal').classList.remove('show');
    document.getElementById('loginModal').style.display = 'none'; // Double safety

    document.getElementById('mainDashboard').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'flex';
}

function showMKSDashboard() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'none';
    document.getElementById('mksDashboard').style.display = 'block';

    // Initial Render
    renderMKSList();
    // renderMKSTableHeaders(); // Deprecated
    updateMKSStats();
}

function updateMKSStats() {
    const total = mksRecords.length;
    const thSim = mksRecords.filter(r => (r.th || '').toUpperCase().includes('SIM')).length;
    const activeDays = activeMKSDays.length;

    const elTotal = document.getElementById('mksTotalRecords');
    const elTh = document.getElementById('mksTHSim');
    const elDays = document.getElementById('mksActiveDaysCount');

    if (elTotal) elTotal.textContent = total;
    if (elTh) elTh.textContent = thSim;
    if (elDays) elDays.textContent = activeDays;
}

// About Modal
function openAboutModal() {
    document.getElementById('aboutModal').classList.add('show');
}

function closeAboutModal() {
    document.getElementById('aboutModal').classList.remove('show');
}

// Expose globally
window.openAboutModal = openAboutModal;
window.closeAboutModal = closeAboutModal;

// Make logout available globally matching the onclick="logout()" calls
window.logout = handleLogout;

// Data Loading Exports (CRITICAL for firebase-config.js)
window.loadSecurityData = loadSecurityData;
window.setupSecurityListener = setupSecurityListener;
window.loadMKSData = loadMKSData;
window.setupMKSListener = setupMKSListener;

function renderSecurityTableHeaders() {
    const headerRow = document.getElementById('securityHeaderRow');
    const subHeaderRow = document.getElementById('securitySubHeaderRow');
    // ... existing code ...

    if (!headerRow || !subHeaderRow) return;

    // Fixed headers HTML - First Row
    let headerHTML = `
        <th rowspan="2">ID</th>
        <th rowspan="2">Atividade</th>
        <th rowspan="2">TH</th>
        <th rowspan="2">Turno</th>
        <th rowspan="2">Contratado/Substituído</th>
        <th rowspan="2">Solicitante</th>
        <th rowspan="2">Responsável</th>
        <th rowspan="2">Observação</th>
    `;

    // Dynamic Days Headers
    activeSecurityDays.forEach(day => {
        headerHTML += `<th colspan="2" class="day-col">${day}</th>`;
    });

    // Actions Header
    headerHTML += `<th rowspan="2" style="text-align: center;">Ações</th>`;

    headerRow.innerHTML = headerHTML;

    // Sub-headers Row
    let subHeaderHTML = '';
    activeSecurityDays.forEach(() => {
        subHeaderHTML += `<th class="sub-col col-p">P</th><th class="sub-col col-r">R</th>`;
    });

    subHeaderRow.innerHTML = subHeaderHTML;
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
    loadSecurityConfig();
});

// Helper functions for percentage inputs
function formatPercentInput(input) {
    // Remove non-digits
    let val = input.value.replace(/\D/g, '');

    // Limit to 100
    if (val !== '') {
        let num = parseInt(val, 10);
        if (num > 100) num = 100;
        val = num.toString();
    }

    input.value = val;
}

function blurPercentInput(input) {
    let val = input.value.replace(/\D/g, '');
    if (val !== '') {
        input.value = val + '%';
    }
}

function focusPercentInput(input) {
    let val = input.value.replace(/\D/g, '');
    input.value = val;
}

// --- WELDING PERSISTENCE LOGIC (Restored) ---

function getWeldsCompleted(key) {
    // Safety check if weldsData is undefined
    if (typeof weldsData === 'undefined') return 0;
    return weldsData[key] || 0;
}

async function incrementWelds(key) {
    if (typeof activities === 'undefined') return;
    const act = activities.find(a => a.uniqueKey === key);
    const max = act ? (act.totalWelds || 0) : 99999;

    // Safety init
    if (typeof weldsData === 'undefined') weldsData = {};

    let current = weldsData[key] || 0;
    if (current < max) {
        weldsData[key] = current + 1;
        updateWeldDOM(key, weldsData[key], max);
        await saveWeldsData();
    }
}

async function decrementWelds(key) {
    if (typeof weldsData === 'undefined') weldsData = {};
    let current = weldsData[key] || 0;
    if (current > 0) {
        weldsData[key] = current - 1;

        const act = activities ? activities.find(a => a.uniqueKey === key) : null;
        const max = act ? (act.totalWelds || 0) : 0;

        updateWeldDOM(key, weldsData[key], max);
        await saveWeldsData();
    }
}

function updateWeldDOM(key, val, max) {
    const valEl = document.querySelector(`.welds-value[data-key="${key}"]`);
    if (valEl) valEl.textContent = val;

    if (valEl) {
        const parent = valEl.closest('.welds-display');
        if (parent) {
            const pctEl = parent.querySelector('.welds-percentage');
            if (pctEl && max > 0) {
                pctEl.textContent = `(${Math.round((val / max) * 100)}%)`;
            }
        }
    }
}

async function saveWeldsData() {
    if (typeof weldsData === 'undefined') return;
    localStorage.setItem('caldeira_welds', JSON.stringify(weldsData));

    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            await db.collection('shared_data').doc('welds').set({
                data: JSON.parse(JSON.stringify(weldsData)),
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        } catch (e) {
            console.error("Error saving welds:", e);
        }
    }
}

async function loadWeldsData() {
    const saved = localStorage.getItem('caldeira_welds');
    if (saved) {
        try { weldsData = JSON.parse(saved); } catch (e) { }
    }

    if (typeof currentUser !== 'undefined' && currentUser) {
        try {
            const doc = await db.collection('shared_data').doc('welds').get();
            if (doc.exists && doc.data().data) {
                weldsData = doc.data().data;
                localStorage.setItem('caldeira_welds', JSON.stringify(weldsData));

                if (typeof activities !== 'undefined' && activities.length > 0) {
                    renderActivities();
                }
            }
        } catch (e) { console.error("Error loading welds:", e); }
    }
}

window.incrementWelds = incrementWelds;
window.decrementWelds = decrementWelds;
window.loadWeldsData = loadWeldsData;

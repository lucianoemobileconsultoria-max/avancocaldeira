// Global variables
let activities = [];
let progressData = {};
let currentRecordIndex = 0; // Index of currently displayed record
let itemsPerPage = 5; // Number of records to show at once
let sCurveChart = null; // Chart.js instance for S-Curve

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadProgressData();
    loadActivities(); // Try to load saved activities first
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    document.getElementById('filterSearch').addEventListener('input', () => {
        currentRecordIndex = 0; // Reset to first record when filtering
        renderActivities();
    });
    document.getElementById('filterID').addEventListener('change', () => {
        currentRecordIndex = 0; // Reset to first record when filtering
        renderActivities();
    });
    document.getElementById('filterStatus').addEventListener('change', () => {
        currentRecordIndex = 0; // Reset to first record when filtering
        renderActivities();
    });
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('prevRecord').addEventListener('click', previousRecord);
    document.getElementById('nextRecord').addEventListener('click', nextRecord);
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
    // Try to load from saved activities first
    const savedActivities = await loadSavedActivities();

    if (savedActivities && savedActivities.length > 0) {
        activities = savedActivities;
        console.log(`${activities.length} atividades carregadas.`);
        populateFilters();
        renderActivities();
        return;
    }

    // If no saved activities, try to load from file
    await loadActivitiesFromFile();
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
    if (!currentUser) return null;

    try {
        showSyncIndicator('Carregando atividades da nuvem...');

        const doc = await db.collection('users')
            .doc(currentUser.uid)
            .get();

        hideSyncIndicator();

        if (doc.exists && doc.data().activities) {
            return doc.data().activities;
        }
    } catch (error) {
        console.error('Erro ao carregar atividades do Firestore:', error);
        hideSyncIndicator();
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
    if (!currentUser) return;

    try {
        showSyncIndicator('Salvando atividades na nuvem...');

        // Save activities array as a single document
        await db.collection('users')
            .doc(currentUser.uid)
            .set({
                activities: activities,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

        console.log(`${activities.length} atividades salvas no Firestore.`);
        hideSyncIndicator();
    } catch (error) {
        console.error('Erro ao salvar atividades no Firestore:', error);
        hideSyncIndicator();
    }
}

// Load activities from the text file
async function loadActivitiesFromFile() {
    try {
        const response = await fetch('Novo(a) Documento de Texto.txt');
        const text = await response.text();
        parseActivitiesFromText(text);
        saveActivities(); // Save activities after loading from file
        populateFilters();
        renderActivities();
    } catch (error) {
        console.log('Arquivo não encontrado. Por favor, carregue um arquivo.');
    }
}

// Parse activities from text content
function parseActivitiesFromText(text) {
    const lines = text.split('\n').filter(line => line.trim());
    activities = [];

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split('\t');
        if (parts.length < 6) continue;

        const activity = {
            id: parts[0]?.trim() || '',
            name: parts[1]?.trim() || '',
            summary: parts[2]?.trim() || '',
            startDate: parts[3]?.trim() || '',
            endDate: parts[4]?.trim() || '',
            calendar: parts[5]?.trim() || '',
            uniqueKey: generateUniqueKey(parts[0]?.trim() || '', parts[1]?.trim() || '') // Stable unique identifier
        };

        if (activity.id && activity.name) {
            activities.push(activity);
        }
    }
}

// Generate stable unique key based on ID and activity name
// This ensures progressos are preserved when file is reloaded with new lines
function generateUniqueKey(id, name) {
    // Normalize name: remove accents, lowercase, remove special chars
    const normalizedName = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9]/g, '_'); // Replace special chars with underscore

    return `${id}_${normalizedName}`;
}

// Handle file upload
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Request password
    const password = prompt('Digite a senha para carregar o arquivo:');

    // Verify password
    if (password !== '789512') {
        alert('Senha incorreta! O arquivo não será carregado.');
        // Clear the file input
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        parseActivitiesFromText(e.target.result);
        saveActivities(); // Save activities to localStorage/Firebase
        populateFilters();
        renderActivities();
        alert('Arquivo carregado com sucesso! As atividades foram salvas.');
    };
    reader.readAsText(file);
}

// Populate filter dropdowns
function populateFilters() {
    const filterID = document.getElementById('filterID');
    const uniqueIDs = [...new Set(activities.map(a => a.id))].sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        return numA - numB;
    });

    filterID.innerHTML = '<option value="">Todos os IDs</option>';
    uniqueIDs.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `ID ${id}`;
        filterID.appendChild(option);
    });
}

// Get progress for an activity
function getProgress(uniqueKey) {
    const data = progressData[uniqueKey];
    if (!data) return 0;

    // Support both old format (number) and new format (object with current/history)
    if (typeof data === 'number') {
        return data;
    }

    return data.current || 0;
}

// Set progress for an activity
function setProgress(uniqueKey, value, skipRender = false) {
    const oldValue = getProgress(uniqueKey);
    const newValue = Math.max(0, Math.min(100, value));

    // Initialize progress data if needed
    if (typeof progressData[uniqueKey] === 'number' || !progressData[uniqueKey]) {
        progressData[uniqueKey] = {
            current: oldValue,
            history: oldValue > 0 ? [{ value: oldValue, timestamp: new Date().toISOString() }] : []
        };
    }

    // Only record if value changed
    if (newValue !== oldValue) {
        progressData[uniqueKey].current = newValue;
        progressData[uniqueKey].history.push({
            value: newValue,
            timestamp: new Date().toISOString()
        });
    }

    // Save to Firebase if logged in, otherwise save to localStorage
    if (typeof currentUser !== 'undefined' && currentUser) {
        saveProgressToFirestore(uniqueKey, progressData[uniqueKey]);
    } else {
        saveProgressData();
    }

    if (!skipRender) {
        updateActivityProgress(uniqueKey);
    }
}

// Update only the specific activity's progress display
function updateActivityProgress(uniqueKey) {
    const progress = getProgress(uniqueKey);

    // Find the activity item in DOM
    const activityItem = document.querySelector(`.activity-item[data-key="${uniqueKey}"]`);
    if (!activityItem) return;

    // Update progress value display
    const progressValue = activityItem.querySelector('.progress-value');
    if (progressValue) {
        progressValue.textContent = `${progress}%`;
    }

    // Update progress bar width
    const progressBar = activityItem.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }

    // Update completed class
    if (progress === 100) {
        activityItem.classList.add('completed');
    } else {
        activityItem.classList.remove('completed');
    }

    // Update section stats (find the activity's ID and update its section)
    const activity = activities.find(a => a.uniqueKey === uniqueKey);
    if (activity) {
        updateSectionStats(activity.id);
    }

    // Update global stats
    updateStats();
}

// Update section statistics without re-rendering
function updateSectionStats(id) {
    const sectionActivities = activities.filter(a => a.id === id);
    const sectionProgress = calculateSectionProgress(sectionActivities);
    const completed = sectionActivities.filter(a => getProgress(a.uniqueKey) === 100).length;

    // Find all section elements with this ID
    const sections = document.querySelectorAll('.activity-section');
    sections.forEach(section => {
        const sectionId = section.querySelector('.section-id');
        if (sectionId && sectionId.textContent === id) {
            const progressEl = section.querySelector('.section-progress');
            const countEl = section.querySelector('.section-count');

            if (progressEl) {
                progressEl.textContent = `${sectionProgress}%`;
            }
            if (countEl) {
                countEl.textContent = `${completed}/${sectionActivities.length} concluídas`;
            }
        }
    });
}

// Increment progress
function incrementProgress(uniqueKey) {
    const current = getProgress(uniqueKey);
    setProgress(uniqueKey, current + 1);
}

// Decrement progress
function decrementProgress(uniqueKey) {
    const current = getProgress(uniqueKey);
    setProgress(uniqueKey, current - 1);
}

// Reset all progress
function resetAllProgress() {
    if (confirm('Tem certeza que deseja resetar o progresso de TODAS as atividades? Esta ação não pode ser desfeita.')) {
        progressData = {};
        saveProgressData();
        renderActivities();
    }
}

// Normalize text for search (remove accents and convert to lowercase)
function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// Filter activities
function filterActivities() {
    const filterSearchValue = document.getElementById('filterSearch').value;
    const filterIDValue = document.getElementById('filterID').value;
    const filterStatusValue = document.getElementById('filterStatus').value;

    return activities.filter(activity => {
        // Filter by search text
        if (filterSearchValue) {
            const searchNormalized = normalizeText(filterSearchValue);
            const activityNameNormalized = normalizeText(activity.name);

            if (!activityNameNormalized.includes(searchNormalized)) {
                return false;
            }
        }

        // Filter by ID
        if (filterIDValue && activity.id !== filterIDValue) {
            return false;
        }

        // Filter by status
        if (filterStatusValue) {
            const progress = getProgress(activity.uniqueKey);
            if (filterStatusValue === 'completed' && progress !== 100) return false;
            if (filterStatusValue === 'inProgress' && (progress === 0 || progress === 100)) return false;
            if (filterStatusValue === 'notStarted' && progress !== 0) return false;
        }

        return true;
    });
}

// Group activities by ID
function groupActivitiesByID(activitiesList) {
    const grouped = {};

    activitiesList.forEach(activity => {
        if (!grouped[activity.id]) {
            grouped[activity.id] = [];
        }
        grouped[activity.id].push(activity);
    });

    return grouped;
}

// Calculate section progress
function calculateSectionProgress(activitiesList) {
    if (activitiesList.length === 0) return 0;

    const totalProgress = activitiesList.reduce((sum, activity) => {
        return sum + getProgress(activity.uniqueKey);
    }, 0);

    return Math.round(totalProgress / activitiesList.length);
}

// Calculate overall statistics
function calculateStats() {
    const total = activities.length;
    const completed = activities.filter(a => getProgress(a.uniqueKey) === 100).length;
    const totalProgress = activities.reduce((sum, a) => sum + getProgress(a.uniqueKey), 0);
    const overallProgress = total > 0 ? Math.round(totalProgress / total) : 0;

    return { total, completed, overallProgress };
}

// Update statistics display
function updateStats() {
    const stats = calculateStats();

    document.getElementById('totalActivities').textContent = stats.total;
    document.getElementById('completedActivities').textContent = stats.completed;
    document.getElementById('overallProgress').textContent = `${stats.overallProgress}%`;
}

// Render activities
function renderActivities() {
    const container = document.getElementById('activitiesContainer');
    const filteredActivities = filterActivities();

    container.innerHTML = '';

    if (filteredActivities.length === 0) {
        container.innerHTML = `
            <div class="activity-section">
                <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
                    <p style="font-size: 1.1rem;">Nenhuma atividade encontrada com os filtros selecionados.</p>
                </div>
            </div>
        `;
        updateRecordNavigator(0, 0, 0);
        updateStats();
        return;
    }

    // Ensure currentRecordIndex is within bounds
    if (currentRecordIndex >= filteredActivities.length) {
        currentRecordIndex = Math.max(0, filteredActivities.length - itemsPerPage);
    }
    if (currentRecordIndex < 0) {
        currentRecordIndex = 0;
    }

    // Calculate which records to show (5 at a time)
    const endIndex = Math.min(currentRecordIndex + itemsPerPage, filteredActivities.length);
    const activitiesToShow = filteredActivities.slice(currentRecordIndex, endIndex);

    // Render each activity in the current page
    activitiesToShow.forEach(activity => {
        const sectionEl = document.createElement('div');
        sectionEl.className = 'activity-section';

        const progress = getProgress(activity.uniqueKey);
        const completed = progress === 100 ? 1 : 0;
        const mainActivityForSection = activities.find(a => a.id === activity.id && a.summary === 'SIM');
        const sectionTitle = mainActivityForSection ? mainActivityForSection.name : `Grupo ${activity.id}`;

        sectionEl.innerHTML = `
            <div class="section-header">
                <div class="section-id">${activity.id}</div>
                <div class="section-title">
                    <h2>${sectionTitle}</h2>
                    <p>Atividade individual</p>
                </div>
                <div class="section-stats">
                    <div class="section-progress">${progress}%</div>
                    <div class="section-count">${completed ? 'Concluída' : 'Em andamento'}</div>
                </div>
            </div>
            <div class="activities-list">
                ${renderActivity(activity)}
            </div>
        `;

        container.appendChild(sectionEl);
    });

    // Update record navigator
    updateRecordNavigator(currentRecordIndex + 1, endIndex, filteredActivities.length);

    updateStats();
    attachEventListeners();
}

// Calculate expected progress based on dates and calendar hours
function calculateExpectedProgress(activity) {
    try {
        // Parse dates (format: DD/MM/YYYY)
        const [startDay, startMonth, startYear] = activity.startDate.split('/').map(Number);
        const [endDay, endMonth, endYear] = activity.endDate.split('/').map(Number);

        const startDate = new Date(startYear, startMonth - 1, startDay);
        const endDate = new Date(endYear, endMonth - 1, endDay);
        const currentDate = new Date();

        // If current date is before start date, expected progress is 0%
        if (currentDate < startDate) {
            return 0;
        }

        // If current date is after end date, expected progress is 100%
        if (currentDate > endDate) {
            return 100;
        }

        // Calculate total hours in the project (calendar hours)
        const calendarHours = parseFloat(activity.calendar) || 24;

        // Calculate elapsed hours since start
        const totalMilliseconds = endDate - startDate;
        const elapsedMilliseconds = currentDate - startDate;

        // Calculate expected progress percentage
        const expectedProgress = (elapsedMilliseconds / totalMilliseconds) * 100;

        return Math.round(Math.min(100, Math.max(0, expectedProgress)));
    } catch (error) {
        console.error('Error calculating expected progress:', error);
        return 0;
    }
}

// Render individual activity
function renderActivity(activity) {
    const progress = getProgress(activity.uniqueKey);
    const expectedProgress = calculateExpectedProgress(activity);
    const isCompleted = progress === 100;

    // Get history for timeline markers
    const progressHistory = progressData[activity.uniqueKey]?.history || [];
    const timelineMarkers = progressHistory.map(entry => {
        const date = new Date(entry.timestamp);
        const dateStr = date.toLocaleDateString('pt-BR');
        const timeStr = date.toLocaleTimeString('pt-BR');
        return `<div class="timeline-marker" 
                     style="left: ${entry.value}%" 
                     title="${entry.value}% em ${dateStr} às ${timeStr}">
                </div>`;
    }).join('');

    return `
        <div class="activity-item ${isCompleted ? 'completed' : ''}" data-key="${activity.uniqueKey}">
            <div class="activity-header">
                <div class="activity-info">
                    <div class="activity-name">${activity.name}</div>
                    <div class="activity-meta">
                        ${activity.summary !== 'SIM' && activity.summary !== 'NÃO' ?
            `<span class="meta-item">📝 ${activity.summary}</span>` : ''}
                        <span class="meta-item">📅 ${activity.startDate} - ${activity.endDate}</span>
                        <span class="meta-item">📆 ${activity.calendar} horas</span>
                    </div>
                </div>
                <div class="controls">
                    <button class="btn-control decrement" data-key="${activity.uniqueKey}" data-action="decrement">
                        ▼
                    </button>
                    <div class="progress-display">
                        <div class="progress-value">${progress}%</div>
                    </div>
                    <button class="btn-control increment" data-key="${activity.uniqueKey}" data-action="increment">
                        ▲
                    </button>
                </div>
            </div>
            <div class="progress-bars-wrapper">
                <div class="progress-bar-row">
                    <span class="progress-label">Real:</span>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${progress}%; background: linear-gradient(90deg, var(--primary), var(--accent));"></div>
                        ${timelineMarkers}
                    </div>
                    <span class="progress-percentage">${progress}%</span>
                </div>
                <div class="progress-bar-row">
                    <span class="progress-label">Previsto:</span>
                    <div class="progress-bar-container">
                        <div class="progress-bar expected" style="width: ${expectedProgress}%"></div>
                    </div>
                    <span class="progress-percentage">${expectedProgress}%</span>
                </div>
            </div>
        </div>
    `;
}

// Attach event listeners to dynamically created elements
function attachEventListeners() {
    document.querySelectorAll('.btn-control').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-key');
            const action = e.currentTarget.getAttribute('data-action');

            if (action === 'increment') {
                incrementProgress(key);
            } else if (action === 'decrement') {
                decrementProgress(key);
            }
        });
    });
}

// Navigate to previous record
function previousRecord() {
    const filteredActivities = filterActivities();
    if (currentRecordIndex > 0) {
        currentRecordIndex = Math.max(0, currentRecordIndex - itemsPerPage);
        renderActivities();
    }
}

// Navigate to next record
function nextRecord() {
    const filteredActivities = filterActivities();
    if (currentRecordIndex + itemsPerPage < filteredActivities.length) {
        currentRecordIndex += itemsPerPage;
        renderActivities();
    }
}

// Update record navigator display
function updateRecordNavigator(startNumber, endNumber, totalNumber) {
    const recordInfo = document.getElementById('recordInfo');
    const prevButton = document.getElementById('prevRecord');
    const nextButton = document.getElementById('nextRecord');

    if (totalNumber === 0) {
        recordInfo.textContent = 'NENHUM REGISTRO';
        prevButton.disabled = true;
        nextButton.disabled = true;
    } else {
        recordInfo.textContent = `REGISTROS ${startNumber}-${endNumber} de ${totalNumber}`;
        nextButton.disabled = endNumber >= totalNumber;
    }
}

// ====== TAB MANAGEMENT ======

function showActivitiesTab() {
    document.getElementById('activitiesTab').classList.add('active');
    document.getElementById('sCurveTab').classList.remove('active');
    document.getElementById('activitiesTabContent').classList.remove('hidden');
    document.getElementById('sCurveTabContent').classList.add('hidden');
}

function showSCurveTab() {
    document.getElementById('activitiesTab').classList.remove('active');
    document.getElementById('sCurveTab').classList.add('active');
    document.getElementById('activitiesTabContent').classList.add('hidden');
    document.getElementById('sCurveTabContent').classList.remove('hidden');
    renderSCurve();
}

// ====== S-CURVE CALCULATIONS ======

function calculateSCurveData() {
    if (activities.length === 0) {
        return { dates: [], planned: [], real: [] };
    }

    // Get date range from all activities
    let minDate = null;
    let maxDate = null;

    activities.forEach(activity => {
        const start = parseDate(activity.startDate);
        const end = parseDate(activity.endDate);

        if (!minDate || start < minDate) minDate = start;
        if (!maxDate || end > maxDate) maxDate = end;
    });

    if (!minDate || !maxDate) {
        return { dates: [], planned: [], real: [] };
    }

    // Generate date array (daily intervals)
    const dates = [];
    const planned = [];
    const real = [];

    const currentDate = new Date(minDate);
    const dayMs = 24 * 60 * 60 * 1000;

    while (currentDate <= maxDate) {
        dates.push(new Date(currentDate));
        currentDate.setTime(currentDate.getTime() + dayMs);
    }

    // Calculate cumulative progress for each date
    const totalActivities = activities.length;

    dates.forEach(date => {
        let plannedCount = 0;
        let realCount = 0;

        activities.forEach(activity => {
            const start = parseDate(activity.startDate);
            const end = parseDate(activity.endDate);
            const progress = getProgress(activity.uniqueKey);

            // Planned: activity should be complete if date >= end date
            if (date >= end) {
                plannedCount++;
            } else if (date >= start && date < end) {
                // Partial completion based on time elapsed
                const totalTime = end.getTime() - start.getTime();
                const elapsed = date.getTime() - start.getTime();
                const ratio = elapsed / totalTime;
                plannedCount += ratio;
            }

            // Real: based on actual progress
            realCount += progress / 100;
        });

        planned.push((plannedCount / totalActivities) * 100);
        real.push((realCount / totalActivities) * 100);
    });

    return { dates, planned, real };
}

// ====== S-CURVE RENDERING ======

function renderSCurve() {
    const canvas = document.getElementById('sCurveChart');
    if (!canvas) return;

    const { dates, planned, real } = calculateSCurveData();

    if (dates.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '16px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('Nenhum dado disponível para gerar a Curva S', canvas.width / 2, canvas.height / 2);
        return;
    }

    // Format dates for labels
    const labels = dates.map(date => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${day}/${month}`;
    });

    // Destroy existing chart if exists
    if (sCurveChart) {
        sCurveChart.destroy();
    }

    // Create new chart
    const ctx = canvas.getContext('2d');
    sCurveChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Planejado',
                    data: planned,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 2,
                    pointHoverRadius: 6
                },
                {
                    label: 'Real',
                    data: real,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 2,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(148, 163, 184, 0.2)',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 6,
                    usePointStyle: true,
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + '%';
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.1)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#94a3b8',
                        maxRotation: 45,
                        minRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 20
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    grid: {
                        color: 'rgba(148, 163, 184, 0.1)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#94a3b8',
                        callback: function (value) {
                            return value + '%';
                        }
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// ====== FIREBASE AUTH HANDLERS ======

// Handle Login
async function handleLogin() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const errorMsg = document.getElementById('errorMessage');

    // Validate inputs
    if (!email || !password) {
        errorMsg.textContent = 'Por favor, preencha email e senha.';
        errorMsg.classList.add('show');
        return;
    }

    errorMsg.classList.remove('show');

    // Attempt login
    const result = await loginUser(email, password);

    if (!result.success) {
        if (result.error === 'pending-approval') {
            errorMsg.textContent = '⏳ Sua conta está aguardando aprovação do administrador.';
        } else {
            errorMsg.textContent = getErrorMessage(result.error);
        }
        errorMsg.classList.add('show');
    }
}

// Handle Register
async function handleRegister() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const errorMsg = document.getElementById('errorMessage');

    // Validate inputs
    if (!email || !password) {
        errorMsg.textContent = 'Por favor, preencha email e senha.';
        errorMsg.classList.add('show');
        return;
    }

    if (password.length < 6) {
        errorMsg.textContent = 'A senha deve ter pelo menos 6 caracteres.';
        errorMsg.classList.add('show');
        return;
    }

    errorMsg.classList.remove('show');

    // Attempt registration
    const result = await registerUser(email, password);

    if (!result.success) {
        errorMsg.textContent = getErrorMessage(result.error);
        errorMsg.classList.add('show');
    } else if (result.needsApproval) {
        // Show success message indicating approval needed
        errorMsg.textContent = '✅ Conta criada! Aguarde aprovação do administrador para fazer login.';
        errorMsg.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        errorMsg.style.borderColor = 'rgba(16, 185, 129, 0.2)';
        errorMsg.style.color = '#10b981';
        errorMsg.classList.add('show');

        // Clear fields
        document.getElementById('emailInput').value = '';
        document.getElementById('passwordInput').value = '';

        // Reset error style after 5 seconds
        setTimeout(() => {
            errorMsg.style.backgroundColor = '';
            errorMsg.style.borderColor = '';
            errorMsg.style.color = '';
            errorMsg.classList.remove('show');
        }, 5000);
    }
}

// Handle Logout
async function handleLogout() {
    if (confirm('Deseja realmente sair?')) {
        const result = await logoutUser();
        if (!result.success) {
            alert('Erro ao fazer logout: ' + result.error);
        }
    }
}

// Get user-friendly error message
function getErrorMessage(error) {
    if (error.includes('user-not-found') || error.includes('wrong-password')) {
        return 'Email ou senha incorretos.';
    } else if (error.includes('email-already-in-use')) {
        return 'Este email já está cadastrado.';
    } else if (error.includes('invalid-email')) {
        return 'Email inválido.';
    } else if (error.includes('weak-password')) {
        return 'Senha muito fraca. Use pelo menos 6 caracteres.';
    } else if (error.includes('network-request-failed')) {
        return 'Erro de conexão. Verifique sua internet.';
    }
    return 'Erro: ' + error;
}

// Add Enter key support for login modal
document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');

    if (emailInput && passwordInput) {
        emailInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });

        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });
    }
});

// Helper function to parse dates (used in S-Curve calculations)
function parseDate(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return new Date();
}

// ====== ADMIN PANEL FUNCTIONS ======

// Open admin panel
async function openAdminPanel() {
    const modal = document.getElementById('adminModal');
    modal.style.display = 'flex';
    await loadPendingUsers();
}

// Close admin panel
function closeAdminPanel() {
    const modal = document.getElementById('adminModal');
    modal.style.display = 'none';
}

// Load pending users
async function loadPendingUsers() {
    const container = document.getElementById('pendingUsersList');
    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Carregando...</div>';

    try {
        const users = await getPendingUsers();

        if (users.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">✅</div>
                    <p>Nenhum usuário aguardando aprovação</p>
                </div>
            `;
            return;
        }

        container.innerHTML = users.map(user => `
            <div class="pending-user-item" data-uid="${user.uid}">
                <div class="user-info">
                    <div class="user-email">📧 ${user.email}</div>
                    <div class="user-date">Cadastrado em: ${new Date(user.createdAt?.seconds * 1000 || Date.now()).toLocaleString('pt-BR')}</div>
                </div>
                <div class="user-actions">
                    <button onclick="approveUserFromPanel('${user.uid}')" class="btn-approve">✅ Aprovar</button>
                    <button onclick="rejectUserFromPanel('${user.uid}')" class="btn-reject">❌ Rejeitar</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--error);">
                <p>Erro ao carregar usuários: ${error.message}</p>
            </div>
        `;
    }
}

// Approve user from panel
async function approveUserFromPanel(uid) {
    if (!confirm('Aprovar este usuário?')) return;

    try {
        await approveUser(uid);
        alert('✅ Usuário aprovado com sucesso!');
        await loadPendingUsers(); // Reload list
    } catch (error) {
        alert('Erro ao aprovar usuário: ' + error.message);
    }
}

// Reject user from panel
async function rejectUserFromPanel(uid) {
    if (!confirm('Rejeitar este usuário? Ele não será deletado, apenas mantido como não aprovado.')) return;

    try {
        await rejectUser(uid);
        alert('❌ Usuário rejeitado.');
        await loadPendingUsers(); // Reload list
    } catch (error) {
        alert('Erro ao rejeitar usuário: ' + error.message);
    }
}


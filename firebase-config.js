// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCHbAfwrAHmy4vmalS45d3lTKWJIxNhCcc",
    authDomain: "avancos.firebaseapp.com",
    projectId: "avancos",
    storageBucket: "avancos.firebasestorage.app",
    messagingSenderId: "32239214834",
    appId: "1:32239214834:web:f7377cf6d4ee012dbc706b"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Global variables
let currentUser = null;
let unsubscribeProgress = null;

// ====== AUTHENTICATION STATE ======

auth.onAuthStateChanged(async (user) => {
    currentUser = user;

    if (user) {
        // User is signed in
        console.log('User logged in:', user.email);
        hideLoginModal();
        updateUserDisplay(user);

        // Show admin button if user is admin
        const adminBtn = document.getElementById('adminBtn');
        if (adminBtn && user.email === 'engelmobile2020@gmail.com') {
            adminBtn.style.display = 'inline-block';
            document.body.classList.add('is-admin');
        } else if (adminBtn) {
            document.body.classList.remove('is-admin');
        }

        // SEMPRE carregar do Firestore ao logar para garantir sincronismo
        activities = []; // Limpar local antes de carregar nuvem
        await loadActivities();

        // Then load progress from SHARED global collection
        loadProgressFromFirestore();
        setupRealtimeSync();
    } else {
        // User is signed out
        console.log('User logged out');
        showLoginModal();
        updateUserDisplay(null);

        // Hide admin button
        const adminBtn = document.getElementById('adminBtn');
        if (adminBtn) {
            adminBtn.style.display = 'none';
        }

        // Unsubscribe from real-time updates
        if (unsubscribeProgress) {
            unsubscribeProgress();
            unsubscribeProgress = null;
        }

        // Load from localStorage instead
        loadProgressData();
        loadActivities(); // Tentar carregar local caso deslogado
    }
});

// ====== AUTH FUNCTIONS ======

// Login function
async function loginUser(email, password) {
    try {
        showSyncIndicator('Fazendo login...');
        const userCredential = await auth.signInWithEmailAndPassword(email, password);

        // Admin always allowed - skip approval check
        if (email === 'engelmobile2020@gmail.com') {
            hideSyncIndicator();
            return { success: true };
        }

        // Check if user is approved
        const isApproved = await checkUserApproval(userCredential.user.uid);

        if (!isApproved) {
            // Sign out if not approved
            await auth.signOut();
            hideSyncIndicator();
            return { success: false, error: 'pending-approval' };
        }

        hideSyncIndicator();
        return { success: true };
    } catch (error) {
        hideSyncIndicator();
        console.error('Login error:', error);
        return { success: false, error: error.message };
    }
}

// Register function
async function registerUser(email, password) {
    try {
        showSyncIndicator('Criando conta...');
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);

        // Create user record in Firestore
        await createUserRecord(userCredential.user);

        // Sign out immediately - user needs approval first
        await auth.signOut();

        hideSyncIndicator();
        return { success: true, needsApproval: true };
    } catch (error) {
        hideSyncIndicator();
        console.error('Register error:', error);
        return { success: false, error: error.message };
    }
}

// Logout function
async function logoutUser() {
    try {
        await auth.signOut();
        // Clear local data
        activities = [];
        progressData = {};
        weldsData = {};
        renderActivities();
        return { success: true };
    } catch (error) {
        console.error('Logout error:', error);
        return { success: false, error: error.message };
    }
}

// ====== USER APPROVAL FUNCTIONS ======

// Create user record in Firestore
async function createUserRecord(user) {
    try {
        await db.collection('users').doc(user.uid).set({
            email: user.email,
            approved: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedAt: null,
            approvedBy: null
        }, { merge: true });
        console.log('User record created:', user.email);
    } catch (error) {
        console.error('Error creating user record:', error);
        throw error;
    }
}

// Check if user is approved
async function checkUserApproval(userId) {
    try {
        const doc = await db.collection('users').doc(userId).get();
        if (!doc.exists) {
            console.log('User record not found');
            return false;
        }
        const isApproved = doc.data().approved === true;
        console.log(`User ${userId} approval status:`, isApproved);
        return isApproved;
    } catch (error) {
        console.error('Error checking approval:', error);
        return false;
    }
}

// Check if current user is admin
async function isAdmin() {
    if (!currentUser) return false;
    return currentUser.email === 'engelmobile2020@gmail.com';
}

// Get pending users (admin only)
async function getPendingUsers() {
    if (!await isAdmin()) {
        console.error('Access denied: not admin');
        return [];
    }

    try {
        const snapshot = await db.collection('users')
            .where('approved', '==', false)
            .get();

        const users = [];
        snapshot.forEach(doc => {
            users.push({
                uid: doc.id,
                ...doc.data()
            });
        });

        console.log('Pending users found:', users.length);
        return users;
    } catch (error) {
        console.error('Error getting pending users:', error);
        throw error;
    }
}

// Approve user (admin only)
async function approveUser(userId) {
    if (!await isAdmin()) {
        throw new Error('Access denied: not admin');
    }

    try {
        await db.collection('users').doc(userId).update({
            approved: true,
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedBy: currentUser.email
        });
        console.log(`User ${userId} approved`);
    } catch (error) {
        console.error('Error approving user:', error);
        throw error;
    }
}

// Reject user (admin only) - keeps as not approved
async function rejectUser(userId) {
    if (!await isAdmin()) {
        throw new Error('Access denied: not admin');
    }

    try {
        // Just log - user stays as approved: false
        console.log(`User ${userId} rejected (kept as not approved)`);
        // Optionally could delete the user or mark as rejected
    } catch (error) {
        console.error('Error rejecting user:', error);
        throw error;
    }
}

// ====== SHARED PROGRESS DATA (GLOBAL) ======

// Load progress data from Firestore (SHARED global collection)
async function loadProgressFromFirestore() {
    if (!currentUser) return;

    try {
        showSyncIndicator('Sincronizando dados...');
        // Load from SHARED global progress collection
        const snapshot = await db.collection('progress').get();

        progressData = {};
        snapshot.forEach((doc) => {
            progressData[doc.id] = doc.data();
        });

        renderActivities();
        hideSyncIndicator();
    } catch (error) {
        console.error('Error loading from Firestore:', error);
        hideSyncIndicator();
        // Fallback to localStorage
        loadProgressData();
    }
}

// Save progress to Firestore (SHARED global collection)
async function saveProgressToFirestore(key, data) {
    if (!currentUser) return;

    try {
        // Save to SHARED global progress collection
        await db.collection('progress').doc(key).set({
            ...data,
            lastUpdatedBy: currentUser.email,
            lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log(`Progress saved for ${key}`);
    } catch (error) {
        console.error('Error saving to Firestore:', error);
    }
}

// Setup realtime sync (SHARED global collection)
function setupRealtimeSync() {
    if (!currentUser) return;

    // Unsubscribe from previous listener if exists
    if (unsubscribeProgress) {
        unsubscribeProgress();
    }

    // Subscribe to SHARED global progress collection
    unsubscribeProgress = db.collection('progress')
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const key = change.doc.id;
                const data = change.doc.data();

                if (change.type === 'added' || change.type === 'modified') {
                    // Update local data
                    const currentValue = typeof progressData[key] === 'number' ? progressData[key] : progressData[key]?.current || 0;
                    const newValue = typeof data === 'number' ? data : data.current || 0;

                    if (currentValue !== newValue) {
                        progressData[key] = data;
                        updateActivityProgress(key);
                    }
                } else if (change.type === 'removed') {
                    delete progressData[key];
                    updateActivityProgress(key);
                }
            });
        }, (error) => {
            console.error('Realtime sync error:', error);
        });
}


// ====== UI HELPER FUNCTIONS ======

function showLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.add('show');
    }
}

function hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function updateUserDisplay(user) {
    const userDisplay = document.getElementById('userDisplay');
    const logoutBtn = document.getElementById('logoutBtn');

    if (user && userDisplay) {
        userDisplay.textContent = user.email;
        userDisplay.style.display = 'block';
        if (logoutBtn) logoutBtn.style.display = 'block';
    } else if (userDisplay) {
        userDisplay.textContent = '';
        userDisplay.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }
}

function showSyncIndicator(message = 'Sincronizando...') {
    let indicator = document.getElementById('syncIndicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'syncIndicator';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            color: white;
            padding: 12px 24px;
            border-radius: 12px;
            font-weight: 600;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(indicator);
    }
    indicator.textContent = message;
    indicator.style.display = 'block';
}

function hideSyncIndicator() {
    const indicator = document.getElementById('syncIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

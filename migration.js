// ====== MIGRATION SCRIPT ======
// Run this ONCE to migrate old data to new shared structure

async function migrateOldDataToShared() {
    if (!currentUser) {
        alert('Faça login como admin primeiro!');
        return;
    }

    if (!await isAdmin()) {
        alert('Apenas admin pode migrar dados!');
        return;
    }

    if (!confirm('Migrar dados antigos para estrutura compartilhada?\n\nIsso copiará TODOS os progressos da sua conta admin para a coleção global compartilhada.')) {
        return;
    }

    try {
        showSyncIndicator('Migrando dados...');

        // Get old progress from admin's personal collection
        const oldSnapshot = await db.collection('users')
            .doc(currentUser.uid)
            .collection('progress')
            .get();

        if (oldSnapshot.empty) {
            alert('Nenhum dado antigo encontrado para migrar.');
            hideSyncIndicator();
            return;
        }

        let migratedCount = 0;
        const batch = db.batch();

        oldSnapshot.forEach((doc) => {
            const data = doc.data();
            const key = doc.id;

            // Copy to new shared collection
            const newRef = db.collection('progress').doc(key);
            batch.set(newRef, {
                ...data,
                migratedFrom: currentUser.email,
                migratedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            migratedCount++;
        });

        await batch.commit();

        hideSyncIndicator();
        alert(`✅ Migração concluída!\n\n${migratedCount} atividades migradas com sucesso.\n\nAgora TODOS os usuários aprovados verão os mesmos dados!`);

        // Reload to show migrated data
        await loadProgressFromFirestore();

    } catch (error) {
        hideSyncIndicator();
        console.error('Migration error:', error);
        alert('Erro na migração: ' + error.message);
    }
}

// Add migration button to admin panel (call this after DOM loads)
function addMigrationButton() {
    if (!currentUser || currentUser.email !== 'engelmobile2020@gmail.com') {
        return;
    }

    // Check if button already exists
    if (document.getElementById('migrationBtn')) {
        return;
    }

    const userSection = document.querySelector('.user-section');
    const adminBtn = document.getElementById('adminBtn');
    if (userSection && adminBtn && adminBtn.parentNode === userSection) {
        const migrationBtn = document.createElement('button');
        migrationBtn.id = 'migrationBtn';
        migrationBtn.className = 'btn-admin';
        migrationBtn.textContent = '🔄 Migrar Dados';
        migrationBtn.onclick = migrateOldDataToShared;
        migrationBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';

        userSection.insertBefore(migrationBtn, adminBtn);
    }
}

// Auto-add button when user logs in as admin
setTimeout(() => {
    addMigrationButton();
}, 1000);

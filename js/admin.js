import { db, collection, query, where, getDocs, doc, updateDoc, orderBy } from './firebase-config.js';

export function extendAdmin(HamsterApp) {
    HamsterApp.prototype.renderAdminDashboard = function() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        container.innerHTML = `
            <div class="page-container" style="max-width: 800px; margin: 0 auto;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                    <button class="mobile-back-btn" onclick="app.renderSettingsPage()"><i data-lucide="chevron-left"></i></button>
                    <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: var(--danger);">Admin Portal</h1>
                </div>
                <div id="admin-reports-list" style="display: flex; flex-direction: column; gap: 16px;">
                    <div class="info-state">Loading reports...</div>
                </div>
            </div>
        `;
        lucide.createIcons();
        this.fetchAdminReports();
    };

    HamsterApp.prototype.fetchAdminReports = async function() {
        try {
            const q = query(collection(db, 'reports'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
            const snap = await getDocs(q);
            
            const container = document.getElementById('admin-reports-list');
            if(snap.empty) {
                container.innerHTML = `<div class="info-state"><i data-lucide="check-circle" style="width:40px;height:40px;margin-bottom:12px;color:#10b981;"></i><br>All clean! No pending reports.</div>`;
                lucide.createIcons();
                return;
            }

            let html = '';
            snap.docs.forEach(docSnap => {
                const data = docSnap.data();
                const reportId = docSnap.id;
                const date = data.createdAt ? new Date(data.createdAt.toMillis()).toLocaleString() : 'Unknown';
                
                let msgsHtml = (data.messages || []).map(m => {
                    const isTarget = m.senderId === data.targetId;
                    return `<div style="padding: 10px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; background: ${isTarget ? 'rgba(239, 68, 68, 0.1)' : 'var(--glass-bg)'}; border-left: 3px solid ${isTarget ? 'var(--danger)' : 'var(--text-secondary)'};">
                        <strong style="color: ${isTarget ? 'var(--danger)' : 'var(--text-primary)'}">${isTarget ? 'Targeted User' : 'Reporter'}:</strong> <span style="color: var(--text-secondary);">${m.text || '...'}</span>
                    </div>`;
                }).join('');

                html += `
                    <div class="glass-card" style="border: 1px solid var(--danger); padding: 20px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid var(--glass-border); padding-bottom: 12px;">
                            <span style="font-weight: 800; font-size: 16px; color: var(--danger); display: flex; align-items: center; gap: 8px;"><i data-lucide="flag"></i> Report Action Required</span>
                            <span style="font-size: 12px; font-weight: 600; color: var(--text-secondary); background: var(--app-bg); padding: 4px 8px; border-radius: 6px;">${date}</span>
                        </div>
                        <p style="font-size: 14px; margin-bottom: 16px; color: var(--text-primary);"><strong>Reason:</strong> <span style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; padding: 4px 8px; border-radius: 6px;">${data.reason}</span></p>
                        <div style="background: var(--app-bg); border-radius: 12px; padding: 16px; margin-bottom: 24px; max-height: 250px; overflow-y: auto;">
                            ${msgsHtml || 'No context.'}
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px;">
                            <button class="glass-btn" style="background: #3b82f6;" onclick="app.adminAction('${reportId}', '${data.targetId}', '1day')">Ban 24h</button>
                            <button class="glass-btn" style="background: #f59e0b;" onclick="app.adminAction('${reportId}', '${data.targetId}', '1week')">Ban 7d</button>
                            <button class="glass-btn" style="background: var(--danger);" onclick="app.adminAction('${reportId}', '${data.targetId}', 'forever')">Ban Permanent</button>
                            <button class="btn-ghost" onclick="app.adminAction('${reportId}', null, 'reject')">Reject</button>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
            lucide.createIcons({ node: container });
        } catch(e) { console.error(e); }
    };

    HamsterApp.prototype.adminAction = async function(reportId, targetId, action) {
        let confirmMsg = (action === 'reject') ? 'Reject this report?' : `Enforce ${action} ban on this user?`;
        this.showConfirm(this.lang === 'ar' ? 'تأكيد الإجراء' : 'Confirm Action', confirmMsg, async () => {
            try {
                if (action !== 'reject') {
                    let bannedUntil = null;
                    if (action === '1day') bannedUntil = Date.now() + 24 * 60 * 60 * 1000;
                    if (action === '1week') bannedUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
                    if (action === 'forever') bannedUntil = 'forever';
                    await updateDoc(doc(db, 'users', targetId), { bannedUntil });
                }
                await updateDoc(doc(db, 'reports', reportId), { status: action === 'reject' ? 'rejected' : 'resolved' });
                this.showAlert(this.lang === 'ar' ? 'نجاح' : 'Success', 'Action enforced.');
                this.fetchAdminReports();
            } catch(e) { this.showAlert('Error', 'Failed to enforce.'); }
        });
    };
}

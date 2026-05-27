import { db, collection, query, where, getDocs, setDoc, doc, updateDoc, writeBatch } from './firebase-config.js';

export function extendSettings(HamsterApp) {
    HamsterApp.prototype.renderProfilePage = function() {
        this.pendingProfileImage = null;
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        container.innerHTML = `
            <div class="page-container">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                    <button class="mobile-back-btn" onclick="app.handleNavigation('chats')"><i data-lucide="chevron-left"></i></button>
                    <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: var(--text-primary);">${this.t('profile')}</h1>
                </div>
                <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 32px;">
                    <label style="cursor: pointer; position: relative; flex-shrink: 0;">
                        <img id="prof-img-preview" src="${this.userData.photoURL}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-sm);">
                        <div style="position: absolute; bottom: 0; right: 0; background: var(--accent); color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);"><i data-lucide="camera" style="width: 14px;"></i></div>
                        <input type="file" accept="image/*" style="display: none;" onchange="app.handleImageUpload(event)">
                    </label>
                    <div style="overflow: hidden;">
                        <h2 style="margin: 0; font-size: 20px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.userData.displayName}</h2>
                        <span style="color: var(--text-secondary); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${this.user.email}</span>
                    </div>
                </div>
                <div class="form-group">
                    <label>${this.t('display_name')}</label>
                    <input type="text" id="prof-name" value="${this.userData.displayName}" maxlength="18" autocomplete="off">
                </div>
                <div class="form-group">
                    <label>${this.t('email_user_placeholder')}</label>
                    <input type="text" id="prof-user" value="${this.userData.username || ''}" placeholder="example: assem" autocomplete="off">
                </div>
                <button class="glass-btn" style="width: 100%; border-radius: 12px; padding: 14px; font-size: 15px; margin-top: 8px;" onclick="app.saveProfile()">${this.t('sync_profile')}</button>
                <div style="margin-top: 24px;">
                    <button class="btn-ghost" style="width: 100%; justify-content: space-between; padding: 16px; border-radius: 12px; display: flex; align-items: center; border: 1px solid var(--glass-border);" onclick="app.renderAboutPage()">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="info" style="width: 20px;"></i>
                            <span style="font-weight: 500;">${this.t('about_app')}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 18px; opacity: 0.5;"></i>
                    </button>
                </div>
                <hr style="margin: 32px 0; border: none; border-top: 1px solid var(--glass-border);">
                <button class="glass-btn" style="background: var(--danger); width: 100%; padding: 14px; border-radius: 12px; font-size: 15px;" onclick="app.logout()">${this.t('sign_out')}</button>
            </div>
        `;
        lucide.createIcons();
    };

    HamsterApp.prototype.handleImageUpload = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = 150;
                canvas.width = size;
                canvas.height = size;
                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;
                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
                this.pendingProfileImage = canvas.toDataURL('image/jpeg', 0.8);
                document.getElementById('prof-img-preview').src = this.pendingProfileImage;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    HamsterApp.prototype.saveProfile = async function() {
        const n = document.getElementById('prof-name').value.trim();
        const u = document.getElementById('prof-user').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!n || !u) return this.showAlert(this.lang === 'ar' ? 'تنبيه' : 'Alert', this.lang === 'ar' ? 'الحقول لا يمكن أن تكون فارغة.' : 'Fields cannot be empty.');
        if (n.length > 18) return this.showAlert(this.lang === 'ar' ? 'اسم طويل' : 'Name Too Long', this.lang === 'ar' ? 'يجب أن يكون الاسم 18 حرفاً كحد أقصى.' : 'Name must be 18 characters maximum.');
        if (u.length < 3) return this.showAlert(this.lang === 'ar' ? 'يوزرنيم قصير' : 'Too Short', this.lang === 'ar' ? 'يجب أن يكون اليوزرنيم 3 أحرف على الأقل.' : 'Username must be at least 3 characters.');
        try {
            if (u !== this.userData?.username) {
                const qCheck = query(collection(db, 'users'), where('username', '==', u));
                const checkSnap = await getDocs(qCheck);
                if (checkSnap.docs.some(d => d.id !== this.user.uid)) {
                    return this.showAlert(this.lang === 'ar' ? 'اليوزرنيم محجوز' : 'Username Taken', this.lang === 'ar' ? `"${u}" محجوز بالفعل، اختر يوزرنيم مختلف.` : `"${u}" is already taken.`);
                }
            }
            const payload = { displayName: n, username: u };
            if (this.pendingProfileImage) {
                payload.photoURL = this.pendingProfileImage;
                this.userData.photoURL = this.pendingProfileImage;
                this.pendingProfileImage = null;
            }
            await setDoc(doc(db, 'users', this.user.uid), payload, { merge: true });
            this.userData.displayName = n;
            this.userData.username = u;
            this.updateGlobalUserUI();
            const batch = writeBatch(db);
            this.allChats.forEach(chat => {
                if (chat.type === 'ai' || chat.id.endsWith('_ai')) return;
                const memberUpdate = { name: n, username: u };
                if (payload.photoURL) memberUpdate.photo = payload.photoURL;
                batch.set(doc(db, 'chats', chat.id), { memberData: { [this.user.uid]: memberUpdate } }, { merge: true });
            });
            
            try {
                await batch.commit();
            } catch (batchErr) {
                console.warn('Batch update for chats failed due to permissions, ignoring...', batchErr);
            }

            // Sync profile changes to user's active stories in the database
            try {
                const storiesQuery = query(collection(db, 'stories'), where('uid', '==', this.user.uid));
                const storiesSnap = await getDocs(storiesQuery);
                if (!storiesSnap.empty) {
                    const storiesBatch = writeBatch(db);
                    storiesSnap.forEach(storyDoc => {
                        const storyUpdate = { name: n };
                        if (payload.photoURL) storyUpdate.photo = payload.photoURL;
                        storiesBatch.update(storyDoc.ref, storyUpdate);
                    });
                    await storiesBatch.commit();
                }
            } catch (storyErr) {
                console.warn('Failed to update active stories on profile change, ignoring...', storyErr);
            }
            
            this.showAlert(this.lang === 'ar' ? 'تم التحديث' : 'Profile Synced', this.lang === 'ar' ? 'تم تحديث بيانات حسابك بنجاح.' : 'Profile updated successfully.');
        } catch (e) { 
            console.error(e); 
            this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Error', this.lang === 'ar' ? 'حدث خطأ أثناء المزامنة.' : 'An error occurred.'); 
        }
    };

    HamsterApp.prototype.renderAboutPage = function() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');
        container.innerHTML = `
            <div class="page-container" style="max-width: 500px; margin: 0 auto; padding-top: 10px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 40px;">
                    <button class="mobile-back-btn" onclick="app.renderProfilePage()"><i data-lucide="chevron-left"></i></button>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text-primary);">${this.t('about_app')}</h1>
                </div>
                <div style="text-align: center; margin-bottom: 48px;">
                    <div style="width: 100px; height: 100px; border-radius: 28px; background: white; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 20px 40px rgba(0,0,0,0.1); overflow: hidden;">
                        <img src="assets/logo.jpg" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <h2 style="margin: 0; font-size: 28px; font-weight: 800; color: var(--text-primary); text-align: center !important; display: block !important; direction: ltr !important; width: 100%;">Hamster Chat</h2>
                    <p style="margin: 8px auto 0; color: var(--text-secondary); font-size: 15px; opacity: 0.7; text-align: center !important; display: block !important; direction: ltr !important; width: 100%;">Version 1.0.0 stable</p>
                </div>
                <div style="background: var(--glass-panel); border-radius: 24px; padding: 24px; border: 1px solid var(--glass-border); margin-bottom: 24px;">
                    <h3 style="margin: 0 0 16px; font-size: 14px; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">${this.lang === 'ar' ? 'عن المطور' : 'Developer Info'}</h3>
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <img src="assets/me.jpg" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent);">
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 18px;">Assem Mohamed</div>
                            <div style="font-size: 13px; color: var(--text-secondary);">${this.lang === 'ar' ? 'مطور واجهات ومصمم تجربة مستخدم' : 'Frontend Developer & UI/UX Designer'}</div>
                        </div>
                    </div>
                    <a href="https://portfolio-for-assem.netlify.app" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 24px; background: var(--accent); color: white; padding: 14px; border-radius: 14px; text-decoration: none; font-weight: 700; font-size: 15px;">
                        <i data-lucide="external-link" style="width: 18px;"></i> ${this.lang === 'ar' ? 'زيارة معرض أعمالي' : 'Explore My Portfolio'}
                    </a>
                </div>
                <div style="text-align: center; color: var(--text-secondary); font-size: 13px; line-height: 1.6; opacity: 0.6; margin-top: 40px;">
                    &copy; ${new Date().getFullYear()} Tadfuq Company.<br>
                    ${this.lang === 'ar' ? 'تم التطوير بكل حب بواسطة عاصم محمد' : 'Designed & Built with ❤️ by Assem Mohamed'}
                </div>
            </div>
        `;
        lucide.createIcons();
    };

    HamsterApp.prototype.renderSettingsPage = function() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const showLastSeen = this.userData?.privacy?.showLastSeen !== false;
        const ghostMode = !!this.userData?.privacy?.ghostMode;
        const appLockEnabled = !!this.userData?.appLockPin;

        container.innerHTML = `
            <div class="page-container" style="max-height: 100%; overflow-y: auto; padding-bottom: 40px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                    <button class="mobile-back-btn" onclick="app.handleNavigation('chats')"><i data-lucide="chevron-left"></i></button>
                    <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: var(--text-primary);">${this.t('settings')}</h1>
                </div>
                <div class="form-group">
                    <label>${this.t('language')}</label>
                    <select id="lang-sel" onchange="app.setLang(this.value)">
                        <option value="en" ${this.lang === 'en' ? 'selected' : ''}>English</option>
                        <option value="ar" ${this.lang === 'ar' ? 'selected' : ''}>العربية</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>${this.t('app_theme')}</label>
                    <select id="theme-sel" onchange="app.setTheme(this.value)">
                        <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>${this.t('light_mode')}</option>
                        <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>${this.t('dark_mode')}</option>
                    </select>
                </div>
                <h3 style="font-size: 14px; text-transform: uppercase; color: var(--text-muted); margin: 24px 0 12px; letter-spacing: 0.5px;">Privacy & Security</h3>
                <div class="privacy-item">
                    <div class="privacy-info"><h4>${this.lang === 'ar' ? 'قفل التطبيق' : 'App Lock'}</h4><p>${this.lang === 'ar' ? 'حماية التطبيق برمز PIN' : 'Require PIN'}</p></div>
                    <div class="toggle-switch ${appLockEnabled ? 'active' : ''}" onclick="app.toggleAppLock()"></div>
                </div>
                <div class="privacy-item">
                    <div class="privacy-info"><h4>${this.lang === 'ar' ? 'آخر ظهور' : 'Last Seen'}</h4><p>${this.lang === 'ar' ? 'إظهار وقت تواجدك للآخرين' : 'Share last seen'}</p></div>
                    <div class="toggle-switch ${showLastSeen ? 'active' : ''}" onclick="app.togglePrivacy('showLastSeen')"></div>
                </div>
                <div class="privacy-item">
                    <div class="privacy-info"><h4>${this.lang === 'ar' ? 'وضع الشبح' : 'Ghost Mode'}</h4><p>${this.lang === 'ar' ? 'إخفاء علامة الصح الزرقاء' : 'Hide blue ticks'}</p></div>
                    <div class="toggle-switch ${ghostMode ? 'active' : ''}" onclick="app.togglePrivacy('ghostMode')"></div>
                </div>
                <div class="form-group" style="margin-top: 16px;">
                    <label>${this.lang === 'ar' ? 'تأثير الصوت (للخصوصية)' : 'Voice Effect (Privacy)'}</label>
                    <select id="voice-effect-sel" onchange="app.setVoiceEffect(this.value)">
                        <option value="none" ${this.userData?.settings?.voiceEffect === 'none' || !this.userData?.settings?.voiceEffect ? 'selected' : ''}>${this.lang === 'ar' ? 'صوتي الطبيعي' : 'My Voice'}</option>
                        <option value="deep" ${this.userData?.settings?.voiceEffect === 'deep' ? 'selected' : ''}>${this.lang === 'ar' ? 'صوت ضخم' : 'Deep Voice'}</option>
                        <option value="thin" ${this.userData?.settings?.voiceEffect === 'thin' ? 'selected' : ''}>${this.lang === 'ar' ? 'صوت رفيع' : 'Thin Voice'}</option>
                        <option value="distorted" ${this.userData?.settings?.voiceEffect === 'distorted' ? 'selected' : ''}>${this.lang === 'ar' ? 'صوت مشوه' : 'Distorted'}</option>
                    </select>
                </div>
                <h3 style="font-size: 14px; text-transform: uppercase; color: var(--text-muted); margin: 24px 0 12px; letter-spacing: 0.5px;">Chat Customization</h3>
                <div class="privacy-item" style="border: none;">
                    <div class="privacy-info"><h4>${this.lang === 'ar' ? 'خلفية المحادثة' : 'Chat Wallpaper'}</h4><p>${this.lang === 'ar' ? 'اختر صورة من جهازك' : 'Set custom image'}</p></div>
                    <label class="glass-btn" style="padding: 8px 16px; font-size: 13px; border-radius: 10px; cursor: pointer;">
                        <i data-lucide="image" style="width:16px; margin-right: 6px;"></i> ${this.lang === 'ar' ? 'رفع صورة' : 'Upload'}
                        <input type="file" accept="image/*" style="display: none;" onchange="app.handleWallpaperUpload(event)">
                    </label>
                </div>
                ${this.userData?.wallpaper ? `
                <div style="margin-top: 12px; position: relative; width: 100%; height: 120px; border-radius: 16px; overflow: hidden; border: 1px solid var(--glass-border);">
                    <img src="${this.userData.wallpaper}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.6;">
                    <button onclick="app.setWallpaper('')" style="position: absolute; top: 10px; right: 10px; background: rgba(239, 68, 68, 0.2); color: #ef4444; border: none; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;"><i data-lucide="trash-2" style="width:16px;"></i></button>
                    <div style="position: absolute; bottom: 10px; left: 15px; color: var(--text-primary); font-size: 12px; font-weight: 600;">Current Wallpaper</div>
                </div>
                ` : ''}
                <hr style="margin: 32px 0; border: none; border-top: 1px solid var(--glass-border);">
                <button class="glass-btn" style="width: 100%; border-radius: 12px; padding: 14px; font-size: 15px;" onclick="app.showAlert(app.lang === 'ar' ? 'تم الحفظ' : 'Preferences Saved', app.lang === 'ar' ? 'تم حفظ التفضيلات بنجاح.' : 'Settings updated successfully.')">${this.t('commit')}</button>
                ${(this.userData?.isAdmin || this.userData?.isadmin || this.userData?.privacy?.isadmin) ? `
                <div style="margin-top: 32px; border-top: 1px solid var(--glass-border); padding-top: 16px;">
                    <h3 style="color: var(--danger); margin-bottom: 12px; font-size: 14px; text-transform: uppercase; font-weight: 700; letter-spacing: 1px;">Admin Panel</h3>
                    <button class="glass-btn" style="width: 100%; border-radius: 12px; padding: 14px; font-size: 15px; background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="app.renderAdminDashboard()">
                        <i data-lucide="shield-alert" style="width: 18px; margin-right: 8px;"></i> Review Reports
                    </button>
                </div>
                ` : ''}
            </div>
        `;
        lucide.createIcons();
    };

    HamsterApp.prototype.toggleAppLock = async function() {
        if (this.userData?.appLockPin) {
            this.showConfirm(this.lang === 'ar' ? 'إلغاء قفل التطبيق' : 'Disable Lock', this.lang === 'ar' ? 'هل أنت متأكد؟' : 'Are you sure?', async () => {
                await updateDoc(doc(db, 'users', this.user.uid), { appLockPin: null });
                this.userData.appLockPin = null;
                localStorage.removeItem('hamster-lock-pin');
                this.renderSettingsPage();
            });
        } else {
            this.showPrompt(this.lang === 'ar' ? 'تعيين رمز قفل' : 'Set PIN', this.lang === 'ar' ? 'أدخل 4 أرقام:' : 'Enter 4 digits:', '', async (pin) => {
                if (pin && /^\d{4}$/.test(pin)) {
                    await updateDoc(doc(db, 'users', this.user.uid), { appLockPin: pin });
                    this.userData.appLockPin = pin;
                    localStorage.setItem('hamster-lock-pin', pin);
                    this.renderSettingsPage();
                } else {
                    this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Invalid', this.lang === 'ar' ? 'يجب أن يكون 4 أرقام.' : 'Must be 4 digits.');
                }
            });
        }
    };

    HamsterApp.prototype.loadWallpaper = function() {
        const saved = localStorage.getItem('hamster-wallpaper');
        if (saved) { if (!this.userData) this.userData = {}; this.userData.wallpaper = saved; }
    };

    HamsterApp.prototype.loadLock = function() {
        const saved = localStorage.getItem('hamster-lock-pin');
        if (saved) { if (!this.userData) this.userData = {}; this.userData.appLockPin = saved; }
    };

    HamsterApp.prototype.setWallpaper = async function(url) {
        if (!this.userData) this.userData = {};
        this.userData.wallpaper = url;
        localStorage.setItem('hamster-wallpaper', url);
        await updateDoc(doc(db, 'users', this.user.uid), { wallpaper: url });
        const area = document.getElementById('messages-area');
        if (area) area.style.backgroundImage = url ? `url(${url})` : 'none';
        this.renderSettingsPage();
    };

    HamsterApp.prototype.handleWallpaperUpload = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const maxWidth = 1280;
                let w = img.width, h = img.height;
                if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth; }
                canvas.width = w; canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                this.setWallpaper(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    HamsterApp.prototype.togglePrivacy = async function(key) {
        const newState = !this.userData?.privacy?.[key];
        const updateObj = {};
        updateObj[`privacy.${key}`] = newState;
        await updateDoc(doc(db, 'users', this.user.uid), updateObj);
        this.userData.privacy = { ...(this.userData.privacy || {}), [key]: newState };
        this.renderSettingsPage();
    };

    HamsterApp.prototype.setVoiceEffect = async function(effect) {
        if (!this.userData) this.userData = {};
        if (!this.userData.settings) this.userData.settings = {};
        this.userData.settings.voiceEffect = effect;
        await updateDoc(doc(db, 'users', this.user.uid), { 'settings.voiceEffect': effect });
    };
}

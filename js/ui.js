export function extendUI(HamsterApp) {
    HamsterApp.prototype.t = function(key) { 
        return this.strings[this.lang][key] || key; 
    };

    HamsterApp.prototype.updateStaticUI = function() {
        const search = document.getElementById('global-search');
        if (search) search.placeholder = this.t('search');

        if (this.renderTabs) this.renderTabs();
    };

    HamsterApp.prototype.loadLang = function() {
        const saved = localStorage.getItem('hamster-lang');
        if (saved) {
            this.lang = saved;
        } else {
            // First launch: detect device language
            const deviceLang = navigator.language || navigator.userLanguage || 'en';
            this.lang = deviceLang.startsWith('ar') ? 'ar' : 'en';
        }
        document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = this.lang;
        this.updateStaticUI();
    };

    HamsterApp.prototype.setLang = function(l) {
        this.lang = l;
        localStorage.setItem('hamster-lang', l);
        document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = l;
        this.updateStaticUI();
        this.handleNavigation(this.currentPage);
    };

    HamsterApp.prototype.loadTheme = function() {
        const savedTheme = localStorage.getItem('hamster-theme');
        let theme = 'light';
        if (savedTheme) {
            theme = savedTheme;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            theme = 'dark';
        }
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeColor(theme);
    };

    HamsterApp.prototype.setTheme = function(theme) {
        localStorage.setItem('hamster-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeColor(theme);
    };

    HamsterApp.prototype.updateThemeColor = function(theme) {
        const color = theme === 'dark' ? '#020617' : '#e2e8f0';
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', color);
    };

    HamsterApp.prototype.showAlert = function(title, message) {
        this.showDialog({ title, message, type: 'alert' });
    };

    HamsterApp.prototype.showConfirm = function(title, message, onConfirm) {
        this.showDialog({ title, message, type: 'confirm', onConfirm });
    };

    HamsterApp.prototype.showPrompt = function(title, message, defaultValue, onConfirm) {
        this.showDialog({ title, message, type: 'prompt', defaultValue, onConfirm });
    };

    HamsterApp.prototype.showDialog = function({ title, message, type, defaultValue = '', onConfirm = null }) {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';

        let icon = 'info';
        if (type === 'confirm') icon = 'help-circle';
        if (type === 'prompt') icon = 'edit-3';

        const isRTL = this.lang === 'ar';
        const okText = isRTL ? 'موافق' : 'Confirm';
        const cancelText = isRTL ? 'إلغاء' : 'Cancel';

        overlay.innerHTML = `
            <div class="dialog-card">
                <div class="dialog-icon"><i data-lucide="${icon}"></i></div>
                <h2>${title}</h2>
                <p>${message}</p>
                ${type === 'prompt' ? `<input type="text" id="dialog-input" class="dialog-input" value="${defaultValue}" autocomplete="off">` : ''}
                <div class="dialog-actions">
                    ${type !== 'alert' ? `<button class="dialog-btn secondary" id="dialog-cancel">${cancelText}</button>` : ''}
                    <button class="dialog-btn primary" id="dialog-confirm">${okText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        lucide.createIcons({ node: overlay });
        setTimeout(() => overlay.classList.add('active'), 10);

        const input = overlay.querySelector('#dialog-input');
        if (input) {
            setTimeout(() => input.focus(), 100);
            input.onkeydown = (e) => {
                if (e.key === 'Enter') overlay.querySelector('#dialog-confirm').click();
            };
        }

        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        };

        overlay.querySelector('#dialog-confirm').onclick = () => {
            const val = input ? input.value : true;
            close();
            if (onConfirm) onConfirm(val);
        };

        const cancelBtn = overlay.querySelector('#dialog-cancel');
        if (cancelBtn) cancelBtn.onclick = close;
    };

    HamsterApp.prototype.showModal = function(contentHTML, fullScreen = false) {
        const overlay = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        content.innerHTML = contentHTML;
        
        overlay.classList.remove('hidden');
        if (fullScreen) {
            overlay.classList.add('fullscreen');
            overlay.classList.add('active');
        } else {
            overlay.classList.remove('fullscreen');
            // Trigger browser reflow to ensure animation runs
            void overlay.offsetWidth;
            overlay.classList.add('active');
        }

        // Click outside to dismiss modal card
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                this.closeModal();
            }
        };
    };

    HamsterApp.prototype.closeModal = function() {
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('active');
        
        // Wait for CSS fade/scale animation (250ms) to complete before hiding
        setTimeout(() => {
            if (!overlay.classList.contains('active')) {
                overlay.classList.add('hidden');
                overlay.classList.remove('fullscreen');
            }
        }, 250);
        
        this.activeStoryId = null;
        if (this.storyTimeoutId) {
            clearTimeout(this.storyTimeoutId);
            this.storyTimeoutId = null;
        }
        this.isScheduledModalOpen = false;
    };

    HamsterApp.prototype.formatTime = function(seconds) {
        if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    HamsterApp.prototype.formatLastSeen = function(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const oneDay = 24 * 60 * 60 * 1000;
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

        const dDate = new Date(date).setHours(0, 0, 0, 0);
        const dNow = new Date(now).setHours(0, 0, 0, 0);
        const dDiff = Math.floor((dNow - dDate) / oneDay);

        if (dDiff === 0) {
            return (this.lang === 'ar' ? 'نشط منذ ' : 'Last seen ') + timeStr;
        } else if (dDiff === 1) {
            return (this.lang === 'ar' ? 'نشط أمس ' : 'Last seen yesterday ') + timeStr;
        } else if (dDiff < 7) {
            return (this.lang === 'ar' ? `نشط منذ ${dDiff} أيام ` : `Last seen ${dDiff} days ago `) + timeStr;
        } else {
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            return (this.lang === 'ar' ? 'نشط في ' : 'Last seen on ') + dateStr + ' ' + timeStr;
        }
    };

    HamsterApp.prototype.updateOnlineStatus = function() {
        const isOnline = navigator.onLine;
        let indicator = document.getElementById('offline-indicator');
        if (!isOnline) {
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'offline-indicator';
                indicator.style.cssText = `position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: rgba(239, 68, 68, 0.9); color: white; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 500; z-index: 9999; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 8px;`;
                indicator.innerHTML = '<i data-lucide="wifi-off" style="width: 14px; height: 14px;"></i> Working Offline';
                document.body.appendChild(indicator);
                if (window.lucide) lucide.createIcons({ node: indicator });
            }
        } else {
            if (indicator) indicator.remove();
        }
    };

    HamsterApp.prototype.checkInstallPrompt = function() {
        const isDismissed = localStorage.getItem('hamster-install-dismissed');
        if (isDismissed || !this.deferredPrompt) return;
        const prompt = document.getElementById('install-prompt');
        if (prompt) {
            const title = document.getElementById('prompt-title');
            const desc = document.getElementById('prompt-desc');
            const btns = document.querySelectorAll('#install-prompt button');
            if (this.lang === 'ar') {
                title.innerText = "تحميل تطبيق هامستر";
                desc.innerText = "ثبّت التطبيق لتجربة اتصال أفضل";
                btns[0].innerText = "لاحقاً";
                btns[1].innerText = "تنزيل الآن";
            }
            setTimeout(() => prompt.classList.add('visible'), 2000);
        }
    };

    HamsterApp.prototype.installApp = async function() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') this.dismissInstall();
        this.deferredPrompt = null;
    };

    HamsterApp.prototype.dismissInstall = function() {
        const prompt = document.getElementById('install-prompt');
        if (prompt) prompt.classList.remove('visible');
        localStorage.setItem('hamster-install-dismissed', 'true');
    };
}

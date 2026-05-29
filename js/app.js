import {
    auth, db, googleProvider,
    onAuthStateChanged, signInWithPopup, signOut,
    collection, onSnapshot, query, orderBy, where, doc, getDoc, setDoc, serverTimestamp, getDocs, writeBatch, addDoc, updateDoc, deleteDoc, limit, arrayUnion, arrayRemove
} from './firebase-config.js';

import { extendAuth } from './auth.js';
import { extendCalls } from './calls.js';
import { extendAI } from './ai.js';
import { extendStories } from './stories.js?v=1';
import { extendUI } from './ui.js';
import { extendSettings } from './settings.js?v=1';
import { extendAdmin } from './admin.js';
import { extendMedia } from './media.js';
import { extendE2E } from './E2E.js';

class HamsterApp {
    constructor() {
        this.user = null;
        this.userData = null;
        this.activeChatId = null;
        this.allChats = [];
        this.currentMessages = {};
        this.messagesUnsubscribe = null;
        this.lastGroupCreationTime = 0; // Throttling group creation
        this.isCreatingGroup = false; // Loading state
        this.currentPinInput = "";
        this.isLocked = false;
        this.deferredPrompt = null;
        this.lang = 'en';
        this.currentChatTab = 'all'; // Active sidebar filter tab: 'all', 'groups', 'unread'
        this.messageLimit = 50; // Pagination
        this.isSearching = false;
        this.typingTimeout = null;
        this.strings = {
            en: {
                chats: "Chats", messages: "Messages", stories: "Stories", archive: "Archived", settings: "Preferences",
                profile: "Account", search: "Search accounts and chats...", no_records: "No records.",
                zero_archived: "Zero archived chats.", no_convs: "No conversations.",
                msg_placeholder: "Message...", start_context: "Start Context", private_chat: "Private Chat",
                group_chat: "Group Chat", email_user_placeholder: "Username",
                dismiss: "Dismiss", connect: "Connect", group_name_placeholder: "Group Designation",
                members_placeholder: "Members (emails or usernames, comma separated)",
                form_group: "Form Group", sync_profile: "Sync Profile", sign_out: "Sign Out of App",
                app_theme: "App Theme", light_mode: "Light Mode", dark_mode: "Dark Mode",
                desktop_notifs: "Enable Desktop Notifications", read_receipts: "Broadcast Read Meta-Receipts",
                commit: "Commit Changes", language: "Language", english: "English", arabic: "Arabic",
                display_name: "Display Name", about_app: "About Hamster Chat",
                tab_all: "All", tab_groups: "Groups", tab_unread: "Unread"
            },
            ar: {
                chats: "المحادثات", messages: "الرسائل", stories: "القصص", archive: "الأرشيف", settings: "التفضيلات",
                profile: "الحساب", search: "ابحث عن الحسابات والمحادثات...", no_records: "لا توجد نتائج.",
                zero_archived: "لا توجد محادثات مؤرشفة.", no_convs: "لا توجد محادثات.",
                msg_placeholder: "اكتب رسالة...", start_context: "بدء محادثة", private_chat: "محادثة خاصة",
                group_chat: "مجموعة", email_user_placeholder: "البريد الإلكتروني أو اسم المستخدم",
                dismiss: "إلغاء", connect: "اتصال", group_name_placeholder: "اسم المجموعة",
                members_placeholder: "الأعضاء (ايميلات أو يوزرات، مفصولة بفاصلة)",
                form_group: "إنشاء المجموعة", sync_profile: "تحديث الحساب", sign_out: "تسجيل الخروج",
                app_theme: "سمة التطبيق", light_mode: "الوضع المضيء", dark_mode: "الوضع الليلي",
                desktop_notifs: "تفعيل تنبيهات المتصفح", read_receipts: "بث مؤشرات قراءة الرسائل",
                commit: "حفظ التغييرات", language: "اللغة", english: "English", arabic: "العربية",
                display_name: "الاسم المستعار", about_app: "عن التطبيق",
                tab_all: "الكل", tab_groups: "المجموعات", tab_unread: "غير المقروءة"
            }
        };

        // --- Agora RTC ---
        this.agoraAppId = "a32681136c9e4af6a429b8cb9b96cd98"; // User should set this in the file
        this.agoraClient = null;
        this.localAudioTrack = null;
        this.localVideoTrack = null;
        this.isVideoCall = false;
        this.activeCallListener = null;
        this.currentCallData = null;

        this._typingBubbleVisible = false;
        this._notifiedMessages = {};
        this._firstChatLoadDone = false;
        this.init();
    }

    init() {
        this.loadLang();
        this.loadTheme();
        this.loadWallpaper();
        this.loadLock();

        // Show Lock Screen immediately if PIN exists in localStorage
        if (this.userData?.appLockPin) {
            this.showLockScreen();
        }

        this.setupAuth();
        this.setupNav();
        this.setupSearch();
        this.renderTabs();
        this.handleNavigation('chats');
        lucide.createIcons();
        this.registerSW();

        // Check for join group link
        const urlParams = new URLSearchParams(window.location.search);
        const joinGroupId = urlParams.get('joinGroup');
        if (joinGroupId) {
            this.handleGroupJoinLink(joinGroupId);
        }

        // Global Protection: Prevent right-click downloading on all images
        document.addEventListener('contextmenu', (e) => {
            if (e.target.tagName === 'IMG') e.preventDefault();
        }, false);

        // Global click listener to close dropdowns
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#attachment-menu') && this.closeAttachmentMenu) {
                this.closeAttachmentMenu();
            }
        });

        // Reset unread count when window becomes visible again and we are inside a chat
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.activeChatId && !this.userData?.privacy?.ghostMode) {
                const activeChat = this.allChats?.find(c => c.id === this.activeChatId);
                if (activeChat && activeChat.unreadCounts && activeChat.unreadCounts[this.user.uid] > 0) {
                    activeChat.unreadCounts[this.user.uid] = 0;
                    updateDoc(doc(db, 'chats', this.activeChatId), {
                        [`unreadCounts.${this.user.uid}`]: 0
                    }).catch(e => console.error("Reset unread error on visibility", e));
                }
            }
        });
    }

    registerSW() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('SW: Registered', reg))
                    .catch(err => console.error('SW: Registration failed', err));
            });
        }

        // Online/Offline detection
        window.addEventListener('online', () => this.updateOnlineStatus());
        window.addEventListener('offline', () => this.updateOnlineStatus());
        this.updateOnlineStatus();

        // PWA Install Prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.checkInstallPrompt();
        });
    }

    // Note: Online status moved to ui.js


    // Note: Image methods moved to media.js

    // Note: Localization methods moved to ui.js

    updateStaticUI() {
        const search = document.getElementById('global-search');
        if (search) search.placeholder = this.t('search');
    }

    // Note: Theme methods moved to ui.js


    // Note: Auth methods moved to auth.js

    // --- Core Navigation ---
    setupNav() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (btn.dataset.page) {
                    this.handleNavigation(btn.dataset.page);
                }
            });
        });

        const avatarBtn = document.getElementById('current-user-avatar');
        if (avatarBtn) {
            avatarBtn.addEventListener('click', () => {
                this.handleNavigation('profile');
            });
        }

        const mobileAvatarBtn = document.getElementById('mobile-user-avatar');
        if (mobileAvatarBtn) {
            mobileAvatarBtn.addEventListener('click', () => {
                this.handleNavigation('profile');
            });
        }

        const actionBtn = document.getElementById('main-action-btn');
        if (actionBtn) {
            actionBtn.onclick = () => {
                if (this.currentPage === 'chats' || this.currentPage === 'archive') {
                    this.showNewChatModal();
                }
            };
        }
    }

    handleNavigation(page) {
        this.currentPage = page;
        this.closeMobileOverlay(); // Close any active overlays when switching nav
        document.body.setAttribute('data-page', page);

        // Trigger animation for sidebar
        const sidebarList = document.getElementById('sidebar-list');
        if (sidebarList) {
            sidebarList.style.animation = 'none';
            sidebarList.offsetHeight; /* trigger reflow */
            sidebarList.style.animation = 'page-slide-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
        }

        document.querySelectorAll('.nav-item').forEach(b => {
            if (b.dataset.page) b.classList.toggle('active', b.dataset.page === page);
        });

        const title = document.getElementById('page-title');
        if (title) {
            title.innerText = this.t(page);
            title.style.margin = '0'; // Fix pushed avatar issue
        }

        const sidebarTabs = document.querySelector('.sidebar-tabs');
        if (sidebarTabs) {
            if (page === 'chats') {
                sidebarTabs.classList.remove('hidden');
            } else {
                sidebarTabs.classList.add('hidden');
            }
        }

        const emptyState = document.getElementById('empty-state');
        const mainActionBtn = document.getElementById('main-action-btn');

        if (page === 'chats' || page === 'archive') {
            mainActionBtn.classList.remove('hidden');
            if (!this.activeChatId) {
                emptyState.classList.remove('hidden');
            } else {
                emptyState.classList.add('hidden');
                document.getElementById('chat-window').classList.remove('hidden');
            }
            this.renderFilteredChats();
        } else if (page === 'stories') {
            mainActionBtn.classList.add('hidden');
            this.renderStoriesPage();
        } else if (page === 'settings') {
            mainActionBtn.classList.add('hidden');
            this.renderSettingsPage();
        } else if (page === 'profile') {
            mainActionBtn.classList.add('hidden');
            this.renderProfilePage();
        }
    }

    closeMobileOverlay() {
        if (this.partnerUnsubscribe) {
            this.partnerUnsubscribe();
            this.partnerUnsubscribe = null;
        }
        if (this._typingBubbleUnsub) {
            this._typingBubbleUnsub();
            this._typingBubbleUnsub = null;
        }
        this._typingBubbleVisible = false;
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('page-content').classList.add('hidden');
        this.activeChatId = null;
        document.querySelectorAll('.chat-card').forEach(c => c.classList.remove('active'));
    }

    updateGlobalUserUI() {
        if (!this.user) return;
        const imgHTML = `<img src="${this.userData?.photoURL || this.user.photoURL}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;

        const container = document.getElementById('current-user-avatar');
        if (container) container.innerHTML = imgHTML;

        const mobileContainer = document.getElementById('mobile-user-avatar');
        if (mobileContainer) mobileContainer.innerHTML = imgHTML;
    }

    setupSearch() {
        const searchInput = document.getElementById('global-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.renderFilteredChats();
            });
        }
    }

    renderTabs() {
        const container = document.getElementById('sidebar-tabs-container');
        if (!container) return;

        const customFolders = JSON.parse(localStorage.getItem('hamster_custom_folders') || '[]');

        const isRTL = this.lang === 'ar';
        const allText = this.t('tab_all');
        const groupsText = this.t('tab_groups');

        const unreadCount = this.totalUnreadCount || 0;
        const unreadText = unreadCount > 0 ? `${this.t('tab_unread')} (${unreadCount})` : this.t('tab_unread');

        let html = `
            <button class="sidebar-tab ${this.currentChatTab === 'all' ? 'active' : ''}" data-tab="all" id="tab-all-btn">${allText}</button>
            <button class="sidebar-tab ${this.currentChatTab === 'groups' ? 'active' : ''}" data-tab="groups" id="tab-groups-btn">${groupsText}</button>
            <button class="sidebar-tab ${this.currentChatTab === 'unread' ? 'active' : ''}" data-tab="unread" id="tab-unread-btn">${unreadText}</button>
        `;

        // Render custom tabs
        customFolders.forEach(folder => {
            const isActive = this.currentChatTab === folder.id ? 'active' : '';
            html += `
                <button class="sidebar-tab ${isActive}" data-tab="${folder.id}" title="${isRTL ? 'اضغط مطولاً لحذف المجلد' : 'Long press to delete folder'}" id="tab-${folder.id}">
                    ${folder.name}
                </button>
            `;
        });

        // Plus button to add custom tabs
        html += `
            <button class="sidebar-tab" id="tab-add-custom-btn" title="${isRTL ? 'إضافة مجلد مخصص' : 'Add custom folder'}" style="padding: 5px 8px;">
                <i data-lucide="plus" style="width: 13px; height: 13px;"></i>
            </button>
        `;

        container.innerHTML = html;
        if (window.lucide) lucide.createIcons({ node: container });

        // Bind event listeners
        container.querySelectorAll('.sidebar-tab').forEach(btn => {
            if (btn.id === 'tab-add-custom-btn') {
                btn.addEventListener('click', () => this.showAddFolderModal());
                return;
            }

            const tabId = btn.dataset.tab;
            btn.addEventListener('click', () => {
                this.currentChatTab = tabId;
                this.renderTabs();
                this.renderFilteredChats();
            });

            // Long press / Right-click to delete custom folders
            if (tabId && tabId.startsWith('custom_')) {
                // Right click
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.confirmDeleteFolder(tabId);
                });

                // Long press for mobile
                let pressTimer;
                btn.addEventListener('touchstart', (e) => {
                    pressTimer = setTimeout(() => {
                        this.confirmDeleteFolder(tabId);
                    }, 800);
                });
                btn.addEventListener('touchend', () => clearTimeout(pressTimer));
                btn.addEventListener('touchmove', () => clearTimeout(pressTimer));
            }
        });
    }

    async showAddFolderModal() {
        const isRTL = this.lang === 'ar';
        const title = isRTL ? 'مجلد جديد' : 'New Folder';
        const msg = isRTL ? 'أدخل اسم المجلد الجديد:' : 'Enter the new folder name:';

        this.showPrompt(title, msg, '', async (name) => {
            if (!name || !name.trim()) return;

            // Gather all available chats to choose from
            const chats = this.allChats.filter(c => c.id !== this.user.uid + '_ai');
            if (chats.length === 0) {
                this.showAlert(isRTL ? 'لا توجد محادثات' : 'No Chats', isRTL ? 'يجب أن تبدأ محادثة واحدة على الأقل أولاً!' : 'You must start at least one conversation first!');
                return;
            }

            // Let's build a beautiful custom selection modal!
            const modalHTML = `
                <div style="text-align: center; width: 100%; direction: ${isRTL ? 'rtl' : 'ltr'};">
                    <h2 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: white;">${isRTL ? 'تخصيص المجلد' : 'Customize Folder'}</h2>
                    <p style="margin: 0 0 18px; font-size: 13px; color: rgba(255, 255, 255, 0.65); line-height: 1.4; text-align: center;">${isRTL ? `اختر المحادثات التي تريد تضمينها في المجلد "${name.trim()}":` : `Select conversations to include in "${name.trim()}":`}</p>
                    
                    <div class="scrollbar-hidden" style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; padding-right: 4px; text-align: ${isRTL ? 'right' : 'left'};">
                        ${chats.map(c => {
                const partner = this.getChatPartner(c);
                return `
                                <label style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 14px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                                        <img src="${partner.photo || 'https://i.pravatar.cc/150'}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                                        <span style="font-size: 14px; font-weight: 600; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${partner.name}</span>
                                    </div>
                                    <input type="checkbox" name="folder-chat-select" value="${c.id}" style="width: 16px; height: 16px; margin: 0; padding: 0; flex-shrink: 0; align-self: center; accent-color: var(--accent); cursor: pointer; transform: scale(0.85); transform-origin: center center;">
                                </label>
                            `;
            }).join('')}
                    </div>

                    <div style="display: flex; gap: 12px;">
                        <button onclick="app.closeModal()" style="flex: 1; padding: 12px; border-radius: 14px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.05); color: white; cursor: pointer; font-size: 13.5px; font-weight: 600;">
                            ${isRTL ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button id="confirm-custom-folder-btn" style="flex: 1; padding: 12px; border-radius: 14px; border: none; background: var(--accent); color: white; cursor: pointer; font-size: 13.5px; font-weight: 700; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                            ${isRTL ? 'إنشاء' : 'Create'}
                        </button>
                    </div>
                </div>
            `;

            this.showModal(modalHTML);

            document.getElementById('confirm-custom-folder-btn').addEventListener('click', () => {
                const checkedBoxes = document.querySelectorAll('input[name="folder-chat-select"]:checked');
                const selectedChatIds = Array.from(checkedBoxes).map(cb => cb.value);

                if (selectedChatIds.length === 0) {
                    this.showAlert(isRTL ? 'تنبيه' : 'Alert', isRTL ? 'يرجى اختيار محادثة واحدة على الأقل!' : 'Please select at least one chat!');
                    return;
                }

                // Save custom folder
                let customFolders = JSON.parse(localStorage.getItem('hamster_custom_folders') || '[]');
                const newFolder = {
                    id: 'custom_' + Date.now(),
                    name: name.trim(),
                    chatIds: selectedChatIds
                };
                customFolders.push(newFolder);
                localStorage.setItem('hamster_custom_folders', JSON.stringify(customFolders));

                this.closeModal();
                this.currentChatTab = newFolder.id;
                this.renderTabs();
                this.renderFilteredChats();

                this.showAlert(isRTL ? 'نجاح' : 'Success', isRTL ? `تم إنشاء مجلد "${name.trim()}" بنجاح!` : `Folder "${name.trim()}" created successfully!`);
            });
        });
    }

    confirmDeleteFolder(folderId) {
        const isRTL = this.lang === 'ar';
        const customFolders = JSON.parse(localStorage.getItem('hamster_custom_folders') || '[]');
        const folder = customFolders.find(f => f.id === folderId);
        if (!folder) return;

        const title = isRTL ? 'حذف المجلد' : 'Delete Folder';
        const msg = isRTL ? `هل أنت متأكد من حذف المجلد "${folder.name}"؟` : `Are you sure you want to delete the folder "${folder.name}"?`;

        this.showConfirm(title, msg, () => {
            const updated = customFolders.filter(f => f.id !== folderId);
            localStorage.setItem('hamster_custom_folders', JSON.stringify(updated));
            if (this.currentChatTab === folderId) {
                this.currentChatTab = 'all';
            }
            this.renderTabs();
            this.renderFilteredChats();
        });
    }

    // --- Chat System Logic ---
    listenForChats() {
        const q = query(
            collection(db, 'chats'),
            where('memberIds', 'array-contains', this.user.uid),
            orderBy('updatedAt', 'desc')
        );

        onSnapshot(q, async (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Track modified chats for notifications
            const modifiedChatIds = [];
            snapshot.docChanges().forEach(change => {
                if (change.type === 'modified' || change.type === 'added') {
                    modifiedChatIds.push(change.doc.id);
                }
            });

            // Async decrypt last message for sidebar preview
            docs = await Promise.all(docs.map(async chat => {
                if (chat.lastMessage && chat.lastMessage.isE2E) {
                    try {
                        const decrypted = await this.decryptMessagePayload(chat.lastMessage);
                        if (decrypted.decrypted) {
                            let previewText = "";
                            if (decrypted.image) {
                                previewText = this.lang === 'ar' ? '📷 صورة' : '📷 Image';
                            } else if (decrypted.audio) {
                                previewText = this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message';
                            } else if (decrypted.gifUrl) {
                                previewText = 'GIF';
                            } else {
                                previewText = decrypted.text || chat.lastMessage.text;
                            }
                            chat.lastMessage.text = previewText;
                        }
                    } catch (e) { }
                }
                return chat;
            }));

            // Inject Hamster AI
            const aiId = this.user.uid + '_ai';
            if (!docs.find(c => c.id === aiId)) {
                docs.unshift({
                    id: aiId,
                    type: 'ai',
                    updatedAt: { toMillis: () => Date.now() },
                    memberIds: [this.user.uid, 'hamster_ai_bot'],
                    memberData: {
                        [this.user.uid]: { name: this.userData?.displayName || 'User', photo: this.userData?.photoURL },
                        'hamster_ai_bot': { name: 'Hamster AI', photo: 'assets/logo.jpg' }
                    },
                    lastMessage: { text: this.lang === 'ar' ? 'أهلاً! أنا المساعد الذكي هامستر.' : 'Hello! I am Hamster AI assistant.' }
                });
            }

            // Process In-App Notifications
            if (this._firstChatLoadDone) {
                docs.forEach(chat => {
                    if (modifiedChatIds.includes(chat.id) && chat.id !== this.activeChatId && chat.lastMessage && chat.lastMessage.senderId && chat.lastMessage.senderId !== this.user.uid) {
                        const msgTimestamp = chat.lastMessage.createdAt?.toMillis ? chat.lastMessage.createdAt.toMillis() : Date.now();
                        const lastNotified = this._notifiedMessages?.[chat.id] || 0;
                        
                        // Prevent duplicate notifications and ignore old messages (30 sec window)
                        if (msgTimestamp > lastNotified && (Date.now() - msgTimestamp) < 30000) {
                            if (!this._notifiedMessages) this._notifiedMessages = {};
                            this._notifiedMessages[chat.id] = msgTimestamp;
                            this.showInAppNotification(chat);
                        }
                    }
                });
            }
            this._firstChatLoadDone = true;

            // Calculate total unread chats count
            const totalUnread = docs.reduce((acc, chat) => {
                const isArchived = chat.archivedBy && chat.archivedBy.includes(this.user.uid);
                let count = chat.unreadCounts?.[this.user.uid] || 0;

                // Reset unread count if we are actively viewing this chat
                if (chat.id === this.activeChatId && count > 0 && document.visibilityState === 'visible' && !this.userData?.privacy?.ghostMode) {
                    count = 0;
                    chat.unreadCounts[this.user.uid] = 0;
                    updateDoc(doc(db, 'chats', chat.id), {
                        [`unreadCounts.${this.user.uid}`]: 0
                    }).catch(e => console.error("Reset unread error", e));
                }

                if (isArchived) return acc;
                return acc + (count > 0 ? 1 : 0);
            }, 0);

            this.totalUnreadCount = totalUnread;
            this.renderTabs();

            this.allChats = docs;
            this.renderFilteredChats();
        });
    }

    renderFilteredChats() {
        if (this.currentPage !== 'chats' && this.currentPage !== 'archive') return;

        let displayChats = this.allChats;

        if (this.currentPage === 'archive') {
            displayChats = displayChats.filter(c => c.archivedBy && c.archivedBy.includes(this.user.uid));
        } else {
            displayChats = displayChats.filter(c => !c.archivedBy || !c.archivedBy.includes(this.user.uid));

            // Apply folder tab filtering
            if (this.currentChatTab === 'groups') {
                displayChats = displayChats.filter(c => c.type === 'group');
            } else if (this.currentChatTab === 'unread') {
                displayChats = displayChats.filter(c => (c.unreadCounts?.[this.user.uid] || 0) > 0);
            } else if (this.currentChatTab && this.currentChatTab.startsWith('custom_')) {
                const customFolders = JSON.parse(localStorage.getItem('hamster_custom_folders') || '[]');
                const activeFolder = customFolders.find(f => f.id === this.currentChatTab);
                if (activeFolder) {
                    displayChats = displayChats.filter(c => activeFolder.chatIds.includes(c.id));
                }
            }
        }

        const queryText = document.getElementById('global-search')?.value.toLowerCase();
        if (queryText) {
            displayChats = displayChats.filter(c => {
                if (c.type === 'group') return c.name.toLowerCase().includes(queryText);
                const partner = this.getChatPartner(c);
                return partner.name.toLowerCase().includes(queryText) ||
                    (partner.email && partner.email.toLowerCase().includes(queryText)) ||
                    (partner.username && partner.username.toLowerCase().includes(queryText));
            });
        }

        const container = document.getElementById('sidebar-list');
        if (displayChats.length === 0 && !queryText) {
            let msg = this.t('no_convs');
            if (this.currentPage === 'archive') msg = this.t('zero_archived');
            container.innerHTML = `<div class="info-state">${msg}</div>`;
            return;
        }

        let html = displayChats.map(chat => {
            const partner = this.getChatPartner(chat);
            const active = chat.id === this.activeChatId ? 'active' : '';

            const typingUsers = Object.keys(chat.typing || {}).filter(uid => uid !== this.user.uid && chat.typing[uid] === true);
            const isTyping = typingUsers.length > 0;
            const lastMsg = isTyping ? (this.lang === 'ar' ? 'يكتب الآن...' : 'Typing...') : (chat.lastMessage?.text || "Started conversation");

            const unreadCount = chat.unreadCounts?.[this.user.uid] || 0;
            const badgeHTML = unreadCount > 0 && chat.id !== this.activeChatId ? `<div class="unread-badge">${unreadCount > 99 ? '+99' : unreadCount}</div>` : '';

            // Check for user story
            const partnerId = chat.type === 'group' ? null : chat.memberIds.find(id => id !== this.user.uid);
            let partnerStoryIds = [];
            if (partnerId && this.allStories) {
                partnerStoryIds = this.allStories.filter(s => s.uid === partnerId).map(s => s.id);
            }
            const hasStory = partnerStoryIds.length > 0;
            const storyAvatarStyle = hasStory ? 'border: 2px solid var(--accent); padding: 2px; cursor: pointer;' : '';
            const storyAvatarClick = hasStory ? `onclick="app.viewStory('${partnerStoryIds[0]}'); event.stopPropagation();"` : '';

            return `
                <div class="chat-card ${active}" onclick="app.selectChat('${chat.id}')">
                    <img src="${partner.photo || 'https://i.pravatar.cc/150'}" class="card-avatar" style="${storyAvatarStyle}" ${storyAvatarClick}>
                    <div class="card-body">
                        <div class="card-top">
                            <h4>${partner.name}</h4>
                            ${badgeHTML}
                        </div>
                        <p class="${isTyping ? 'typing-indicator' : ''}">${lastMsg}</p>
                    </div>
                </div>
            `;
        }).join('');

        if (queryText) {
            this.searchGlobalUsers(queryText, container, html);
        } else {
            container.innerHTML = html;
        }

        if (this.updateStoriesBadge) this.updateStoriesBadge();
    }

    async searchGlobalUsers(queryText, container, existingHTML) {
        if (queryText.length < 2) {
            container.innerHTML = existingHTML || `<div class="info-state">${this.t('no_records')}</div>`;
            return;
        }

        const q = query(
            collection(db, 'users'),
            where('username', '>=', queryText),
            where('username', '<=', queryText + '\uf8ff')
        );

        const snap = await getDocs(q);
        const users = snap.docs.map(d => d.data()).filter(u => u.uid !== this.user.uid);

        let globalHTML = '';
        if (users.length > 0) {
            globalHTML = `
                <div style="padding: 12px 16px; font-size: 12px; color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Global Search</div>
                ${users.map(u => `
                    <div class="chat-card" onclick="app.startPrivateChat('${u.uid}')">
                        <img src="${u.photoURL || 'https://i.pravatar.cc/150'}" class="card-avatar">
                        <div class="card-body">
                            <div class="card-top">
                                <h4>@${u.username}</h4>
                            </div>
                            <p>${u.displayName || 'Hamster User'}</p>
                        </div>
                    </div>
                `).join('')}
            `;
        }

        if (!existingHTML && users.length === 0) {
            container.innerHTML = `<div class="info-state">${this.t('no_records')}</div>`;
        } else {
            container.innerHTML = existingHTML + globalHTML;
        }
    }

    async startPrivateChat(partnerId) {
        // Check if chat already exists
        const existing = this.allChats.find(c => c.type !== 'group' && c.memberIds.includes(partnerId));
        if (existing) {
            this.selectChat(existing.id);
            document.getElementById('global-search').value = '';
            this.renderFilteredChats();
            return;
        }

        // Create new chat
        const partnerSnap = await getDoc(doc(db, 'users', partnerId));
        const partnerData = partnerSnap.data();

        const chatId = [this.user.uid, partnerId].sort().join('_');
        const chatData = {
            id: chatId,
            type: 'direct',
            memberIds: [this.user.uid, partnerId],
            memberData: {
                [this.user.uid]: { name: this.userData.displayName, photo: this.userData.photoURL, username: this.userData.username },
                [partnerId]: { name: partnerData.displayName, photo: partnerData.photoURL, username: partnerData.username }
            },
            updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, 'chats', chatId), chatData);
        document.getElementById('global-search').value = '';
        this.selectChat(chatId);
    }

    getChatPartner(chat) {
        if (chat.type === 'group') {
            return { name: chat.name, photo: chat.photo || 'https://ui-avatars.com/api/?name=Group&background=random' };
        }
        const partnerId = chat.memberIds.find(id => id !== this.user.uid);

        if (partnerId === 'hamster_ai_bot' || chat.type === 'ai') {
            return { name: 'Hamster AI', photo: 'assets/logo.jpg' };
        }

        if (!partnerId) return { name: 'Note to self', photo: this.userData?.photoURL || '' }; // self chat
        return chat.memberData?.[partnerId] || { name: 'Unknown User', photo: '' };
    }

    async selectChat(chatId) {
        this.activeChatId = chatId;
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        // Reset unread count (only if NOT in ghost mode)
        if (!this.userData?.privacy?.ghostMode && chat.unreadCounts && chat.unreadCounts[this.user.uid] > 0) {
            chat.unreadCounts[this.user.uid] = 0;
            updateDoc(doc(db, 'chats', chatId), {
                [`unreadCounts.${this.user.uid}`]: 0
            }).catch(e => console.error("Reset unread error", e));
        }

        this.renderFilteredChats(); // updates active class

        const chatWindow = document.getElementById('chat-window');
        document.getElementById('page-content').classList.add('hidden');
        chatWindow.classList.remove('hidden');

        // Apply wallpaper if exists
        const messagesArea = document.getElementById('messages-area');
        if (messagesArea) {
            const wall = this.userData?.wallpaper || '';
            messagesArea.style.backgroundImage = wall ? `url(${wall})` : 'none';
        }

        const partner = this.getChatPartner(chat);
        const isArchived = chat.archivedBy && chat.archivedBy.includes(this.user.uid);
        const archiveIcon = isArchived ? 'package-open' : 'archive';
        const archiveTitle = isArchived ? 'Unarchive' : 'Archive';

        const blockedBy = chat.blockedBy || [];
        const amIBlocked = blockedBy.length > 0;

        const isAI = chatId === this.user.uid + '_ai';

        let inputAreaHTML = `
            <div class="input-area">
                <div style="display: flex; flex-direction: column; gap: 8px; position: relative;" id="input-area-inner">
                    <div id="reply-to-placeholder"></div>
                    <div id="scheduled-messages-placeholder"></div>
                    <div id="gif-picker-container" class="hidden" style="background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 12px; padding: 10px; max-height: 250px; overflow-y: auto; position: absolute; bottom: calc(100% + 10px); left: 0; right: 0; z-index: 100;">
                        <input type="text" id="gif-search" placeholder="${this.lang === 'ar' ? 'بحث عن ملصقات...' : 'Search stickers...'}" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--glass-bg); color: var(--text-primary); margin-bottom: 10px;" oninput="app.searchGiphy(this.value, '${chatId}')">
                        <div id="gif-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px;"></div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <form id="msg-form" class="input-container" style="flex: 1;">
                            <input type="text" id="msg-input" placeholder="${this.t('msg_placeholder')}" autocomplete="off" oninput="app.handleTyping('${chatId}')">
                            ${!isAI ? `
                            <div style="position: relative; display: flex; align-items: center;">
                                <button type="button" onclick="app.toggleAttachmentMenu(event)" style="background: none; border: none; color: var(--text-secondary); flex-shrink: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; margin-right: 4px;" title="Attach">
                                    <i data-lucide="paperclip" style="width: 20px;"></i>
                                </button>
                                <div id="attachment-menu" class="hidden" style="position: absolute; bottom: 50px; right: 0; background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 20px; padding: 12px; box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.3); z-index: 101; display: flex; flex-direction: row; gap: 6px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); animation: popup-appear 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; transform-origin: bottom right;" onclick="event.stopPropagation()">
                                    <label class="attachment-item">
                                        <div class="icon-circle" style="background: rgba(59, 130, 246, 0.12);">
                                            <i data-lucide="image" style="width: 20px; height: 20px; color: #3b82f6;"></i>
                                        </div>
                                        <span>${this.lang === 'ar' ? 'صورة' : 'Image'}</span>
                                        <input type="file" accept="image/*" style="display: none;" onchange="app.handleChatImageUpload(event, '${chatId}'); app.closeAttachmentMenu();">
                                    </label>
                                    <button type="button" class="attachment-item" onclick="app.toggleGifPicker('${chatId}'); app.closeAttachmentMenu();">
                                        <div class="icon-circle" style="background: rgba(245, 158, 11, 0.12);">
                                            <i data-lucide="smile" style="width: 20px; height: 20px; color: #f59e0b;"></i>
                                        </div>
                                        <span>${this.lang === 'ar' ? 'ملصق' : 'Sticker'}</span>
                                    </button>
                                    <button type="button" class="attachment-item" onclick="app.showScheduleMessageModal('${chatId}'); app.closeAttachmentMenu();">
                                        <div class="icon-circle" style="background: rgba(139, 92, 246, 0.12);">
                                            <i data-lucide="clock" style="width: 20px; height: 20px; color: #8b5cf6;"></i>
                                        </div>
                                        <span>${this.lang === 'ar' ? 'جدولة' : 'Schedule'}</span>
                                    </button>
                                    <button type="button" class="attachment-item" onclick="app.openCanvasPad('${chatId}'); app.closeAttachmentMenu();">
                                        <div class="icon-circle" style="background: rgba(236, 72, 153, 0.12);">
                                            <i data-lucide="palette" style="width: 20px; height: 20px; color: #ec4899;"></i>
                                        </div>
                                        <span>${this.lang === 'ar' ? 'لوحة رسم' : 'Sketch'}</span>
                                    </button>
                                    <button type="button" class="attachment-item" onclick="app.startInChatDrawing('${chatId}'); app.closeAttachmentMenu();">
                                        <div class="icon-circle" style="background: rgba(20, 184, 166, 0.12);">
                                            <i data-lucide="pen-tool" style="width: 20px; height: 20px; color: #14b8a6;"></i>
                                        </div>
                                        <span>${this.lang === 'ar' ? 'رسم الشات' : 'Draw'}</span>
                                    </button>
                                    ${chat.type === 'group' ? `
                                    <button type="button" class="attachment-item" onclick="app.showPollModal('${chatId}'); app.closeAttachmentMenu();">
                                        <div class="icon-circle" style="background: rgba(16, 185, 129, 0.12);">
                                            <i data-lucide="bar-chart-2" style="width: 20px; height: 20px; color: #10b981;"></i>
                                        </div>
                                        <span>${this.lang === 'ar' ? 'استطلاع' : 'Poll'}</span>
                                    </button>
                                    ` : ''}
                                </div>
                            </div>
                            <button type="button" id="voice-btn" style="background: none; border: none; color: var(--text-secondary); flex-shrink: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer;" onclick="app.startRecording()">
                                <i data-lucide="mic" style="width: 20px;"></i>
                            </button>
                            ` : ''}
                        </form>
                        <button type="button" onclick="app.handleSendMessage('${chatId}')" style="background: linear-gradient(135deg, var(--accent), var(--accent-light)); color: white; border: none; width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(109, 40, 217, 0.35); flex-shrink: 0; transform: ${this.lang === 'ar' ? 'scaleX(-1)' : 'none'};">
                            <i data-lucide="send" style="width: 20px;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        if (amIBlocked) {
            const blockMsg = this.lang === 'ar' ? 'نم حظر هذه المحادثة' : 'This conversation is blocked';
            inputAreaHTML = `
                <div class="input-area" style="justify-content: center; opacity: 0.8;">
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 14px; background: rgba(0,0,0,0.05); padding: 12px 24px; border-radius: 12px; font-weight: 500;">
                        <i data-lucide="lock" style="width: 16px;"></i>
                        ${blockMsg}
                    </div>
                </div>
            `;
        }

        const typingUsers = Object.keys(chat.typing || {}).filter(uid => uid !== this.user.uid && chat.typing[uid] === true);
        const isTyping = typingUsers.length > 0;
        const statusText = isTyping ? (this.lang === 'ar' ? 'يكتب الآن...' : 'Typing...') : (chat.type === 'group' ? 'Group Space' : (partner.status === 'online' ? (this.lang === 'ar' ? 'متصل الآن' : 'Online') : ''));

        chatWindow.innerHTML = `
            <header class="chat-header">
                <div style="display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; ${isAI ? '' : 'cursor: pointer;'}" ${isAI ? '' : `onclick="app.renderChatInfo('${chatId}')"`}>
                    <button class="mobile-back-btn" onclick="event.stopPropagation(); app.closeMobileOverlay()"><i data-lucide="chevron-left"></i></button>
                    <img src="${partner.photo}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-left: 4px;">
                    <div style="display: flex; flex-direction: column; justify-content: center; min-width: 0; margin-left: 8px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <h3 style="font-size: 15px; font-weight: 600; margin: 0; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${partner.name}</h3>
                            ${this.userData?.privacy?.ghostMode ? `
                                <div title="Ghost Mode Active" style="display: flex; align-items: center; gap: 4px; background: rgba(139, 92, 246, 0.1); color: #8b5cf6; padding: 2px 6px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; border: 1px solid rgba(139, 92, 246, 0.2);">
                                    <i data-lucide="ghost" style="width: 10px; height: 10px;"></i>
                                    Ghost
                                </div>
                            ` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span id="chat-status" style="font-size: 11px; color: ${isTyping ? 'var(--online)' : 'var(--text-secondary)'}; font-weight: 500; line-height: 1.2; margin-top: 1px; white-space: nowrap;">${statusText}</span>
                            ${isTyping ? `
                            <div class="typing-dots">
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 2px; flex-shrink: 0;">
                    ${!isAI ? `
                    <div style="position: relative;" id="call-dropdown-wrap">
                        <button class="nav-item" onclick="app.toggleCallDropdown()" title="Call"><i data-lucide="phone"></i><i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: -2px;"></i></button>
                        <div id="call-dropdown" class="hidden" style="position: absolute; top: 100%; right: 0; min-width: 180px; background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 14px; box-shadow: var(--shadow-lg); z-index: 999; overflow: hidden; padding: 6px;">
                            <button onclick="app.startCall('${chat.id}', 'audio'); app.toggleCallDropdown()" style="width: 100%; padding: 12px 16px; border: none; background: none; color: var(--text-primary); display: flex; align-items: center; gap: 12px; cursor: pointer; border-radius: 10px; font-size: 14px; font-weight: 500; font-family: inherit;" onmouseover="this.style.background='var(--hover-bg)'" onmouseout="this.style.background='none'">
                                <i data-lucide="phone" style="width: 18px; color: var(--accent);"></i>
                                ${this.lang === 'ar' ? 'مكالمة صوتية' : 'Voice Call'}
                            </button>
                            <button onclick="app.startCall('${chat.id}', 'video'); app.toggleCallDropdown()" style="width: 100%; padding: 12px 16px; border: none; background: none; color: var(--text-primary); display: flex; align-items: center; gap: 12px; cursor: pointer; border-radius: 10px; font-size: 14px; font-weight: 500; font-family: inherit;" onmouseover="this.style.background='var(--hover-bg)'" onmouseout="this.style.background='none'">
                                <i data-lucide="video" style="width: 18px; color: #10b981;"></i>
                                ${this.lang === 'ar' ? 'مكالمة فيديو' : 'Video Call'}
                            </button>
                        </div>
                    </div>
                    <button class="nav-item hidden" id="sched-header-btn" onclick="app.showScheduledMessagesListModal('${chat.id}')" title="${this.lang === 'ar' ? 'الرسائل المجدولة' : 'Scheduled Messages'}" style="color: var(--accent); position: relative;">
                        <i data-lucide="clock"></i>
                        <span id="sched-header-badge" style="position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; border: 1.5px solid var(--glass-panel-solid); box-shadow: 0 0 6px #ef4444;"></span>
                    </button>
                    <button class="nav-item" onclick="app.toggleChatSearch()" title="Search in Chat"><i data-lucide="search"></i></button>
                    <button class="nav-item" onclick="app.renderChatInfo('${chat.id}')"><i data-lucide="more-vertical"></i></button>
                    ` : ''}
                </div>
            </header>
            <div id="chat-search-container" class="hidden">
                <div class="chat-search-bar">
                    <i data-lucide="search" style="width: 18px; color: var(--accent);"></i>
                    <input type="text" class="chat-search-input" placeholder="${this.lang === 'ar' ? 'بحث في الرسائل...' : 'Search messages...'}" oninput="app.filterChatMessages(this.value)">
                    <button onclick="app.toggleChatSearch()" style="background:none; border:none; color: var(--text-muted); cursor:pointer; display: flex; align-items: center;"><i data-lucide="x" style="width: 18px;"></i></button>
                </div>
            </div>
            
            <div id="messages-area" class="messages-area" style="${this.userData?.wallpaper ? `background-image: url(${this.userData.wallpaper});` : ''}"></div>
            ${inputAreaHTML}
        `;
        lucide.createIcons();

        this.listenForMessages(chatId);
        this.listenForTypingBubble(chatId);

        if (chat.type !== 'group') {
            const partnerId = chat.memberIds.find(id => id !== this.user.uid);
            if (partnerId) {
                if (this.partnerUnsubscribe) this.partnerUnsubscribe();
                this.partnerUnsubscribe = onSnapshot(doc(db, 'users', partnerId), (snap) => {
                    const data = snap.data();
                    const statusEl = document.getElementById('chat-status');
                    const showLastSeen = data?.privacy?.showLastSeen !== false;

                    if (data && data.lastSeen && statusEl) {
                        const secondsSince = (Date.now() - data.lastSeen.toMillis()) / 1000;
                        const isOnline = secondsSince < 120; // 2 minutes

                        if (isOnline) {
                            statusEl.innerText = this.lang === 'ar' ? 'متصل الآن' : 'Online';
                        } else if (showLastSeen) {
                            statusEl.innerText = this.formatLastSeen(data.lastSeen.toMillis());
                        } else {
                            statusEl.innerText = '';
                        }
                    } else if (statusEl) {
                        statusEl.innerText = '';
                    }
                });
            }
        }

        // Apply wallpaper when selecting chat
        if (this.userData?.wallpaper) {
            const area = document.getElementById('messages-area');
            if (area) area.style.backgroundImage = `url(${this.userData.wallpaper})`;
        }

        const msgForm = document.getElementById('msg-form');
        if (msgForm) {
            msgForm.onsubmit = (e) => {
                e.preventDefault();
                this.handleSendMessage(chatId);
            };
        }

        // Ctrl+V Paste Image Support
        const msgInput = document.getElementById('msg-input');
        if (msgInput) {
            msgInput.addEventListener('paste', (e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            this.showPasteImagePreview(ev.target.result, chatId);
                        };
                        reader.readAsDataURL(file);
                        break;
                    }
                }
            });
        }
    }

    showPasteImagePreview(dataURL, chatId) {
        document.getElementById('paste-preview-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'paste-preview-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 10000;
            background: rgba(0,0,0,0.8);
            backdrop-filter: blur(12px);
            display: flex; align-items: center; justify-content: center;
        `;
        modal.innerHTML = `
            <div style="background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 24px; padding: 24px; max-width: 90vw; width: 380px; display: flex; flex-direction: column; align-items: center; gap: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); text-align: center;">
                    ${this.lang === 'ar' ? 'إرسال صورة' : 'Send Image'}
                </h3>
                <div style="position: relative; width: 100%; border-radius: 16px; overflow: hidden; background: rgba(0,0,0,0.05); border: 1px solid var(--glass-border);">
                    <img src="${dataURL}" style="width: 100%; max-height: 40vh; object-fit: contain; display: block; pointer-events: none;">
                    <div id="view-once-badge-preview" style="position: absolute; top: 12px; right: 12px; background: var(--accent); color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(109, 40, 217, 0.4); opacity: 0; transform: scale(0.8); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
                        <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
                        <span>${this.lang === 'ar' ? 'عرض لمرة واحدة' : 'View Once'}</span>
                    </div>
                </div>
                
                <!-- Toggle View Once -->
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; background: var(--glass-panel); border: 1px solid var(--glass-border); padding: 12px 16px; border-radius: 16px; cursor: pointer; user-select: none;" onclick="const chk = document.getElementById('view-once-toggle'); chk.checked = !chk.checked; app.updateViewOnceToggleUI(chk.checked)">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i data-lucide="eye" style="width: 20px; height: 20px; color: var(--accent);"></i>
                        <div style="text-align: ${this.lang === 'ar' ? 'right' : 'left'};">
                            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${this.lang === 'ar' ? 'عرض لمرة واحدة' : 'View Once'}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${this.lang === 'ar' ? 'تختفي الصورة بعد 3 ثوان' : 'Disappears after 3 seconds'}</div>
                        </div>
                    </div>
                    <input type="checkbox" id="view-once-toggle" style="display: none;">
                    <div id="view-once-visual-toggle" style="width: 44px; height: 24px; border-radius: 12px; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); position: relative; transition: all 0.3s; flex-shrink: 0;">
                        <div id="view-once-knob" style="width: 18px; height: 18px; border-radius: 50%; background: var(--text-secondary); position: absolute; top: 2px; left: 2px; transition: all 0.3s;"></div>
                    </div>
                </div>

                <div style="display: flex; gap: 12px; width: 100%;">
                    <button onclick="document.getElementById('paste-preview-modal').remove()"
                        style="flex: 1; padding: 14px; border-radius: 16px; border: 1px solid var(--glass-border); background: var(--glass-panel); color: var(--text-primary); cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s;">
                        ${this.lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button id="paste-send-btn"
                        style="flex: 1; padding: 14px; border-radius: 16px; border: none; background: linear-gradient(135deg, var(--accent), var(--accent-light)); color: white; cursor: pointer; font-size: 14px; font-weight: 700; box-shadow: 0 4px 14px rgba(109,40,217,0.35); transition: all 0.2s;">
                        ${this.lang === 'ar' ? 'إرسال' : 'Send'}
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        if (window.lucide) lucide.createIcons({ node: modal });

        document.getElementById('paste-send-btn').onclick = async () => {
            const isViewOnce = document.getElementById('view-once-toggle').checked;
            modal.remove();
            await this.sendMessageWithMedia(chatId, dataURL, isViewOnce);
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    updateViewOnceToggleUI(checked) {
        const knob = document.getElementById('view-once-knob');
        const visual = document.getElementById('view-once-visual-toggle');
        const badge = document.getElementById('view-once-badge-preview');
        if (knob && visual && badge) {
            if (checked) {
                knob.style.left = '22px';
                knob.style.background = '#ffffff';
                visual.style.background = 'var(--accent)';
                visual.style.borderColor = 'var(--accent-light)';
                badge.style.opacity = '1';
                badge.style.transform = 'scale(1)';
            } else {
                knob.style.left = '2px';
                knob.style.background = 'var(--text-secondary)';
                visual.style.background = 'rgba(255,255,255,0.08)';
                visual.style.borderColor = 'var(--glass-border)';
                badge.style.opacity = '0';
                badge.style.transform = 'scale(0.8)';
            }
        }
    }


    async toggleArchive(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        const archivedBy = chat.archivedBy || [];
        const isArchived = archivedBy.includes(this.user.uid);
        let newArchivedBy;

        if (isArchived) newArchivedBy = archivedBy.filter(uid => uid !== this.user.uid);
        else newArchivedBy = [...archivedBy, this.user.uid];

        await setDoc(doc(db, 'chats', chatId), { archivedBy: newArchivedBy }, { merge: true });
        this.closeMobileOverlay();
        this.renderFilteredChats();
    }

    isEmojiOnly(text) {
        if (!text || typeof text !== 'string') return false;
        const trimmed = text.trim();
        if (!trimmed) return false;

        // Comprehensive emoji regex
        // Matches strings that only contain emojis, variation selectors, and spaces
        const emojiRegex = /^(\s|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|[\u2600-\u26FF]|[\u2700-\u27BF])+$/;
        return emojiRegex.test(trimmed);
    }

    formatMessageContent(msg) {
        let text = msg.text || '';

        // Sanitize HTML slightly but allow some formatting
        text = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Dynamic link color to ensure excellent contrast on both sender and recipient bubbles
        const isMine = msg.senderId === this.user?.uid;
        const linkColor = isMine ? '#ffffff' : 'var(--accent)';

        // Linkify URLs
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        text = text.replace(urlRegex, `<a href="$1" target="_blank" style="color: ${linkColor}; text-decoration: underline; font-weight: 600;">$1</a>`);

        // Simple Markdown: **bold**, *italic*, `code`
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.05); padding:2px 4px; border-radius:4px; font-family:monospace;">$1</code>');

        // New lines to <br>
        text = text.replace(/\n/g, '<br>');

        return text;
    }

    listenForMessages(chatId) {
        if (this.messagesUnsubscribe) this.messagesUnsubscribe();
        if (this.schedUnsubscribe) {
            this.schedUnsubscribe();
            this.schedUnsubscribe = null;
        }
        if (this.schedTimer) {
            clearInterval(this.schedTimer);
            this.schedTimer = null;
        }

        // Reset limit on new chat
        if (this.lastActiveChatId !== chatId) {
            this.messageLimit = 50;
            this.lastActiveChatId = chatId;
        }

        const q = query(
            collection(db, `chats/${chatId}/messages`),
            orderBy('createdAt', 'desc'),
            limit(this.messageLimit)
        );

        // Listen for scheduled messages for this user
        const schedQuery = query(
            collection(db, `chats/${chatId}/messages`),
            where('senderId', '==', this.user.uid),
            where('status', '==', 'scheduled')
        );
        this.schedUnsubscribe = onSnapshot(schedQuery, (schedSnapshot) => {
            this.renderScheduledMessagesList(chatId, schedSnapshot.docs);
        });

        this.messagesUnsubscribe = onSnapshot(q, async (snapshot) => {
            if (this.activeChatId !== chatId) return;
            const container = document.getElementById('messages-area');
            if (!container) return;

            const chat = this.allChats.find(c => c.id === chatId);
            this.currentMessages = {};

            const docs = snapshot.docs.reverse(); // Reverse for chronolocial display
            const now = Date.now();

            let messagesHTML = '';

            // Add Load More button if we might have more messages
            if (snapshot.docs.length >= this.messageLimit) {
                messagesHTML += `<button class="load-more-btn" onclick="app.loadMoreMessages('${chatId}')">${this.lang === 'ar' ? 'تحميل الرسائل القديمة' : 'Load previous messages'}</button>`;
            }

            // Async decryption
            const decryptedDocs = await Promise.all(docs.map(async docSnap => {
                let msg = docSnap.data();
                if (msg.isE2E) {
                    msg = await this.decryptMessagePayload(msg);
                }
                return { msgId: docSnap.id, msg };
            }));

            // Save in currentMessages
            decryptedDocs.forEach(({ msgId, msg }) => {
                this.currentMessages[msgId] = msg;
            });

            const renderedDocs = decryptedDocs.filter(({ msg }) => msg.status !== 'scheduled');

            messagesHTML += renderedDocs.map(({ msgId, msg }, index) => {
                // Handle System Messages
                if (msg.type === 'system') {
                    return `
                        <div style="display: flex; justify-content: center; width: 100%; margin: 16px 0;">
                            <span style="background: rgba(0,0,0,0.05); color: var(--text-muted); font-size: 11px; padding: 4px 12px; border-radius: 20px; font-weight: 500; letter-spacing: 0.5px; backdrop-filter: blur(4px); border: 1px solid var(--glass-border);">
                                ${msg.text}
                            </span>
                        </div>
                    `;
                }

                const prevDoc = index > 0 ? renderedDocs[index - 1].msg : null;
                const nextDoc = index < renderedDocs.length - 1 ? renderedDocs[index + 1].msg : null;

                const isMine = msg.senderId === this.user.uid;

                let isGroupStart = true;
                let isGroupEnd = true;

                if (prevDoc && prevDoc.type !== 'system' && prevDoc.senderId === msg.senderId) {
                    const timeDiff = (msg.createdAt?.toMillis() || 0) - (prevDoc.createdAt?.toMillis() || 0);
                    if (timeDiff < 5 * 60 * 1000) { // 5 mins
                        isGroupStart = false;
                    }
                }

                if (nextDoc && nextDoc.type !== 'system' && nextDoc.senderId === msg.senderId) {
                    const timeDiff = (nextDoc.createdAt?.toMillis() || 0) - (msg.createdAt?.toMillis() || 0);
                    if (timeDiff < 5 * 60 * 1000) {
                        isGroupEnd = false;
                    }
                }

                let groupingClass = '';
                if (!isGroupStart && !isGroupEnd) groupingClass = 'group-middle';
                else if (!isGroupStart && isGroupEnd) groupingClass = 'group-end';
                else if (isGroupStart && !isGroupEnd) groupingClass = 'group-start';
                else groupingClass = 'group-single';

                // Mark as read if received and in active chat and window focused
                // GHOST MODE: Skip marking as read if user enabled ghostMode
                const ghostMode = !!this.userData?.privacy?.ghostMode;
                if (!isMine && msg.status !== 'read' && document.visibilityState === 'visible' && !ghostMode) {
                    updateDoc(doc(db, `chats/${chatId}/messages`, msgId), { status: 'read' });
                }

                let senderLabel = '';
                if (isGroupStart && !isMine && chat?.type === 'group') {
                    const senderName = chat.memberData[msg.senderId]?.name || 'User';
                    senderLabel = `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; margin-left: 6px;">${senderName}</div>`;
                }

                let contentStr = '';
                let extraBubbleClass = groupingClass;
                if (msg.isViewOnce) {
                    const isOpened = msg.viewOnceState === 'opened';
                    if (isOpened) {
                        contentStr = `
                            <div class="view-once-bubble-content opened" style="display: flex; align-items: center; gap: 8px; padding: 10px 14px; user-select: none;">
                                <i data-lucide="eye-off" style="width: 18px; height: 18px;"></i>
                                <span>${this.lang === 'ar' ? 'صورة منتهية الصلاحية' : 'Opened Photo'}</span>
                            </div>
                        `;
                    } else {
                        contentStr = `
                            <div class="view-once-bubble-content unread" onclick="app.openViewOnceImage('${chatId}', '${msgId}'); event.stopPropagation();" style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; font-weight: 600;">
                                <i data-lucide="eye" class="view-once-pulse-eye" style="width: 20px; height: 20px;"></i>
                                <span>${this.lang === 'ar' ? 'صورة للعرض مرة واحدة' : 'View Once Photo'}</span>
                            </div>
                        `;
                    }
                    extraBubbleClass = 'view-once-bubble';
                } else if (msg.image) {
                    contentStr = `<img src="${msg.image}" style="width: 100%; height: auto; border-radius: 8px; cursor: pointer; display: block;" onclick="app.viewImage('${msg.image}');">`;
                    extraBubbleClass = 'image-only-bubble';
                } else if (msg.gifUrl) {
                    contentStr = `<img src="${msg.gifUrl}" style="width: 200px; max-width: 100%; height: auto; display: block;">`;
                    extraBubbleClass = 'gif-bubble';
                } else if (msg.audio) {
                    const senderPhoto = isMine ? (this.userData?.photoURL || 'https://ui-avatars.com/api/?name=Me') : (chat.memberData?.[msg.senderId]?.photo || `https://ui-avatars.com/api/?name=${chat.memberData?.[msg.senderId]?.name || 'User'}`);

                    // Generate dense waveform bars
                    let waveformHTML = '';
                    const barCount = 40;
                    for (let i = 0; i < barCount; i++) {
                        const h = 4 + Math.random() * 16;
                        waveformHTML += `<div class="wa-waveform-bar" style="height: ${h}px;"></div>`;
                    }

                    contentStr = `
                        <div class="wa-audio-player" id="player-${msgId}" style="direction: ltr !important; text-align: left !important;">
                            <div class="wa-audio-avatar-wrapper">
                                <img src="${senderPhoto}" class="wa-audio-avatar" onerror="this.src='https://ui-avatars.com/api/?name=U'">
                                <div class="wa-audio-mic-badge"><i data-lucide="mic"></i></div>
                            </div>
                            <div class="wa-audio-controls">
                                <div class="wa-audio-top">
                                    <button type="button" class="wa-audio-play-btn" onclick="app.toggleAudio(this, '${msgId}'); event.stopPropagation();">
                                        <div class="wa-play-inner">
                                            <i data-lucide="play" id="icon-${msgId}"></i>
                                        </div>
                                    </button>
                                    <div class="wa-audio-waveform">
                                        ${waveformHTML}
                                        <input type="range" class="wa-audio-slider" value="0" min="0" max="100" oninput="app.seekAudio(this, '${msgId}'); event.stopPropagation();" onclick="event.stopPropagation();">
                                    </div>
                                </div>
                                <div class="wa-audio-info">
                                    <span class="wa-duration" id="dur-${msgId}">...</span>
                                </div>
                            </div>
                            <audio id="audio-${msgId}" src="${msg.audio}" preload="metadata" ontimeupdate="app.updateAudioProgress('${msgId}')" onended="app.resetAudioPlayer('${msgId}')" onloadedmetadata="app.setAudioDuration('${msgId}')"></audio>
                        </div>
                    `;
                    extraBubbleClass = 'wa-audio-bubble';
                } else if (msg.type === 'poll') {
                    const totalVotes = (msg.options || []).reduce((sum, opt) => sum + (opt.votes ? opt.votes.length : 0), 0);

                    const optionsHTML = (msg.options || []).map((opt, idx) => {
                        const voteCount = opt.votes ? opt.votes.length : 0;
                        const percent = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
                        const hasVoted = opt.votes && opt.votes.includes(this.user.uid);

                        return `
                            <div class="poll-option ${hasVoted ? 'voted' : ''}" onclick="app.voteInPoll('${chatId}', '${msgId}', ${idx}); event.stopPropagation();">
                                <div class="poll-bar" style="width: ${percent}%;"></div>
                                <div class="poll-option-content">
                                    <span style="display: flex; align-items: center; gap: 6px;">
                                        ${hasVoted ? '✓ ' : ''}${opt.text}
                                    </span>
                                    <span class="poll-count">${voteCount}</span>
                                </div>
                            </div>
                        `;
                    }).join('');

                    contentStr = `
                        <div class="poll-container">
                            <h4 class="poll-question">${msg.question}</h4>
                            <div class="poll-options-list">
                                ${optionsHTML}
                            </div>
                            <div class="poll-footer">
                                <span>${totalVotes} ${this.lang === 'ar' ? 'تصويت' : 'votes'}</span>
                            </div>
                        </div>
                    `;
                    extraBubbleClass = 'poll-bubble';
                } else if (msg.type === 'screen_drawing') {
                    const isNew = (now - (msg.createdAt?.toMillis() || now)) < 10000;
                    if (!this.playedDrawings) this.playedDrawings = new Set();
                    if (isNew && !this.playedDrawings.has(msgId)) {
                        this.playedDrawings.add(msgId);
                        setTimeout(() => this.playScreenDrawing(msg.strokes), 500);
                    }
                    contentStr = `
                        <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: ${isMine ? '#ffffff' : 'var(--accent)'}; cursor: pointer;" onclick="app.replayScreenDrawing('${msgId}'); event.stopPropagation();">
                            <i data-lucide="sparkles" style="width: 18px;"></i>
                            <span>${this.lang === 'ar' ? 'رسم حي - اضغط للتشغيل' : 'Live Drawing - Tap to replay'}</span>
                        </div>
                    `;
                    extraBubbleClass = 'screen-drawing-bubble';
                } else {
                    let displayText = msg.text || '';
                    let storyPreviewHTML = '';

                    if (msg.storyRef) {
                        if (displayText.startsWith('[رد على القصة]') || displayText.startsWith('[Reply to story]')) {
                            displayText = displayText.replace(/^\[(رد على القصة|Reply to story)\]\s*/, '');
                        }

                        const isTextStory = msg.storyRef.type === 'text';
                        const titleText = this.lang === 'ar' ? 'رد على القصة' : 'Replied to story';
                        const borderSide = this.lang === 'ar' ? 'right' : 'left';
                        const textDir = this.lang === 'ar' ? 'rtl' : 'ltr';

                        // Premium dynamic colors to ensure maximum legibility and gorgeous contrast on both sender (colored bubble) and recipient (dark bubble)
                        const titleColor = isMine ? 'rgba(255,255,255,0.95)' : 'var(--accent)';
                        const subtitleColor = isMine ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)';
                        const borderColor = isMine ? 'rgba(255,255,255,0.5)' : 'var(--accent)';
                        const bgColor = isMine ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)';

                        storyPreviewHTML = `
                            <div class="story-reply-preview" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: ${bgColor}; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; border-${borderSide}: 3px solid ${borderColor}; backdrop-filter: blur(8px); min-width: 180px; direction: ${textDir}; text-align: ${borderSide};">
                                <div style="display: flex; flex-direction: column; gap: 4px; overflow: hidden; flex: 1;">
                                    <span style="font-size: 11px; font-weight: 600; color: ${titleColor}; display: flex; align-items: center; gap: 6px; justify-content: flex-start;">
                                        <i data-lucide="reply" style="width: 12px; height: 12px;"></i>
                                        ${titleText}
                                    </span>
                                    ${isTextStory ? `
                                        <span style="font-size: 13px; color: ${isMine ? 'white' : 'rgba(255,255,255,0.85)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-style: italic; max-width: 200px;">
                                            "${msg.storyRef.preview}"
                                        </span>
                                    ` : `
                                        <span style="font-size: 12px; color: ${subtitleColor}; display: flex; align-items: center; gap: 4px; justify-content: flex-start;">
                                            <i data-lucide="image" style="width: 11px; height: 11px;"></i>
                                            ${this.lang === 'ar' ? 'قصة مصورة' : 'Photo Story'}
                                        </span>
                                    `}
                                </div>
                                ${!isTextStory && msg.storyRef.preview ? `
                                    <img src="${msg.storyRef.preview}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; border: 1px solid rgba(255,255,255,0.1); cursor: pointer;" onclick="app.viewImage('${msg.storyRef.preview}', false); event.stopPropagation();">
                                ` : ''}
                                ${isTextStory ? `
                                    <div style="width: 40px; height: 40px; border-radius: 4px; background: ${msg.storyRef.bg || 'var(--accent)'}; color: white; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold; overflow: hidden; padding: 2px; text-align: center; line-height: 1.1; flex-shrink: 0; box-shadow: inset 0 0 10px rgba(0,0,0,0.2);">
                                        ${msg.storyRef.preview}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }

                    const isEmoji = this.isEmojiOnly(displayText);
                    if (isEmoji && !msg.storyRef) extraBubbleClass += ' emoji-only-bubble';

                    contentStr = storyPreviewHTML + this.formatMessageContent({ ...msg, text: displayText });
                    if (msg.edited) {
                        contentStr += ` <span style="font-size: 10px; opacity: 0.7; font-style: italic;">(${this.lang === 'ar' ? 'معدلة' : 'edited'})</span>`;
                    }

                    if (msg.linkPreview) {
                        const lp = msg.linkPreview;
                        contentStr += `
                            <a href="${lp.url}" target="_blank" class="link-preview-box" onclick="event.stopPropagation();">
                                ${lp.image ? `<img src="${lp.image}" class="link-preview-img">` : ''}
                                <div class="link-preview-content">
                                    <div class="link-preview-title">${lp.title || 'Link'}</div>
                                    ${lp.description ? `<div class="link-preview-desc">${lp.description}</div>` : ''}
                                    <div class="link-preview-url">${new URL(lp.url).hostname}</div>
                                </div>
                            </a>
                        `;
                    }
                }

                // Ticks logic
                let ticksHTML = '';
                if (isMine) {
                    const color = msg.status === 'read' ? '#3b82f6' : '#94a3b8';
                    const iconName = msg.status === 'read' ? 'check-check' : 'check';
                    ticksHTML = `<i data-lucide="${iconName}" style="width: 14px; height: 14px; color: ${color}; margin-top: 2px;"></i>`;
                }

                const timeStr = msg.createdAt ? new Date(msg.createdAt.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '';

                // Reactions logic
                let reactionsHTML = '';
                if (msg.reactions) {
                    const counts = {};
                    Object.values(msg.reactions).forEach(r => counts[r] = (counts[r] || 0) + 1);
                    reactionsHTML = `
                        <div class="msg-reactions" onclick="event.stopPropagation(); app.showReactionDetails('${chatId}', '${msgId}')">
                            ${Object.keys(counts).map(r => `<span class="reaction-item">${r}<span class="reaction-count">${counts[r] > 1 ? counts[r] : ''}</span></span>`).join('')}
                        </div>
                    `;
                }

                let replyHTML = '';
                if (msg.replyTo && this.currentMessages[msg.replyTo]) {
                    const repliedMsg = this.currentMessages[msg.replyTo];
                    let brief = repliedMsg.text || (repliedMsg.image ? (this.lang === 'ar' ? '📷 صورة' : '📷 Image') : (this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message'));
                    if (brief.length > 50) brief = brief.substring(0, 50) + '...';

                    const replyName = repliedMsg.senderId === this.user.uid ? (this.lang === 'ar' ? 'أنت' : 'You') : (chat.memberData[repliedMsg.senderId]?.name || 'User');

                    replyHTML = `
                        <div style="background: rgba(0,0,0,0.1); border-${this.lang === 'ar' ? 'right' : 'left'}: 4px solid var(--accent); padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; font-size: 12px; cursor: pointer; opacity: 0.85;" onclick="app.scrollToMessage('${msg.replyTo}')">
                            <div style="font-weight: 700; color: ${isMine ? 'white' : 'var(--accent)'}; margin-bottom: 2px;">${replyName}</div>
                            <div style="color: ${isMine ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${brief}</div>
                        </div>
                    `;
                }

                return `
                    <div class="msg-bubble ${isMine ? 'mine' : 'theirs'} ${extraBubbleClass}" style="cursor: pointer; position: relative;"
                        data-chat-id="${chatId}" data-msg-id="${msgId}"
                        oncontextmenu="app.onMsgContextMenu(event, '${chatId}', '${msgId}'); return false;"
                        ondblclick="app.onMsgDblClick(event, '${chatId}', '${msgId}')"
                        ontouchstart="app.onMsgTouchStart(event, '${chatId}', '${msgId}')"
                        ontouchend="app.onMsgTouchEnd(event, '${chatId}', '${msgId}')"
                        ontouchmove="app.onMsgTouchMove(event, '${chatId}', '${msgId}')"
                        onmouseup="app.onMsgMouseUp(event)"
                        onmouseleave="app.onMsgMouseUp(event)">
                        <div style="display: flex; flex-direction: column; width: 100%;">
                            ${senderLabel}
                            <div class="bubble-content ${extraBubbleClass}">
                                ${replyHTML}
                                <div class="bubble-text" dir="auto">
                                    ${contentStr}
                                </div>
                                <div class="msg-meta" style="display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 4px;">
                                    <span style="font-size: 10px; opacity: 0.6;">${timeStr}</span>
                                    ${ticksHTML}
                                </div>
                            </div>
                            ${reactionsHTML}
                        </div>
                    </div>
                `;
            }).join('');

            const prevScroll = container.scrollHeight - container.scrollTop;
            container.innerHTML = messagesHTML;

            // Maintain scroll position if loading more, else scroll to bottom
            if (this.isLoadingMore) {
                container.scrollTop = container.scrollHeight - prevScroll;
                this.isLoadingMore = false;
            } else {
                container.scrollTop = container.scrollHeight;
            }

            lucide.createIcons();

            // Re-inject typing bubble if it was visible (innerHTML wipes it)
            if (this._typingBubbleVisible) {
                const chat = this.allChats.find(c => c.id === chatId);
                const typingUsers = Object.keys(chat?.typing || {}).filter(uid => uid !== this.user.uid && chat.typing[uid] === true);
                let typerPhoto = 'assets/logo.jpg';
                if (chat && typingUsers[0] && chat.memberData?.[typingUsers[0]]) {
                    typerPhoto = chat.memberData[typingUsers[0]].photo || typerPhoto;
                }
                this._typingBubbleVisible = false; // Reset so updateTypingBubble will re-add
                this.updateTypingBubble(true, typerPhoto);
            }
        });
    }

    loadMoreMessages(chatId) {
        this.isLoadingMore = true;
        this.messageLimit += 50;
        this.listenForMessages(chatId);
    }


    // --- Typing Bubble Indicator ---

    listenForTypingBubble(chatId) {
        if (this._typingBubbleUnsub) {
            this._typingBubbleUnsub();
            this._typingBubbleUnsub = null;
        }
        this._typingBubbleVisible = false;

        this._typingBubbleUnsub = onSnapshot(doc(db, 'chats', chatId), (snap) => {
            if (this.activeChatId !== chatId) return;
            const data = snap.data();
            if (!data) return;

            const typingUsers = Object.keys(data.typing || {}).filter(uid => uid !== this.user.uid && data.typing[uid] === true);
            const isTyping = typingUsers.length > 0;

            // Also update header status text
            const statusEl = document.getElementById('chat-status');
            if (statusEl && isTyping) {
                statusEl.innerText = this.lang === 'ar' ? 'يكتب الآن...' : 'Typing...';
                statusEl.style.color = 'var(--online)';
            }

            // Get typer info for avatar
            let typerPhoto = 'assets/logo.jpg';
            const chat = this.allChats.find(c => c.id === chatId);
            if (chat && typingUsers[0] && chat.memberData?.[typingUsers[0]]) {
                typerPhoto = chat.memberData[typingUsers[0]].photo || typerPhoto;
            }

            this.updateTypingBubble(isTyping, typerPhoto);
        });
    }

    updateTypingBubble(show, avatarSrc = 'assets/logo.jpg') {
        const container = document.getElementById('messages-area');
        if (!container) return;

        const existing = container.querySelector('.typing-bubble-container');

        if (show && !this._typingBubbleVisible) {
            // Show typing bubble
            this._typingBubbleVisible = true;
            if (existing) existing.remove();

            const bubbleHTML = `
                <div class="typing-bubble-container" id="typing-bubble">
                    <img src="${avatarSrc}" class="typing-bubble-avatar" onerror="this.src='https://ui-avatars.com/api/?name=U'">
                    <div class="typing-bubble">
                        <div class="typing-bubble-dot"></div>
                        <div class="typing-bubble-dot"></div>
                        <div class="typing-bubble-dot"></div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', bubbleHTML);

            // Auto-scroll to show typing bubble
            const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 120;
            if (isNearBottom) {
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        } else if (!show && this._typingBubbleVisible) {
            // Hide typing bubble with animation
            this._typingBubbleVisible = false;
            if (existing) {
                existing.classList.add('hiding');
                setTimeout(() => existing.remove(), 250);
            }
        }
    }

    scrollToMessage(msgId) {
        const el = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (!el) {
            this.showAlert(this.lang === 'ar' ? 'تنبيه' : 'Alert', this.lang === 'ar' ? 'الرسالة الأصلية قديمة جداً أو غير موجودة.' : 'Original message is too old or not found.');
            return;
        }

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Remove existing highlights
        document.querySelectorAll('.msg-bubble.highlighted').forEach(b => b.classList.remove('highlighted'));

        // Add highlight
        setTimeout(() => {
            el.classList.add('highlighted');
            // Remove class after animation finishes (2s)
            setTimeout(() => el.classList.remove('highlighted'), 2000);
        }, 300); // Wait for scroll to start
    }

    toggleChatSearch() {
        this.isSearching = !this.isSearching;
        const container = document.getElementById('chat-search-container');
        container.classList.toggle('hidden', !this.isSearching);
        if (this.isSearching) {
            container.querySelector('input').focus();
        } else {
            // Reset filters
            document.querySelectorAll('.msg-bubble').forEach(b => b.style.display = 'flex');
        }
    }

    filterChatMessages(query) {
        const q = query.toLowerCase().trim();
        document.querySelectorAll('.msg-bubble').forEach(bubble => {
            const msgId = bubble.dataset.msgId;
            const msg = this.currentMessages[msgId];
            if (!msg) return;
            const text = (msg.text || '').toLowerCase();
            bubble.style.display = text.includes(q) ? 'flex' : 'none';
        });
    }

    async handleChatImageUpload(event, chatId) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Max dimension 800px for shared images
                const maxDim = 800;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = (h / w) * maxDim; w = maxDim; }
                    else { w = (w / h) * maxDim; h = maxDim; }
                }

                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);

                const dataURL = canvas.toDataURL('image/jpeg', 0.7);
                this.showPasteImagePreview(dataURL, chatId);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    async sendMessageWithMedia(chatId, imageData, isViewOnce = false) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (chat && chat.blockedBy && chat.blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'ململكة محظورة' : 'Blocked Context', this.lang === 'ar' ? 'لا يمكن إرسال وسائط في محادثة محظورة.' : 'Cannot send media in a blocked conversation.');
            return;
        }

        try {
            const batch = writeBatch(db);
            const msgRef = doc(collection(db, `chats/${chatId}/messages`));

            let preE2E = { image: imageData };
            if (isViewOnce) {
                preE2E.isViewOnce = true;
                preE2E.viewOnceState = 'unread';
            }
            let e2eData = preE2E;
            if (chat.type !== 'ai') {
                e2eData = await this.encryptMessagePayload(chat, preE2E);
            }

            const payload = {
                chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent',
                ...e2eData
            };
            if (isViewOnce) {
                payload.isViewOnce = true;
                payload.viewOnceState = 'unread';
            }

            if (this.replyToMsgId) {
                payload.replyTo = this.replyToMsgId;
            }

            batch.set(msgRef, payload);

            let displayLastMsg = this.lang === 'ar' ? '🔒 وسائط مشفرة' : '🔒 Encrypted Media';
            if (isViewOnce) {
                displayLastMsg = this.lang === 'ar' ? '🔒 صورة للعرض مرة واحدة' : '🔒 View Once Photo';
            }
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text: displayLastMsg, senderId: this.user.uid, msgId: msgRef.id, ...e2eData },
                ...this.getUnreadCountsUpdate(chat),
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();
            this.cancelReply();
        } catch (e) {
            console.error("Image send failed", e);
        }
    }

    async handleSendMessage(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (chat && chat.blockedBy && chat.blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'المحادثة محظورة' : 'Context Blocked', this.lang === 'ar' ? 'لا يمكن إرسال رسائل في محادثة محظورة.' : 'Cannot send messages in a blocked conversation.');
            return;
        }

        const input = document.getElementById('msg-input');
        const text = input.value.trim();
        if (!text && !this.replyToMsgId) return;

        if (chatId === this.user.uid + '_ai') {
            this.handleAIMessage(chatId, text);
            return;
        }

        input.value = '';
        try {
            const batch = writeBatch(db);
            const msgRef = doc(collection(db, `chats/${chatId}/messages`));

            // Link Detection
            const urlMatch = text.match(/(https?:\/\/[^\s]+)/g);
            let linkPreview = null;
            if (urlMatch) {
                linkPreview = await this.getLinkPreview(urlMatch[0]);
            }

            let preE2E = { text };
            if (linkPreview) preE2E.linkPreview = linkPreview;

            let e2eData = preE2E;
            if (chat.type !== 'ai') {
                e2eData = await this.encryptMessagePayload(chat, preE2E);
            }

            const payload = {
                chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent',
                ...e2eData
            };

            if (this.replyToMsgId) {
                payload.replyTo = this.replyToMsgId;
            }

            batch.set(msgRef, payload);

            let displayLastMsg = text;
            if (chat.type !== 'ai') {
                displayLastMsg = this.lang === 'ar' ? '🔒 رسالة مشفرة' : '🔒 Encrypted Message';
            }
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text: displayLastMsg, senderId: this.user.uid, msgId: msgRef.id, ...e2eData },
                ...this.getUnreadCountsUpdate(chat),
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();
            this.cancelReply();
        } catch (e) {
            console.error("Message failed", e);
        }
    }

    // --- Interaction Features ---

    async handleTyping(chatId) {
        if (this.typingTimeout) clearTimeout(this.typingTimeout);

        // Mention Logic
        this.handleMentionSuggestions(chatId);

        // Update Firestore to typing: true (Skipped in Ghost Mode)
        const isGhost = this.userData?.privacy?.ghostMode;
        const chatRef = doc(db, 'chats', chatId);
        const updateObj = {};
        updateObj[`typing.${this.user.uid}`] = true;
        if (chatId !== this.user.uid + '_ai' && !isGhost) await updateDoc(chatRef, updateObj);

        this.typingTimeout = setTimeout(async () => {
            const stopObj = {};
            stopObj[`typing.${this.user.uid}`] = false;
            if (chatId !== this.user.uid + '_ai' && !isGhost) await updateDoc(chatRef, stopObj);
        }, 2000);
    }

    handleMentionSuggestions(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat || chat.type !== 'group') return;

        const input = document.getElementById('msg-input');
        if (!input) return;

        const val = input.value;
        const cursorPos = input.selectionStart;
        const textBeforeCursor = val.substring(0, cursorPos);
        const match = textBeforeCursor.match(/@(\w*)$/);

        const area = document.getElementById('input-area-inner');
        if (!area) return;
        let dropdown = document.getElementById('mention-dropdown');

        if (match) {
            const queryText = match[1].toLowerCase();
            const members = chat.memberIds.filter(id => id !== this.user.uid).map(id => chat.memberData[id]).filter(m => m);
            const filtered = members.filter(m => m.name.toLowerCase().includes(queryText) || (m.username && m.username.toLowerCase().includes(queryText)));

            if (filtered.length > 0) {
                if (!dropdown) {
                    dropdown = document.createElement('div');
                    dropdown.id = 'mention-dropdown';
                    dropdown.className = 'mention-suggestions';
                    area.appendChild(dropdown);
                }
                dropdown.innerHTML = filtered.map(m => `
                    <div class="mention-item" onclick="app.insertMention('${m.username || m.name}', ${match.index}, ${match[0].length})">
                        <img src="${m.photo}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 13px; font-weight: 600;">${m.name}</span>
                            ${m.username ? `<span style="font-size: 11px; opacity: 0.7;">@${m.username}</span>` : ''}
                        </div>
                    </div>
                `).join('');
            } else if (dropdown) {
                dropdown.remove();
            }
        } else if (dropdown) {
            dropdown.remove();
        }
    }

    insertMention(name, index, length) {
        const input = document.getElementById('msg-input');
        const val = input.value;
        input.value = val.substring(0, index) + '@' + name + ' ' + val.substring(index + length);
        input.focus();
        document.getElementById('mention-dropdown')?.remove();
    }



    // Note: AI and formatting methods moved to ai.js

    linkify(text) {
        // Stop matching URLs at spaces OR HTML tags (<)
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        return text.replace(urlRegex, (url) => {
            return `<a href="${url}" target="_blank" style="color: inherit; text-decoration: underline;">${url}</a>`;
        });
    }

    async getLinkPreview(url) {
        try {
            // Using Microlink (free tier)
            const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
            const json = await response.json();
            if (json.status === 'success' && json.data) {
                const d = json.data;
                return {
                    url,
                    title: d.title,
                    image: d.image?.url,
                    description: d.description
                };
            }
        } catch (e) {
            console.warn("Link preview failed", e);
        }
        return null;
    }

    renderChatInfo(chatId) {
        if (chatId === this.user.uid + '_ai') return;
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        const partner = this.getChatPartner(chat);
        const chatWindow = document.getElementById('chat-window');

        const isArchived = chat.archivedBy && chat.archivedBy.includes(this.user.uid);
        const archiveIcon = isArchived ? 'package-open' : 'archive';
        const archiveText = isArchived ? (this.lang === 'ar' ? 'إلغاء الأرشفة' : 'Unarchive Chat') : (this.lang === 'ar' ? 'أرشفة المحادثة' : 'Archive Chat');


        if (chat.type === 'group') {
            const creatorId = chat.memberIds[0];
            const admins = chat.admins || [creatorId];
            const isAdmin = admins.includes(this.user.uid);

            let adminControls = '';
            if (isAdmin) {
                adminControls = `
                    <label style="cursor: pointer; display: block; margin-top: 12px; font-size: 14px; color: var(--accent); font-weight: 600; text-align: center;">
                        <i data-lucide="camera" style="width: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>
                        ${this.lang === 'ar' ? 'تغيير صورة المجموعة' : 'Change Group Image'}
                        <input type="file" accept="image/*" style="display: none;" onchange="app.changeGroupImage(event, '${chatId}')">
                    </label>
                `;
            }

            let groupNameHTML = `<h2 style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; display: flex; align-items: center; justify-content: center; gap: 8px;">${partner.name}</h2>`;
            if (isAdmin) {
                groupNameHTML = `
                    <h2 style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span>${partner.name}</span>
                        <i data-lucide="edit-3" style="width: 18px; height: 18px; color: var(--accent); cursor: pointer; opacity: 0.8; transition: all 0.2s;" onclick="app.promptRenameGroup('${chatId}', '${partner.name.replace(/'/g, "\\'")}')" title="${this.lang === 'ar' ? 'تعديل الاسم' : 'Rename Group'}"></i>
                    </h2>
                `;
            }

            chatWindow.innerHTML = `
                <header class="chat-header">
                    <button class="nav-item" onclick="app.selectChat('${chatId}')"><i data-lucide="chevron-left"></i></button>
                    <h3 style="flex: 1; text-align: center; margin-right: 40px; font-size: 16px;">${this.lang === 'ar' ? 'معلومات المجموعة' : 'Group Info'}</h3>
                </header>
                <div class="scrollbar-hidden" style="flex: 1; overflow-y: auto; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 24px;">
                    <div style="position: relative; text-align: center;">
                        <img src="${partner.photo}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-lg); border: 4px solid var(--glass-border); cursor: pointer;" onclick="app.viewImage('${partner.photo}', false)">
                        ${adminControls}
                    </div>
                    <div style="text-align: center;">
                        ${groupNameHTML}
                        <div style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); font-size: 14px; margin-top: 4px;" onclick="app.toggleMembersList('${chatId}')">
                            <span>${chat.memberIds.length} ${this.lang === 'ar' ? 'أعضاء' : 'Members'}</span>
                            <i data-lucide="chevron-down" id="members-chevron" style="width: 16px; transition: transform 0.3s;"></i>
                        </div>
                        <div id="group-members-list" class="scrollbar-hidden" style="display: none; width: 100%; max-width: 400px; margin: 16px auto 0; background: var(--glass-panel); border: 1px solid var(--glass-border); border-radius: 16px; padding: 12px; max-height: 250px; overflow-y: auto; text-align: left;" dir="${this.lang === 'ar' ? 'rtl' : 'ltr'}">
                        </div>
                    </div>
                    
                    <div style="width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
                        
                        <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.promptAddGroupMember('${chatId}')">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <i data-lucide="user-plus" style="color: #3b82f6; width: 20px;"></i>
                                <span style="font-weight: 500;">${this.lang === 'ar' ? 'إضافة أعضاء جدد' : 'Add New Members'}</span>
                            </div>
                            <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                        </button>
                        
                        <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.toggleArchive('${chatId}'); setTimeout(() => app.renderChatInfo('${chatId}'), 300)">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <i data-lucide="${archiveIcon}" style="color: var(--accent); width: 20px;"></i>
                                <span style="font-weight: 500;">${archiveText}</span>
                            </div>
                            <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                        </button>

                        <div style="margin-top: 12px; border-top: 1px solid var(--glass-border); padding-top: 12px;">
                            <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: rgba(245, 158, 11, 0.1);" onclick="app.leaveGroupPrompt('${chatId}')">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <i data-lucide="log-out" style="color: #f59e0b; width: 20px;"></i>
                                    <span style="font-weight: 500; color: #f59e0b;">${this.lang === 'ar' ? 'مغادرة المجموعة' : 'Leave Group'}</span>
                                </div>
                                <i data-lucide="chevron-right" style="width: 16px; opacity: 0.3;"></i>
                            </button>
                            
                            ${isAdmin ? `
                            <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: rgba(239, 68, 68, 0.1); margin-top: 12px;" onclick="app.deleteGroupPrompt('${chatId}')">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <i data-lucide="trash" style="color: #ef4444; width: 20px;"></i>
                                    <span style="font-weight: 500; color: #ef4444;">${this.lang === 'ar' ? 'حذف المجموعة للكل' : 'Delete Group for Everyone'}</span>
                                </div>
                                <i data-lucide="chevron-right" style="width: 16px; opacity: 0.3;"></i>
                            </button>
                            ` : ''}

                            <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s; margin-top: 12px;" onclick="app.showGroupQR('${chatId}')">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <i data-lucide="qr-code" style="color: var(--accent); width: 20px;"></i>
                                    <span style="font-weight: 500;">${this.lang === 'ar' ? 'رمز QR للمجموعة' : 'Group QR Code'}</span>
                                </div>
                                <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        const isBlocked = chat.blockedBy && chat.blockedBy.includes(this.user.uid);
        chatWindow.innerHTML = `
            <header class="chat-header">
                <button class="nav-item" onclick="app.selectChat('${chatId}')"><i data-lucide="chevron-left"></i></button>
                <h3 style="flex: 1; text-align: center; margin-right: 40px; font-size: 16px;">${this.lang === 'ar' ? 'معلومات المحادثة' : 'Chat Info'}</h3>
            </header>
            <div class="scrollbar-hidden" style="flex: 1; overflow-y: auto; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 24px;">
                <div style="position: relative;">
                    <img src="${partner.photo}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-lg); border: 4px solid var(--glass-border); cursor: pointer;" onclick="app.viewImage('${partner.photo}', false)">
                </div>
                <div style="text-align: center;">
                    <h2 style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${partner.name}</h2>
                    ${partner.username ? `<p style="color: var(--accent); font-weight: 600; font-size: 14px;">@${partner.username}</p>` : ''}
                </div>
                
                <div style="width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.toggleArchive('${chatId}'); setTimeout(() => app.renderChatInfo('${chatId}'), 300)">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="${archiveIcon}" style="color: var(--accent); width: 20px;"></i>
                            <span style="font-weight: 500;">${archiveText}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                    </button>

                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.toggleBlock('${chatId}')">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="${isBlocked ? 'user-check' : 'user-x'}" style="color: #ef4444; width: 20px;"></i>
                            <span style="font-weight: 500;">${isBlocked ? (this.lang === 'ar' ? 'إلغاء الحظر' : 'Unblock Contact') : (this.lang === 'ar' ? 'حظر المستخدم' : 'Block Contact')}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                    </button>
                    
                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.reportUser('${chatId}')">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="shield-alert" style="color: #f59e0b; width: 20px;"></i>
                            <span style="font-weight: 500;">${this.lang === 'ar' ? 'إبلاغ عن إساءة' : 'Report Abuse'}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                    </button>

                    <div style="margin-top: 12px; border-top: 1px solid var(--glass-border); padding-top: 12px;">
                        <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: rgba(239, 68, 68, 0.1);" onclick="app.deleteChatPrompt('${chatId}')">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <i data-lucide="trash-2" style="color: #ef4444; width: 20px;"></i>
                                <span style="font-weight: 500; color: #ef4444;">${this.lang === 'ar' ? 'مسح المحادثة' : 'Delete Conversation'}</span>
                            </div>
                            <i data-lucide="chevron-right" style="width: 16px; opacity: 0.3;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        lucide.createIcons();
    }

    async toggleBlock(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        const blockedBy = chat.blockedBy || [];
        const isBlocked = blockedBy.includes(this.user.uid);

        let newBlockedBy;
        if (isBlocked) {
            newBlockedBy = blockedBy.filter(id => id !== this.user.uid);
        } else {
            newBlockedBy = [...blockedBy, this.user.uid];
        }

        await updateDoc(doc(db, 'chats', chatId), { blockedBy: newBlockedBy });
        this.renderChatInfo(chatId);
    }

    reportUser(chatId) {
        this.showPrompt(
            this.lang === 'ar' ? 'الإبلاغ عن إساءة' : 'Report Abuse',
            this.lang === 'ar' ? 'حدثنا عن المشكلة باختصار وسنقوم بمراجعة آخر 10 رسائل:' : 'Tell us the reason (we will review the last 10 messages):',
            '',
            async (reason) => {
                if (!reason || !reason.trim()) return;

                const btn = document.querySelector('.glass-btn[onclick^="app.reportUser"]');
                if (btn) btn.style.opacity = '0.5';

                try {
                    const q = query(
                        collection(db, `chats/${chatId}/messages`),
                        orderBy('createdAt', 'desc'),
                        limit(10)
                    );
                    const snap = await getDocs(q);
                    let messages = snap.docs.map(doc => doc.data()).reverse();

                    // E2E: Local Decryption for reporting (Voluntary Disclosure for Abuse Moderation)
                    messages = await Promise.all(messages.map(async m => {
                        if (m.isE2E) {
                            return await this.decryptMessagePayload(m);
                        }
                        return m;
                    }));

                    const chat = this.allChats.find(c => c.id === chatId);
                    const targetId = chat.type !== 'group' ? chat.memberIds.find(id => id !== this.user.uid) : chatId;

                    const reportPayload = {
                        reporterId: this.user.uid,
                        reporterName: this.userData.displayName,
                        targetId: targetId,
                        chatId: chatId,
                        chatType: chat.type || 'direct',
                        reason: reason.trim(),
                        status: 'pending',
                        messages: messages.map(m => ({
                            senderId: m.senderId,
                            text: m.text || (m.image ? '[صورة مشفرة]' : (m.audio ? '[صوت مشفر]' : (m.gifUrl ? '[ملصق مشفر]' : ''))),
                            createdAt: m.createdAt ? m.createdAt.toMillis() : Date.now()
                        })),
                        createdAt: serverTimestamp()
                    };

                    await addDoc(collection(db, 'reports'), reportPayload);
                    this.showAlert(this.lang === 'ar' ? 'تم استلام البلاغ' : 'Report Sent', this.lang === 'ar' ? 'شكراً لك. سيتم مراجعة بلاغك واتخاذ الإجراء اللازم.' : 'Your report has been sent to the admins for review.');
                    this.closeChatInfo();
                } catch (e) {
                    console.error("Report failed:", e);
                    this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Error', this.lang === 'ar' ? 'حدث خطأ أثناء رفع البلاغ.' : 'Failed to submit report.');
                }

                if (btn) btn.style.opacity = '1';
            }
        );
    }

    changeGroupImage(event, chatId) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = 300;
                canvas.width = size;
                canvas.height = size;

                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;

                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

                const dataURL = canvas.toDataURL('image/jpeg', 0.8);
                await updateDoc(doc(db, 'chats', chatId), { photo: dataURL });
                setTimeout(() => this.renderChatInfo(chatId), 500);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    promptAddGroupMember(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        // Retrieve direct chat contacts
        const recentContacts = [];
        const seenUids = new Set();
        this.allChats.forEach(c => {
            if (c.type !== 'group' && c.type !== 'ai') {
                const partnerId = c.memberIds.find(id => id !== this.user.uid);
                if (partnerId && !seenUids.has(partnerId)) {
                    seenUids.add(partnerId);
                    const partnerData = c.memberData?.[partnerId];
                    if (partnerData) {
                        recentContacts.push({
                            uid: partnerId,
                            name: partnerData.name || partnerData.displayName || 'User',
                            photo: partnerData.photo || partnerData.photoURL || '',
                            username: partnerData.username || ''
                        });
                    }
                }
            }
        });

        // Generate the HTML for recent contacts list
        let contactsHTML = '';
        if (recentContacts.length === 0) {
            contactsHTML = `<div style="text-align: center; padding: 16px; color: var(--text-muted); font-size: 13px;">${this.lang === 'ar' ? 'لا يوجد جهات اتصال تواصلت معها مؤخراً.' : 'No recent contacts found.'}</div>`;
        } else {
            recentContacts.forEach(contact => {
                const isMember = chat.memberIds.includes(contact.uid);
                const btnHTML = isMember
                    ? `<span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${this.lang === 'ar' ? 'عضو' : 'Member'}</span>`
                    : `<button class="glass-btn" style="padding: 6px 12px; font-size: 12px; border-radius: 8px;" onclick="app.addGroupMemberByUid('${chatId}', '${contact.uid}', '${contact.name.replace(/'/g, "\\'")}', '${contact.photo}')">
                        <i data-lucide="plus" style="width: 12px; height: 12px; margin-right: 4px;"></i> ${this.lang === 'ar' ? 'إضافة' : 'Add'}
                       </button>`;

                const avatarSrc = contact.photo || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(contact.name);
                contactsHTML += `
                    <div class="add-member-tile">
                        <img src="${avatarSrc}" class="add-member-avatar" alt="Avatar">
                        <div class="add-member-info">
                            <div class="add-member-name">${contact.name}</div>
                            <div class="add-member-username">${contact.username ? '@' + contact.username : ''}</div>
                        </div>
                        <div class="add-member-action">
                            ${btnHTML}
                        </div>
                    </div>
                `;
            });
        }

        const title = this.lang === 'ar' ? 'إضافة أعضاء للمجموعة' : 'Add Group Members';
        const searchPlaceholder = this.lang === 'ar' ? 'بحث بالبريد أو اسم المستخدم...' : 'Search by email or username...';

        this.showModal(`
            <div class="add-member-modal-content">
                <div class="add-member-header">
                    <div class="add-member-icon-wrapper">
                        <i data-lucide="user-plus"></i>
                    </div>
                    <h3>${title}</h3>
                    <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">${chat.name}</p>
                </div>
                
                <!-- Search Section -->
                <div class="add-member-search-box">
                    <input type="text" id="add-member-search-input" class="dialog-input" style="flex-grow: 1; height: 42px; border-radius: 12px; margin: 0; padding: 0 16px;" placeholder="${searchPlaceholder}" onkeydown="if(event.key === 'Enter') app.searchNewMemberForGroup('${chatId}')">
                    <button class="glass-btn" style="height: 42px; width: 42px; padding: 0; border-radius: 12px; flex-shrink: 0;" onclick="app.searchNewMemberForGroup('${chatId}')">
                        <i data-lucide="search" style="width: 18px; height: 18px;"></i>
                    </button>
                </div>
                
                <!-- Search Results Container -->
                <div id="add-member-search-results" class="add-member-results scrollbar-hidden hidden" style="max-height: 120px; overflow-y: auto; margin-bottom: 12px; width: 100%;"></div>
                
                <!-- Recent Contacts Section -->
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px; font-weight: 600; text-align: left; width: 100%;">
                    ${this.lang === 'ar' ? 'أشخاص تواصلت معهم مؤخراً:' : 'Recent Contacts:'}
                </div>
                <div class="add-member-list scrollbar-hidden" style="max-height: 250px; overflow-y: auto; width: 100%; display: flex; flex-direction: column; gap: 8px;">
                    ${contactsHTML}
                </div>
                
                <button class="btn-ghost" style="width: 100%; margin-top: 20px; height: 44px; border-radius: 12px;" onclick="app.closeModal()">${this.t('dismiss')}</button>
            </div>
        `);
        if (window.lucide) lucide.createIcons({ node: document.getElementById('modal-content') });
    }

    async searchNewMemberForGroup(chatId) {
        const input = document.getElementById('add-member-search-input');
        if (!input) return;
        const val = input.value.trim();
        if (!val) return;

        const resultsContainer = document.getElementById('add-member-search-results');
        resultsContainer.innerHTML = `<div style="text-align: center; padding: 12px; color: var(--text-muted);"><span class="loading-spinner"></span> ${this.lang === 'ar' ? 'جاري البحث...' : 'Searching...'}</div>`;
        resultsContainer.classList.remove('hidden');

        try {
            const users = await this.findUsersByIdentifiers([val]);
            if (users.length === 0) {
                resultsContainer.innerHTML = `<div style="text-align: center; padding: 12px; color: var(--danger); font-size: 13px;">${this.lang === 'ar' ? 'لم يتم العثور على الحساب.' : 'Account not found.'}</div>`;
                return;
            }

            const user = users[0];
            const chat = this.allChats.find(c => c.id === chatId);
            const isMember = chat.memberIds.includes(user.uid);
            
            const btnHTML = isMember
                ? `<span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${this.lang === 'ar' ? 'عضو بالفعل' : 'Already Member'}</span>`
                : `<button class="glass-btn" style="padding: 6px 12px; font-size: 12px; border-radius: 8px;" onclick="app.addGroupMemberByUid('${chatId}', '${user.uid}', '${user.displayName.replace(/'/g, "\\'")}', '${user.photoURL}')">
                    <i data-lucide="plus" style="width: 12px; height: 12px; margin-right: 4px;"></i> ${this.lang === 'ar' ? 'إضافة' : 'Add'}
                   </button>`;

            resultsContainer.innerHTML = `
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; font-weight: 600; text-align: left;">${this.lang === 'ar' ? 'نتائج البحث:' : 'Search Results:'}</div>
                <div class="add-member-tile" style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.15);">
                    <img src="${user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName)}" class="add-member-avatar">
                    <div class="add-member-info">
                        <div class="add-member-name">${user.displayName}</div>
                        <div class="add-member-username">@${user.username}</div>
                    </div>
                    <div class="add-member-action">
                        ${btnHTML}
                    </div>
                </div>
                <div style="border-bottom: 1px solid var(--glass-border); margin: 12px 0;"></div>
            `;
            if (window.lucide) lucide.createIcons({ node: resultsContainer });
        } catch (e) {
            console.error("Search failed:", e);
            resultsContainer.innerHTML = `<div style="text-align: center; padding: 12px; color: var(--danger); font-size: 13px;">${this.lang === 'ar' ? 'حدث خطأ أثناء البحث.' : 'Error searching user.'}</div>`;
        }
    }

    async addGroupMemberByUid(chatId, contactUid, contactName, contactPhoto) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        if (chat.memberIds.includes(contactUid)) return;

        try {
            const newIds = [...chat.memberIds, contactUid];
            const newMemberData = { 
                ...chat.memberData, 
                [contactUid]: { name: contactName, photo: contactPhoto } 
            };

            await updateDoc(doc(db, 'chats', chatId), {
                memberIds: newIds,
                memberData: newMemberData
            });

            this.showAlert(
                this.lang === 'ar' ? 'تمت الإضافة' : 'Added',
                this.lang === 'ar' ? `تم إضافة ${contactName} للمجموعة.` : `${contactName} has been added to the group.`
            );

            // Re-render the Add Member modal to update the statuses!
            this.promptAddGroupMember(chatId);
            this.renderChatInfo(chatId);
        } catch (e) {
            console.error("Failed to add member by UID:", e);
            this.showAlert(
                this.lang === 'ar' ? 'خطأ' : 'Error',
                this.lang === 'ar' ? 'فشل إضافة العضو للمجموعة.' : 'Failed to add member to group.'
            );
        }
    }

    promptRenameGroup(chatId, currentName) {
        this.showPrompt(
            this.lang === 'ar' ? 'تعديل اسم المجموعة' : 'Rename Group',
            this.lang === 'ar' ? 'الاسم الجديد للمجموعة:' : 'New Group Name:',
            currentName,
            async (newName) => {
                const name = newName?.trim();
                if (!name) return;
                if (name === currentName) return;

                try {
                    await updateDoc(doc(db, 'chats', chatId), { name: name });
                    
                    // Update locally
                    const chatIndex = this.allChats.findIndex(c => c.id === chatId);
                    if (chatIndex !== -1) {
                        this.allChats[chatIndex].name = name;
                    }

                    this.showAlert(
                        this.lang === 'ar' ? 'تم التعديل' : 'Success',
                        this.lang === 'ar' ? 'تم تعديل اسم المجموعة بنجاح.' : 'Group name updated successfully.'
                    );
                    
                    this.renderChatInfo(chatId);
                } catch (e) {
                    console.error("Failed to rename group:", e);
                    this.showAlert(
                        this.lang === 'ar' ? 'خطأ' : 'Error',
                        this.lang === 'ar' ? 'فشل تعديل اسم المجموعة.' : 'Failed to rename group.'
                    );
                }
            }
        );
    }

    leaveGroupPrompt(chatId) {
        this.showConfirm(
            this.lang === 'ar' ? 'مغادرة المجموعة' : 'Leave Group',
            this.lang === 'ar' ? 'هل أنت متأكد من مغادرة هذه المجموعة نهائياً؟' : 'Are you sure you want to completely leave this group?',
            async () => {
                const chat = this.allChats.find(c => c.id === chatId);
                if (!chat) return;
                const newMembers = chat.memberIds.filter(id => id !== this.user.uid);
                await updateDoc(doc(db, 'chats', chatId), { memberIds: newMembers });

                this.closeMobileOverlay();
                this.activeChatId = null;
                this.renderFilteredChats();
                const emptyState = document.getElementById('empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
            }
        );
    }

    deleteGroupPrompt(chatId) {
        this.showConfirm(
            this.lang === 'ar' ? 'مسح المجموعة للكل' : 'Delete Group for Everyone',
            this.lang === 'ar' ? 'هذا سيمحو المجموعة ومحتواها للجميع للأبد!' : 'This will securely erase the group and contents for all participants forever!',
            async () => {
                await deleteDoc(doc(db, `chats`, chatId));

                this.closeMobileOverlay();
                this.activeChatId = null;
                this.renderFilteredChats();
                const emptyState = document.getElementById('empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
            }
        );
    }

    // --- Group Members Administration ---

    toggleMembersList(chatId) {
        const listDiv = document.getElementById('group-members-list');
        const chevron = document.getElementById('members-chevron');
        if (!listDiv || !chevron) return;

        if (listDiv.style.display === 'none') {
            listDiv.style.display = 'block';
            chevron.style.transform = 'rotate(180deg)';
            this.renderGroupMembers(chatId);
        } else {
            listDiv.style.display = 'none';
            chevron.style.transform = 'rotate(0deg)';
        }
    }

    renderGroupMembers(chatId) {
        const listDiv = document.getElementById('group-members-list');
        if (!listDiv) return;
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        const creatorId = chat.memberIds[0];
        const admins = chat.admins || [creatorId];
        const amIAdmin = admins.includes(this.user.uid);

        let html = '';
        chat.memberIds.forEach(uid => {
            const member = chat.memberData[uid];
            if (!member) return;
            const isCreator = uid === creatorId;
            const isMemberAdmin = admins.includes(uid);

            let badges = '';
            if (isCreator) badges = `<span style="font-size: 10px; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 2px 6px; border-radius: 8px;">${this.lang === 'ar' ? 'منشئ' : 'Creator'}</span>`;
            else if (isMemberAdmin) badges = `<span style="font-size: 10px; background: rgba(59, 130, 246, 0.2); color: #3b82f6; padding: 2px 6px; border-radius: 8px;">${this.lang === 'ar' ? 'مشرف' : 'Admin'}</span>`;

            // Long press logic -> Only Admins can govern others, nobody can govern creator.
            let pressEvents = '';
            if (amIAdmin) {
                pressEvents = `onmousedown="app.startMemberPress(event, '${chatId}', '${uid}')" onmouseup="app.cancelMemberPress()" onmouseleave="app.cancelMemberPress()" ontouchstart="app.startMemberPress(event, '${chatId}', '${uid}')" ontouchend="app.cancelMemberPress()"`;
            }

            html += `
                <div style="display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 12px; transition: background 0.2s; cursor: pointer;" class="hover-bg" ${pressEvents}>
                    <img src="${member.photo}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${member.name} ${uid === this.user.uid ? (this.lang === 'ar' ? '(أنت)' : '(You)') : ''}</span>
                            ${badges}
                        </div>
                    </div>
                </div>
            `;
        });

        listDiv.innerHTML = html;
        if (amIAdmin) {
            const hint = document.createElement('div');
            hint.style.cssText = "font-size: 11px; text-align: center; color: var(--text-secondary); margin-top: 8px; opacity: 0.7;";
            hint.innerText = this.lang === 'ar' ? 'اضغط مطولاً على شخص لإدارة صلاحياته' : 'Long press a member to manage';
            listDiv.appendChild(hint);
        }
    }

    startMemberPress(e, chatId, uid) {
        if (e.type === 'touchstart') e.preventDefault();
        // Clear any existing timer
        if (this.pressTimer) clearTimeout(this.pressTimer);

        let clientX = e.clientX;
        let clientY = e.clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }

        this.pressTimer = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50);
            this.showMemberOptions(chatId, uid, clientX, clientY);
        }, 600); // 600ms long press
    }

    cancelMemberPress() {
        if (this.pressTimer) clearTimeout(this.pressTimer);
    }

    showMemberOptions(chatId, targetUid, x, y) {
        if (targetUid === this.user.uid) return;

        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        const creatorId = chat.memberIds[0];
        const admins = chat.admins || [creatorId];

        const isTargetCreator = targetUid === creatorId;
        const isTargetAdmin = admins.includes(targetUid);
        const amICreator = this.user.uid === creatorId;
        const amIAdmin = admins.includes(this.user.uid);

        if (!amIAdmin) return;
        if (isTargetCreator) {
            return this.showAlert(this.lang === 'ar' ? 'غير مصرح' : 'Unauthorized', this.lang === 'ar' ? 'لا يمكنك طرد أو تعديل صلاحيات منشئ المجموعة.' : 'You cannot kick or alter the group creator.');
        }

        const member = chat.memberData[targetUid];
        const options = [];

        if (!isTargetAdmin) {
            options.push({
                label: this.lang === 'ar' ? 'إعطاء مشرف للمجموعة' : 'Make Group Admin',
                icon: 'shield-check',
                color: '#3b82f6',
                action: async () => {
                    const newAdmins = [...admins, targetUid];
                    await updateDoc(doc(db, 'chats', chatId), { admins: newAdmins });
                    this.renderGroupMembers(chatId);
                }
            });
        }

        options.push({
            label: this.lang === 'ar' ? 'طرد من المجموعة' : 'Kick Member',
            icon: 'user-minus',
            color: '#ef4444',
            action: async () => {
                const newMemberIds = chat.memberIds.filter(id => id !== targetUid);
                await updateDoc(doc(db, 'chats', chatId), { memberIds: newMemberIds });
                this.renderGroupMembers(chatId);
            }
        });

        options.push({
            label: this.lang === 'ar' ? 'مسح جميع الرسائل' : 'Delete Member Messages',
            icon: 'message-square-x',
            color: '#f59e0b',
            action: async () => {
                this.showConfirm(
                    this.lang === 'ar' ? 'مسح الرسائل' : 'Delete Messages',
                    this.lang === 'ar' ? 'هل أنت متأكد من مسح جميع رسائل هذا الشخص في هذا الجروب؟' : 'Are you sure you want to delete all messages by this member in this group?',
                    async () => {
                        const q = query(collection(db, `chats/${chatId}/messages`), where('senderId', '==', targetUid));
                        const snap = await getDocs(q);
                        const batch = writeBatch(db);
                        snap.forEach(d => batch.delete(d.ref));
                        await batch.commit();
                        this.showAlert(this.lang === 'ar' ? 'تم الحذف' : 'Success', this.lang === 'ar' ? 'تم مسح الرسائل الخاصة به.' : 'Messages deleted.');
                    }
                );
            }
        });

        // Close any existing
        document.getElementById('member-options-popup')?.remove();
        document.getElementById('member-options-backdrop')?.remove();

        // Create Backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'member-options-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:9998;';
        backdrop.onclick = () => {
            document.getElementById('member-options-popup')?.remove();
            backdrop.remove();
        };
        document.body.appendChild(backdrop);

        let btnsHtml = options.map((opt, i) => `
            <button class="msg-option-btn" style="color: ${opt.color}; padding: 12px; gap: 12px; font-weight: 500;" id="memopt-${i}">
                <i data-lucide="${opt.icon}" style="width: 18px; margin: 0;"></i>
                ${opt.label}
            </button>
        `).join('');

        // Floating Popup
        const popup = document.createElement('div');
        popup.id = 'member-options-popup';
        popup.innerHTML = `
            <div style="padding: 12px 12px 8px; border-bottom: 1px solid var(--glass-border); display: flex; align-items: center; gap: 10px;">
                <img src="${member.photo}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                <div style="min-width: 0; flex: 1; text-align: ${this.lang === 'ar' ? 'right' : 'left'}">
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${member.name}</div>
                </div>
            </div>
            <div style="padding: 4px;">
                ${btnsHtml}
            </div>
        `;
        document.body.appendChild(popup);
        lucide.createIcons({ node: popup });

        // Position Logic (similarly to msg-options)
        const popupW = 240; // Approx fixed width
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let px = x || (vw / 2);
        let py = y || (vh / 2);

        // Render initially offscreen to measure height if needed, but styling first
        popup.className = 'msg-options-popup'; // Use existing css animations
        popup.style.cssText = `
            position: fixed;
            z-index: 9999;
            width: ${popupW}px;
            background: var(--glass-panel-solid);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10);
            animation: popup-appear 0.18s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        `;

        const popupH = popup.getBoundingClientRect().height;

        let originClass = '';
        if (px + popupW > vw - 10) { px = px - popupW + 20; originClass += ' popup-bottom-right'; }
        if (py + popupH > vh - 10) { py = py - popupH - 10; originClass += ' popup-top-left'; }

        if (originClass.includes('popup-bottom-right') && originClass.includes('popup-top-left')) {
            originClass = 'popup-top-right';
        }

        popup.className = 'msg-options-popup ' + originClass.trim();
        popup.style.left = Math.max(8, px) + 'px';
        popup.style.top = Math.max(8, py) + 'px';

        options.forEach((opt, i) => {
            document.getElementById(`memopt-${i}`).onclick = (evt) => {
                evt.stopPropagation();
                popup.remove();
                backdrop.remove();
                opt.action();
            };
        });
    }

    async deleteChatPrompt(chatId) {
        this.showConfirm(
            this.lang === 'ar' ? 'حذف المحادثة' : 'Delete Conversation',
            this.lang === 'ar' ? 'تحذير: هل أنت متأكد من مسح أو مغادرة هذه المحادثة نهائياً؟' : 'Warning: Are you sure you want to completely delete or leave this conversation?',
            async () => {
                const chat = this.allChats.find(c => c.id === chatId);
                if (!chat) return;
                const newMembers = chat.memberIds.filter(id => id !== this.user.uid);
                await setDoc(doc(db, 'chats', chatId), { memberIds: newMembers }, { merge: true });
                this.closeMobileOverlay();
                this.activeChatId = null;
                this.renderFilteredChats();
                this.closeModal();
                const chatWindow = document.getElementById('chat-window');
                if (chatWindow) chatWindow.classList.add('hidden');
                const emptyState = document.getElementById('empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
            }
        );
    }

    // --- Long Press & Swipe Gestures ---
    onMsgContextMenu(e, chatId, msgId) {
        e.preventDefault();
        this.showMsgOptions(e, chatId, msgId);
    }

    onMsgTouchStart(e, chatId, msgId) {
        this.msgTouchTarget = e.currentTarget;
        this.msgTouchStartX = e.touches[0].clientX;
        this.msgTouchStartY = e.touches[0].clientY;
        this.msgSwipeDx = 0;
        this.msgSwipeStarted = false;

        this._longPressTimer = setTimeout(() => {
            if (!this.msgSwipeStarted) {
                const touch = e.touches[0];
                const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => { } };
                this.showMsgOptions(fakeEvent, chatId, msgId);
                if (navigator.vibrate) navigator.vibrate(30);
            }
        }, 500);
    }

    onMsgTouchMove(e, chatId, msgId) {
        if (!this.msgTouchStartX || !this.msgTouchTarget) return;
        const dx = e.touches[0].clientX - this.msgTouchStartX;
        const dy = e.touches[0].clientY - this.msgTouchStartY;

        if (!this.msgSwipeStarted && Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
            this.msgSwipeStarted = true;
            clearTimeout(this._longPressTimer);
        }

        if (this.msgSwipeStarted) {
            this.msgSwipeDx = dx;

            // Limit swipe visual representation
            let visualDx = this.lang === 'ar' ? dx : dx;
            // In LTR, swipe left (negative) to reply. In RTL, swipe right (positive) to reply.
            if (this.lang === 'ar') {
                if (visualDx < 0) visualDx = 0;
                else if (visualDx > 60) visualDx = 60 + (visualDx - 60) * 0.2;
            } else {
                if (visualDx > 0) visualDx = 0;
                else if (visualDx < -60) visualDx = -60 + (visualDx + 60) * 0.2;
            }

            this.msgTouchTarget.style.transform = `translateX(${visualDx}px)`;
        } else if (Math.abs(dy) > 15) {
            clearTimeout(this._longPressTimer);
        }
    }

    onMsgTouchEnd(e, chatId, msgId) {
        clearTimeout(this._longPressTimer);
        if (this.msgSwipeStarted && this.msgTouchTarget) {
            const threshold = 50;
            if (Math.abs(this.msgSwipeDx) >= threshold) {
                if (navigator.vibrate) navigator.vibrate(15);
                this.prepareReply(chatId, msgId);
            }

            // Snap back
            this.msgTouchTarget.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            this.msgTouchTarget.style.transform = 'translateX(0)';
            const target = this.msgTouchTarget;
            setTimeout(() => {
                if (target) {
                    target.style.transition = '';
                    target.style.transform = '';
                }
            }, 300);
        }

        this.msgTouchTarget = null;
        this.msgTouchStartX = null;
        this.msgSwipeStarted = false;
        this.msgSwipeDx = 0;
    }

    onMsgMouseDown(e, chatId, msgId) {
        if (e.button !== 0) return;
        this._longPressTimer = setTimeout(() => {
            this.showMsgOptions(e, chatId, msgId);
        }, 500);
    }

    onMsgMouseUp(e) {
        clearTimeout(this._longPressTimer);
    }

    showMsgOptions(e, chatId, msgId) {
        const msg = this.currentMessages[msgId];
        if (!msg) return;
        const isMine = msg.senderId === this.user.uid;
        const canEdit = isMine && !msg.image && !msg.audio;

        let buttonsHTML = '';
        buttonsHTML += `<button class="msg-option-btn" onclick="app.prepareReply('${chatId}', '${msgId}')">
            <i data-lucide="corner-down-left"></i>
            ${this.lang === 'ar' ? 'رد' : 'Reply'}
        </button>`;

        if (msg.text) {
            buttonsHTML += `<button class="msg-option-btn" onclick="app.copyMsg('${msgId}')">
                <i data-lucide="copy"></i>
                ${this.lang === 'ar' ? 'نسخ النص' : 'Copy Text'}
            </button>`;
        }
        if (canEdit) {
            buttonsHTML += `<button class="msg-option-btn" onclick="app.editMsgPrompt('${chatId}', '${msgId}')">
                <i data-lucide="edit-2"></i>
                ${this.lang === 'ar' ? 'تعديل' : 'Edit Message'}
            </button>`;
        }
        if (msg.image) {
            buttonsHTML += `<button class="msg-option-btn" onclick="app.viewImage('${msg.image}'); app.closeMsgOptionsPopup();">
                <i data-lucide="maximize"></i>
                ${this.lang === 'ar' ? 'عرض الصورة كاملة' : 'View Full Image'}
            </button>`;
        }

        if (!buttonsHTML && !isMine) return;

        if (!buttonsHTML) return;

        // Reaction Bar
        const emojis = ['❤️', '😂', '😮', '😢', '🔥', '👍'];
        const reactionsHTML = `
            <div class="reaction-picker">
                ${emojis.map(e => `<button class="reaction-btn" onclick="app.addReaction('${chatId}', '${msgId}', '${e}')">${e}</button>`).join('')}
                <button class="reaction-btn add-reaction-trigger" onclick="app.showAllReactionsPicker('${chatId}', '${msgId}'); event.stopPropagation();" style="width: 26px; height: 26px; border-radius: 50%; background: var(--glass-hover, rgba(255, 255, 255, 0.08)); display: flex; align-items: center; justify-content: center; padding: 0; border: none; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.transform='scale(1.15)';" onmouseout="this.style.transform='scale(1)';">
                    <i data-lucide="plus" style="width: 14px; height: 14px; color: var(--text-secondary); margin: 0; opacity: 0.85;"></i>
                </button>
            </div>
        `;

        if (buttonsHTML && isMine) {
            buttonsHTML += `<div class="msg-option-divider"></div>`;
        }
        if (isMine) {
            buttonsHTML += `<button class="msg-option-btn danger" onclick="app.deleteMsg('${chatId}', '${msgId}')">
                <i data-lucide="trash-2"></i>
                ${this.lang === 'ar' ? 'حذف للكل' : 'Delete for Everyone'}
            </button>`;
        }

        if (!buttonsHTML) return;

        // Remove any existing popup
        this.closeMsgOptionsPopup();

        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'msg-options-backdrop';
        backdrop.onclick = () => this.closeMsgOptionsPopup();
        document.body.appendChild(backdrop);

        // Create popup
        const popup = document.createElement('div');
        popup.id = 'msg-options-popup';
        popup.innerHTML = reactionsHTML + buttonsHTML;
        document.body.appendChild(popup);
        lucide.createIcons({ node: popup });

        // Position popup near the touch/click point
        const popupW = 220;
        const popupH = popup.getBoundingClientRect().height || 180;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let x = e.clientX;
        let y = e.clientY;

        // Flip if too close to edges
        let originClass = '';
        if (x + popupW > vw - 10) { x = x - popupW; originClass += ' popup-bottom-right'; }
        if (y + popupH > vh - 10) { y = y - popupH; originClass += ' popup-top-left'; }
        if (originClass.includes('popup-bottom-right') && originClass.includes('popup-top-left')) {
            originClass = 'popup-top-right';
        }
        popup.className = 'msg-options-popup ' + originClass.trim();
        popup.id = 'msg-options-popup';
        popup.style.left = Math.max(8, x) + 'px';
        popup.style.top = Math.max(8, y) + 'px';
    }

    closeMsgOptionsPopup() {
        document.getElementById('msg-options-popup')?.remove();
        document.getElementById('msg-options-backdrop')?.remove();
    }

    showAllReactionsPicker(chatId, msgId) {
        this.closeMsgOptionsPopup();

        // Remove existing ones if any
        this.closeAllReactionsPicker();

        // Create Backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'all-reactions-backdrop';
        backdrop.id = 'all-reactions-backdrop';
        backdrop.onclick = () => this.closeAllReactionsPicker();
        document.body.appendChild(backdrop);

        // Create Modal
        const modal = document.createElement('div');
        modal.className = 'all-reactions-modal';
        modal.id = 'all-reactions-modal';

        const popularEmojis = [
            // Popular & Hand Gestures
            '👍', '👎', '✊', '👊', '🤛', '🤜', '🤝', '🙌', '👐', '🤲', '👏', '🙏', '💪', '✍️', '💅', '🤳', '🦵', '🦶', '👂', '👃', '🧠', '👀',
            // Smileys & Emotion
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕',
            // Love & Hearts
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌', '🔥', '✨', '🌟', '⭐', '🎉', '🎈', '🔮'
        ];

        const gridHTML = popularEmojis.map(emoji => `
            <button class="all-reactions-emoji" onclick="app.addReaction('${chatId}', '${msgId}', '${emoji}'); app.closeAllReactionsPicker(); event.stopPropagation();">
                ${emoji}
            </button>
        `).join('');

        modal.innerHTML = `
            <div class="all-reactions-header">
                <h3>${this.lang === 'ar' ? 'تفاعل بإيموجي' : 'React with Emoji'}</h3>
                <button class="all-reactions-close" onclick="app.closeAllReactionsPicker(); event.stopPropagation();">
                    <i data-lucide="x" style="width: 20px; height: 20px;"></i>
                </button>
            </div>
            <div class="all-reactions-grid scrollbar-hidden">
                ${gridHTML}
            </div>
        `;

        document.body.appendChild(modal);
        lucide.createIcons({ node: modal });

        // Trigger animations
        setTimeout(() => {
            backdrop.classList.add('active');
            modal.classList.add('active');
        }, 10);
    }

    closeAllReactionsPicker() {
        const backdrop = document.getElementById('all-reactions-backdrop');
        const modal = document.getElementById('all-reactions-modal');
        if (backdrop && modal) {
            backdrop.classList.remove('active');
            modal.classList.remove('active');
            setTimeout(() => {
                backdrop.remove();
                modal.remove();
            }, 300); // Wait for transition
        } else {
            backdrop?.remove();
            modal?.remove();
        }
    }

    prepareReply(chatId, msgId) {
        this.closeMsgOptionsPopup();
        this.replyToMsgId = msgId;
        const msg = this.currentMessages[msgId];
        if (!msg) return;

        let replyPreview = document.getElementById('reply-preview-box');
        if (!replyPreview) {
            replyPreview = document.createElement('div');
            replyPreview.id = 'reply-preview-box';
            replyPreview.style.cssText = `
                background: var(--glass-panel-solid);
                backdrop-filter: blur(10px);
                border-${this.lang === 'ar' ? 'right' : 'left'}: 4px solid var(--accent);
                padding: 10px 14px;
                border-radius: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 13px;
                margin: 0 16px -12px 16px;
                position: relative;
                z-index: 10;
                box-shadow: var(--shadow-sm);
            `;
            const inputArea = document.querySelector('.input-area > div');
            inputArea.parentElement.insertBefore(replyPreview, inputArea);
        }

        let previewText = msg.text || (msg.image ? (this.lang === 'ar' ? '📷 صورة' : '📷 Image') : (this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message'));
        if (previewText.length > 60) previewText = previewText.substring(0, 60) + '...';

        const chat = this.allChats.find(c => c.id === chatId);
        const replyName = msg.senderId === this.user.uid ? (this.lang === 'ar' ? 'أنت' : 'You') : (chat.memberData[msg.senderId]?.name || 'User');

        replyPreview.innerHTML = `
            <div style="flex: 1; min-width: 0; text-align: ${this.lang === 'ar' ? 'right' : 'left'};">
                <div style="font-weight: 700; color: var(--accent); margin-bottom: 2px;">${replyName}</div>
                <div style="color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${previewText}</div>
            </div>
            <button onclick="app.cancelReply()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; flex-shrink: 0; margin-${this.lang === 'ar' ? 'right' : 'left'}: 12px;">
                <i data-lucide="x" style="width: 18px;"></i>
            </button>
        `;
        lucide.createIcons();
        document.getElementById('msg-input').focus();
    }

    cancelReply() {
        this.replyToMsgId = null;
        document.getElementById('reply-preview-box')?.remove();
    }

    async copyMsg(msgId) {
        const msg = this.currentMessages[msgId];
        if (msg && msg.text) {
            navigator.clipboard.writeText(msg.text);
        }
        this.closeMsgOptionsPopup();
    }

    async editMsgPrompt(chatId, msgId) {
        this.closeMsgOptionsPopup();
        const msg = this.currentMessages[msgId];
        this.showPrompt(
            this.lang === 'ar' ? 'تعديل الرسالة' : 'Edit Message',
            this.lang === 'ar' ? 'قم بتعديل نص الرسالة:' : 'Edit the message text:',
            msg.text,
            async (newText) => {
                if (newText && newText.trim() !== '' && newText.trim() !== msg.text) {
                    const text = newText.trim();
                    const chat = this.allChats.find(c => c.id === chatId);

                    let updateData = { text, edited: true };
                    let sidebarUpdate = { 'lastMessage.text': text };

                    if (chat && chat.type !== 'ai') {
                        const e2eData = await this.encryptMessagePayload(chat, { text });
                        updateData = {
                            ...e2eData, // This overwrites ciphertext, iv, keys
                            text: this.lang === 'ar' ? '🔒 رسالة مشفرة (بعد التعديل)' : '🔒 Encrypted (Edited)',
                            edited: true
                        };
                        sidebarUpdate = {
                            'lastMessage.text': this.lang === 'ar' ? '🔒 رسالة مشفرة' : '🔒 Encrypted Message',
                            ...Object.keys(e2eData).reduce((acc, k) => ({ ...acc, [`lastMessage.${k}`]: e2eData[k] }), {})
                        };
                    }

                    await updateDoc(doc(db, `chats/${chatId}/messages`, msgId), updateData);

                    // Update sidebar if this was the last message
                    if (chat && chat.lastMessage && chat.lastMessage.msgId === msgId) {
                        await updateDoc(doc(db, 'chats', chatId), sidebarUpdate);
                    }
                }
            }
        );
    }

    async deleteMsg(chatId, msgId) {
        this.closeMsgOptionsPopup();
        this.showConfirm(
            this.lang === 'ar' ? 'حذف الرسالة' : 'Delete Message',
            this.lang === 'ar' ? 'هل أنت متأكد من حذف هذه الرسالة نهائياً؟' : 'Are you sure you want to delete this message permanently?',
            async () => {
                await deleteDoc(doc(db, `chats/${chatId}/messages`, msgId));

                // Update sidebar if this was the last message
                const chat = this.allChats.find(c => c.id === chatId);
                if (chat) {
                    const msg = this.currentMessages ? this.currentMessages[msgId] : null;

                    // Decrement unread counts for others if they had unread messages
                    // and this message wasn't explicitly marked as read
                    const updates = {};
                    let hasUpdates = false;
                    Object.keys(chat.unreadCounts || {}).forEach(uid => {
                        if (uid !== this.user.uid && chat.unreadCounts[uid] > 0) {
                            if (!(msg && msg.status === 'read')) {
                                updates[`unreadCounts.${uid}`] = chat.unreadCounts[uid] - 1;
                                hasUpdates = true;
                            }
                        }
                    });

                    if (chat.lastMessage && chat.lastMessage.msgId === msgId) {
                        const q = query(collection(db, `chats/${chatId}/messages`), orderBy('createdAt', 'desc'), limit(1));
                        const snap = await getDocs(q);
                        if (!snap.empty) {
                            const last = snap.docs[0].data();
                            const lastMsgId = snap.docs[0].id;

                            const sidebarLabel = {
                                ...last,
                                msgId: lastMsgId
                            };
                            if (sidebarLabel.createdAt) delete sidebarLabel.createdAt;

                            updates.lastMessage = sidebarLabel;
                            hasUpdates = true;
                        } else {
                            updates.lastMessage = null;
                            hasUpdates = true;
                        }
                    }

                    if (hasUpdates) {
                        try {
                            await updateDoc(doc(db, 'chats', chatId), updates);
                        } catch (e) {
                            console.error("Failed to update chat on msg deletion", e);
                        }
                    }
                }
            }
        );
    }

    // --- Search & Real Users ---
    // Note: Modal methods moved to ui.js

    showNewChatModal() {
        this.showModal(`
            <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 20px; text-align: center; color: var(--text-primary);">${this.t('start_context')}</h2>
            <div style="display:flex; gap: 12px; margin-bottom: 20px;">
                <button id="tab-direct" class="glass-btn" style="flex:1; transition: all 0.25s;" onclick="app.setChatFormTab('direct')">${this.t('private_chat')}</button>
                <button id="tab-group" class="btn-ghost" style="flex:1; transition: all 0.25s;" onclick="app.setChatFormTab('group')">${this.t('group_chat')}</button>
            </div>
            <div id="modal-form-area" style="display:flex; flex-direction: column; gap: 16px;"></div>
        `);
        this.setChatFormTab('direct');
    }

    setChatFormTab(type) {
        this.renderChatForm(type);

        const tabDirect = document.getElementById('tab-direct');
        const tabGroup = document.getElementById('tab-group');

        if (!tabDirect || !tabGroup) return;

        // Brand colors and custom styles for pristine visual toggling
        const activeStyles = {
            background: 'var(--accent)',
            color: '#ffffff',
            border: 'none',
            fontWeight: '600'
        };

        const inactiveStyles = {
            background: 'rgba(255, 255, 255, 0.04)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--glass-border)',
            fontWeight: '500'
        };

        const applyStyles = (element, styles) => {
            element.style.background = styles.background;
            element.style.color = styles.color;
            element.style.border = styles.border;
            element.style.fontWeight = styles.fontWeight;
        };

        if (type === 'direct') {
            tabDirect.className = 'glass-btn';
            applyStyles(tabDirect, activeStyles);

            tabGroup.className = 'btn-ghost';
            applyStyles(tabGroup, inactiveStyles);
        } else {
            tabGroup.className = 'glass-btn';
            applyStyles(tabGroup, activeStyles);

            tabDirect.className = 'btn-ghost';
            applyStyles(tabDirect, inactiveStyles);
        }
    }

    renderChatForm(type) {
        const area = document.getElementById('modal-form-area');
        const inputBaseStyle = `
            width: 100%;
            padding: 14px 18px;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--glass-border);
            color: var(--text-primary);
            font-size: 14px;
            outline: none;
            transition: all 0.2s ease;
            font-family: 'Outfit', sans-serif;
        `;

        if (type === 'direct') {
            area.innerHTML = `
                <input type="text" id="target-identifier" placeholder="${this.t('email_user_placeholder')}" autocomplete="off" style="${inputBaseStyle}" onfocus="this.style.borderColor='var(--accent)'; this.style.background='rgba(255, 255, 255, 0.08)';" onblur="this.style.borderColor='var(--glass-border)'; this.style.background='rgba(255, 255, 255, 0.05)';">
                <div style="display: flex; gap: 12px; margin-top: 8px;">
                    <button class="btn-ghost" style="flex:1" onclick="app.closeModal()">${this.t('dismiss')}</button>
                    <button class="glass-btn" style="flex:1" onclick="app.startDirectChat()">${this.t('connect')}</button>
                </div>
            `;
        } else {
            // Get all direct contacts from active direct chats
            const contacts = [];
            this.allChats.forEach(chat => {
                if (chat.type === 'direct' && !chat.id.endsWith('_ai')) {
                    const partnerUid = chat.memberIds.find(id => id !== this.user.uid);
                    if (partnerUid) {
                        const partner = chat.memberData[partnerUid];
                        if (partner) {
                            contacts.push({
                                uid: partnerUid,
                                name: partner.name,
                                photo: partner.photo || 'assets/logo.jpg',
                                identifier: partner.username || partner.email || partner.name
                            });
                        }
                    }
                }
            });

            const contactsHTML = contacts.length > 0 ? `
                <div style="margin-top: 4px; text-align: start; direction: ${this.lang === 'ar' ? 'rtl' : 'ltr'};">
                    <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; display: block;">
                        ${this.lang === 'ar' ? 'اختر من محادثاتك:' : 'Select from your chats:'}
                    </label>
                    <div style="display: flex; gap: 10px; overflow-x: auto; padding: 4px 0;" class="scrollbar-hidden">
                        ${contacts.map(c => `
                            <div onclick="app.toggleGroupMemberSelect('${c.identifier.replace(/'/g, "\\'")}', this)" style="display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; flex-shrink: 0; position: relative; width: 60px;">
                                <div class="contact-avatar-wrapper" style="width: 44px; height: 44px; border-radius: 50%; position: relative; border: 2px solid var(--glass-border); transition: all 0.25s; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                                    <img src="${c.photo}" style="width: 100%; height: 100%; object-fit: cover;">
                                    <div class="check-badge" style="position: absolute; inset: 0; background: rgba(99, 102, 241, 0.75); display: flex; align-items: center; justify-content: center; opacity: 0; transition: all 0.2s;">
                                        <i data-lucide="check" style="width: 18px; height: 18px; color: white;"></i>
                                    </div>
                                </div>
                                <span style="font-size: 10px; font-weight: 500; color: var(--text-secondary); width: 60px; text-align: center; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                    ${c.name.split(' ')[0]}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : '';

            area.innerHTML = `
                <input type="text" id="group-name" placeholder="${this.t('group_name_placeholder')}" autocomplete="off" style="${inputBaseStyle}" onfocus="this.style.borderColor='var(--accent)'; this.style.background='rgba(255, 255, 255, 0.08)';" onblur="this.style.borderColor='var(--glass-border)'; this.style.background='rgba(255, 255, 255, 0.05)';">
                <input type="text" id="target-identifier" placeholder="${this.t('members_placeholder')}" autocomplete="off" style="${inputBaseStyle} margin-top: 12px;" onfocus="this.style.borderColor='var(--accent)'; this.style.background='rgba(255, 255, 255, 0.08)';" onblur="this.style.borderColor='var(--glass-border)'; this.style.background='rgba(255, 255, 255, 0.05)';">
                ${contactsHTML}
                <div style="display: flex; gap: 12px; margin-top: 8px;">
                    <button class="btn-ghost" style="flex:1" onclick="app.closeModal()">${this.t('dismiss')}</button>
                    <button class="glass-btn" style="flex:1" onclick="app.startGroupChat()">${this.t('form_group')}</button>
                </div>
            `;
        }

        lucide.createIcons({ node: area });
    }

    toggleGroupMemberSelect(identifier, el) {
        const input = document.getElementById('target-identifier');
        if (!input) return;

        let selected = input.value.split(',').map(s => s.trim()).filter(Boolean);
        const index = selected.indexOf(identifier);

        const badge = el.querySelector('.check-badge');
        const wrapper = el.querySelector('.contact-avatar-wrapper');

        if (index > -1) {
            // Already selected, remove it
            selected.splice(index, 1);
            if (badge) badge.style.opacity = '0';
            if (wrapper) {
                wrapper.style.borderColor = 'var(--glass-border)';
                wrapper.style.transform = 'scale(1)';
            }
        } else {
            // Not selected, add it
            selected.push(identifier);
            if (badge) badge.style.opacity = '1';
            if (wrapper) {
                wrapper.style.borderColor = 'var(--accent)';
                wrapper.style.transform = 'scale(1.05)';
            }
        }

        input.value = selected.join(', ');
        input.dispatchEvent(new Event('input'));
    }

    async findUsersByIdentifiers(identifiers) {
        const users = [];
        for (let id of identifiers) {
            id = id.trim().toLowerCase();
            if (!id) continue;

            let q = query(collection(db, 'users'), where('email', '==', id));
            let snap = await getDocs(q);

            if (snap.empty) {
                q = query(collection(db, 'users'), where('username', '==', id));
                snap = await getDocs(q);
            }

            if (!snap.empty && snap.docs[0].data().uid !== this.user.uid) {
                users.push(snap.docs[0].data());
            }
        }
        return users;
    }

    async startDirectChat() {
        const val = document.getElementById('target-identifier').value;
        if (!val) return;

        const users = await this.findUsersByIdentifiers([val]);
        if (users.length === 0) {
            this.showAlert(this.lang === 'ar' ? 'لم يتم العثور على الحساب' : 'Account Not Found', this.lang === 'ar' ? 'لا توجد حسابات مطابقة لهذا الاسم أو البريد.' : 'No matching accounts found.');
            return;
        }

        const target = users[0];
        const existingChat = this.allChats.find(c => c.type === 'direct' && c.memberIds.includes(target.uid));
        this.closeModal();

        if (existingChat) {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelector('.nav-item[data-page="chats"]').classList.add('active');
            this.handleNavigation('chats');
            this.selectChat(existingChat.id);
            return;
        }

        const newChatRef = await addDoc(collection(db, 'chats'), {
            type: 'direct',
            memberIds: [this.user.uid, target.uid],
            memberData: {
                [this.user.uid]: { name: this.userData?.displayName || this.user.displayName, photo: this.userData?.photoURL || this.user.photoURL, email: this.user.email, username: this.userData?.username },
                [target.uid]: { name: target.displayName, photo: target.photoURL, email: target.email, username: target.username }
            },
            archivedBy: [],
            updatedAt: serverTimestamp(),
            lastMessage: null
        });

        this.handleNavigation('chats');
        this.selectChat(newChatRef.id);
    }

    async startGroupChat() {
        const name = document.getElementById('group-name').value.trim();
        const membs = document.getElementById('target-identifier').value.split(',');
        if (!name || membs.length === 0) return this.showAlert(this.lang === 'ar' ? 'معلومات ناقصة' : 'Details Required', this.lang === 'ar' ? 'يرجى ملء كافة تفاصيل المجموعة.' : 'Please fill all details.');

        // Cooldown check: 1 minute (60,000 ms)
        const now = Date.now();
        const cooldown = 60000;
        if (now - this.lastGroupCreationTime < cooldown) {
            const remaining = Math.ceil((cooldown - (now - this.lastGroupCreationTime)) / 1000);
            return this.showAlert(this.lang === 'ar' ? 'تمهل قليلاً' : 'Slow Down', this.lang === 'ar' ? `يرجى الانتظار ${remaining} ثانية قبل إنشاء مجموعة أخرى.` : `Please wait ${remaining} seconds before creating another group.`);
        }

        if (this.isCreatingGroup) return;

        const users = await this.findUsersByIdentifiers(membs);
        if (users.length === 0) {
            this.showAlert(this.lang === 'ar' ? 'أعضاء غير صالحين' : 'Invalid Members', this.lang === 'ar' ? 'لم يتم العثور على أعضاء صالحين للمجموعة.' : 'No valid users located.');
            return;
        }

        // Show loading state
        this.isCreatingGroup = true;
        const btn = document.querySelector('.glass-btn[onclick="app.startGroupChat()"]');
        if (btn) {
            btn.disabled = true;
            btn.innerText = this.lang === 'ar' ? 'جاري الإنشاء...' : 'Creating...';
            btn.style.opacity = '0.7';
        }

        try {
            const memberIds = [this.user.uid, ...users.map(u => u.uid)];
            const memberData = {
                [this.user.uid]: { name: this.userData.displayName, photo: this.userData.photoURL }
            };
            users.forEach(u => {
                memberData[u.uid] = { name: u.displayName, photo: u.photoURL };
            });

            const newChatRef = await addDoc(collection(db, 'chats'), {
                type: 'group',
                name: name,
                memberIds: memberIds,
                memberData: memberData,
                archivedBy: [],
                updatedAt: serverTimestamp(),
                lastMessage: null,
                admins: [this.user.uid]
            });

            this.lastGroupCreationTime = Date.now();
            this.closeModal();
            this.handleNavigation('chats');
            this.selectChat(newChatRef.id);
        } catch (e) {
            console.error("Group creation failed:", e);
            this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Error', this.lang === 'ar' ? 'فشل إنشاء المجموعة. حاول لاحقاً.' : 'Failed to create group. Try again later.');
        } finally {
            this.isCreatingGroup = false;
        }
    }

    // --- Dynamic Fullscreen Pages ---
    // Note: Profile and About moved to settings.js


    // Note: Media and Giphy methods moved to media.js

    // Note: Time formatting moved to ui.js

    // Note: Audio helper methods moved to media.js

    // --- Elegant Glassmorphism Dialog System ---
    // Note: Dialog methods moved to ui.js

    // --- Modern Features Expansion ---

    async addReaction(chatId, msgId, emoji) {
        this.closeMsgOptionsPopup();
        const msgRef = doc(db, `chats/${chatId}/messages`, msgId);
        const updateObj = {};
        updateObj[`reactions.${this.user.uid}`] = emoji;
        await updateDoc(msgRef, updateObj);
        if (navigator.vibrate) navigator.vibrate(20);
    }

    onMsgDblClick(e, chatId, msgId) {
        e.preventDefault();
        e.stopPropagation();

        // Add reaction logic
        this.addReaction(chatId, msgId, '❤️');

        // Visual animation
        const bubble = e.currentTarget.querySelector('.bubble-content');
        if (!bubble) return;

        // Remove existing animation if any
        bubble.querySelectorAll('.double-tap-heart').forEach(h => h.remove());

        const heart = document.createElement('div');
        heart.className = 'double-tap-heart';
        heart.innerText = '❤️';
        bubble.appendChild(heart);

        // Remove after animation
        setTimeout(() => heart.remove(), 800);
    }

    showReactionDetails(chatId, msgId) {
        const msg = this.currentMessages[msgId];
        if (!msg || !msg.reactions) return;

        const chat = this.allChats.find(c => c.id === chatId);
        const reactions = Object.entries(msg.reactions);

        let html = `
            <div style="padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; direction: ${this.lang === 'ar' ? 'rtl' : 'ltr'};">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary);">${this.lang === 'ar' ? 'التفاعلات' : 'Reactions'}</h3>
                    <button class="glass-btn secondary" style="padding: 8px; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: none; background: var(--glass-hover, rgba(255, 255, 255, 0.08)); cursor: pointer;" onclick="app.closeModal()">
                        <i data-lucide="x" style="width: 18px; height: 18px; color: var(--text-secondary);"></i>
                    </button>
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px; max-height: 300px; overflow-y: auto; direction: ${this.lang === 'ar' ? 'rtl' : 'ltr'};" class="scrollbar-hidden">
                    ${reactions.map(([uid, emoji]) => {
            const member = chat.memberData[uid] || { name: 'Unknown User', photo: 'assets/logo.jpg' };
            return `
                            <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--glass-panel); border-radius: 12px; border: 1px solid var(--glass-border);">
                                <img src="${member.photo}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;">
                                <div style="flex: 1; font-weight: 600; color: var(--text-primary); text-align: ${this.lang === 'ar' ? 'right' : 'left'};">${member.name}</div>
                                <div style="font-size: 20px;">${emoji}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;

        this.showModal(html);
        lucide.createIcons({ node: document.getElementById('modal-overlay') });
    }

    async openViewOnceImage(chatId, msgId) {
        const msg = this.currentMessages[msgId];
        if (!msg || !msg.image) return;

        // Prevent screenshotting/saving/copying visually
        const modal = document.createElement('div');
        modal.id = 'view-once-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 10000;
            background: #000000; display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            user-select: none; -webkit-user-select: none;
            -moz-user-select: none; -ms-user-select: none;
        `;

        modal.innerHTML = `
            <div id="view-once-timer-bar" style="position: absolute; top: 0; left: 0; height: 6px; width: 100%; background: var(--accent); transition: width 3s linear;"></div>
            <div style="position: absolute; top: 20px; display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.5); padding: 10px 20px; border-radius: 20px; color: white; font-size: 14px; font-weight: 600; backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);">
                <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
                <span id="view-once-countdown">${this.lang === 'ar' ? 'ستختفي الصورة خلال 3 ثوان...' : 'Disappearing in 3s...'}</span>
            </div>
            <img src="${msg.image}" style="max-width: 100%; max-height: 85vh; object-fit: contain; pointer-events: none;" oncontextmenu="return false;">
        `;
        document.body.appendChild(modal);
        if (window.lucide) lucide.createIcons({ node: modal });

        // Mark as opened in Firestore and destroy image payload instantly for maximum security
        const msgRef = doc(db, `chats/${chatId}/messages`, msgId);
        try {
            await updateDoc(msgRef, {
                viewOnceState: 'opened',
                image: null,
                ciphertext: null
            });
        } catch (err) {
            console.error("Failed to update view once state in db", err);
        }

        // Start bar animation
        setTimeout(() => {
            const bar = document.getElementById('view-once-timer-bar');
            if (bar) bar.style.width = '0%';
        }, 50);

        // Countdown ticking
        let remaining = 3;
        const interval = setInterval(() => {
            remaining--;
            const textEl = document.getElementById('view-once-countdown');
            if (textEl) {
                textEl.innerText = this.lang === 'ar' ? `ستختفي الصورة خلال ${remaining} ثوان...` : `Disappearing in ${remaining}s...`;
            }
            if (remaining <= 0) clearInterval(interval);
        }, 1000);

        // Auto close after 3 seconds
        setTimeout(() => {
            clearInterval(interval);
            modal.remove();
        }, 3000);
    }

    showScheduleMessageModal(chatId) {
        // Get current date and format it for datetime-local input (YYYY-MM-DDTHH:MM)
        const now = new Date();
        now.setMinutes(now.getMinutes() + 5); // Default to 5 minutes from now
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const defaultTime = `${year}-${month}-${day}T${hours}:${minutes}`;

        this.showModal(`
            <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 20px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                <i data-lucide="clock" style="color: var(--accent); width: 24px; height: 24px;"></i>
                ${this.lang === 'ar' ? 'جدولة رسالة جديدة' : 'Schedule New Message'}
            </h2>
            <div style="display: flex; flex-direction: column; gap: 16px; width: 100%;">
                <div>
                    <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary);">
                        ${this.lang === 'ar' ? 'نص الرسالة' : 'Message Text'}
                    </label>
                    <textarea id="sched-msg-text" placeholder="${this.lang === 'ar' ? 'اكتب رسالتك هنا...' : 'Type your message here...'}" style="width: 100%; height: 100px; padding: 12px 16px; border-radius: 12px; background: rgba(0,0,0,0.05); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 14px; resize: none; outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--glass-border)'"></textarea>
                </div>
                <div>
                    <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary);">
                        ${this.lang === 'ar' ? 'وقت الإرسال' : 'Send Time'}
                    </label>
                    <input type="datetime-local" id="sched-msg-time" value="${defaultTime}" min="${defaultTime}" style="width: 100%; padding: 12px 16px; border-radius: 12px; background: rgba(0,0,0,0.05); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 14px; outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--glass-border)'">
                </div>
                <div style="display: flex; gap: 12px; margin-top: 10px;">
                    <button class="btn-ghost" style="flex: 1; padding: 12px;" onclick="app.closeModal()">${this.lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                    <button class="glass-btn" style="flex: 1; padding: 12px;" onclick="app.scheduleMessage('${chatId}')">${this.lang === 'ar' ? 'جدولة الآن' : 'Schedule Now'}</button>
                </div>
            </div>
        `);
        if (window.lucide) lucide.createIcons();
    }

    async scheduleMessage(chatId) {
        const text = document.getElementById('sched-msg-text').value.trim();
        const timeVal = document.getElementById('sched-msg-time').value;
        if (!text) return;
        if (!timeVal) return;

        const targetDate = new Date(timeVal);
        if (targetDate <= new Date()) {
            this.showAlert(this.lang === 'ar' ? 'وقت غير صالح' : 'Invalid Time', this.lang === 'ar' ? 'يرجى اختيار وقت في المستقبل.' : 'Please choose a future time.');
            return;
        }

        const chat = this.allChats.find(c => c.id === chatId);
        if (chat && chat.blockedBy && chat.blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'المحادثة محظورة' : 'Context Blocked', this.lang === 'ar' ? 'لا يمكن جدولة رسائل في محادثة محظورة.' : 'Cannot schedule messages in a blocked conversation.');
            return;
        }

        this.closeModal();

        try {
            let preE2E = { text };
            let e2eData = preE2E;
            if (chat.type !== 'ai') {
                e2eData = await this.encryptMessagePayload(chat, preE2E);
            }

            const payload = {
                chatId,
                senderId: this.user.uid,
                createdAt: null, // Keeps it hidden from standard createdAt sorting queries
                status: 'scheduled',
                scheduledAt: targetDate.getTime(),
                ...e2eData
            };

            await addDoc(collection(db, `chats/${chatId}/messages`), payload);
            if (navigator.vibrate) navigator.vibrate(20);
        } catch (e) {
            console.error("Failed to schedule message", e);
        }
    }

    async renderScheduledMessagesList(chatId, docSnaps) {
        const container = document.getElementById('scheduled-messages-placeholder');
        if (container) {
            container.innerHTML = '';
            container.style.display = 'none';
        }

        if (docSnaps.length === 0) {
            this.activeScheduledMessages = [];
            const headerBtn = document.getElementById('sched-header-btn');
            if (headerBtn) headerBtn.classList.add('hidden');
            if (this.schedTimer) {
                clearInterval(this.schedTimer);
                this.schedTimer = null;
            }
            if (this.isScheduledModalOpen) this.closeModal();
            return;
        }

        const decrypted = await Promise.all(docSnaps.map(async docSnap => {
            let msg = docSnap.data();
            if (msg.isE2E) {
                msg = await this.decryptMessagePayload(msg);
            }
            return { id: docSnap.id, ...msg };
        }));

        this.activeScheduledMessages = decrypted;

        // Show the clock icon in the chat header
        const headerBtn = document.getElementById('sched-header-btn');
        if (headerBtn) headerBtn.classList.remove('hidden');

        // If the modal is currently open, trigger live updates
        if (this.isScheduledModalOpen) {
            this.updateScheduledMessagesModal(chatId);
        }

        // Start auto-send checker interval (once per second)
        if (!this.schedTimer) {
            this.schedTimer = setInterval(() => {
                const now = Date.now();
                decrypted.forEach(async msg => {
                    if (now >= msg.scheduledAt) {
                        await this.triggerSendScheduledMessage(chatId, msg);
                    }
                });
            }, 1000);
        }
    }

    showScheduledMessagesListModal(chatId) {
        this.isScheduledModalOpen = true;
        this.updateScheduledMessagesModal(chatId);
    }

    async updateScheduledMessagesModal(chatId) {
        const modalContent = document.getElementById('modal-content');
        if (!modalContent || !this.activeScheduledMessages) return;

        if (this.activeScheduledMessages.length === 0) {
            this.closeModal();
            return;
        }

        let listHTML = this.activeScheduledMessages.map(msg => {
            const timeStr = new Date(msg.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; background: var(--glass-panel); border: 1px solid var(--glass-border); border-radius: 16px; padding: 12px 16px; font-size: 14px; color: var(--text-primary); box-shadow: var(--shadow-sm); width: 100%;">
                    <div style="flex: 1; min-width: 0; text-align: ${this.lang === 'ar' ? 'right' : 'left'};">
                        <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px;">${msg.text || (this.lang === 'ar' ? 'رسالة مشفرة' : 'Encrypted Message')}</div>
                        <div style="font-size: 11px; color: #8b5cf6; display: flex; align-items: center; gap: 4px; margin-top: 4px;">
                            <i data-lucide="clock" style="width: 12px; height: 12px;"></i>
                            <span>${this.lang === 'ar' ? 'مجدولة لـ: ' : 'Scheduled for: '}${timeStr}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center; margin-${this.lang === 'ar' ? 'right' : 'left'}: 12px; flex-shrink: 0;">
                        <button onclick="app.sendScheduledMessageNow('${chatId}', '${msg.id}')" style="background: rgba(16, 185, 129, 0.1); border: none; color: #10b981; padding: 8px 12px; border-radius: 10px; cursor: pointer; font-size: 12px; font-weight: 700; transition: all 0.2s;" title="${this.lang === 'ar' ? 'إرسال الآن' : 'Send Now'}">
                            ${this.lang === 'ar' ? 'إرسال الآن' : 'Send Now'}
                        </button>
                        <button onclick="app.deleteScheduledMessage('${chatId}', '${msg.id}')" style="background: rgba(239, 68, 68, 0.1); border: none; color: #ef4444; width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;" title="${this.lang === 'ar' ? 'إلغاء الجدولة' : 'Cancel Schedule'}">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        const innerContainer = document.getElementById('scheduled-modal-container');
        if (innerContainer) {
            innerContainer.innerHTML = listHTML;
            if (window.lucide) lucide.createIcons({ node: innerContainer });
        } else {
            const modalHTML = `
                <div style="padding: 6px;">
                    <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 20px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; text-align: ${this.lang === 'ar' ? 'right' : 'left'};">
                        <i data-lucide="clock" style="color: var(--accent); width: 24px; height: 24px;"></i>
                        ${this.lang === 'ar' ? '⏳ الرسائل المجدولة' : '⏳ Scheduled Messages'}
                    </h2>
                    <div id="scheduled-modal-container" style="display: flex; flex-direction: column; gap: 12px; max-height: 350px; overflow-y: auto;" class="scrollbar-hidden">
                        ${listHTML}
                    </div>
                </div>
            `;
            this.showModal(modalHTML);
        }
    }

    async triggerSendScheduledMessage(chatId, msg) {
        if (!this.triggeringMsgs) this.triggeringMsgs = new Set();
        if (this.triggeringMsgs.has(msg.id)) return;
        this.triggeringMsgs.add(msg.id);

        const msgRef = doc(db, `chats/${chatId}/messages`, msg.id);
        try {
            await updateDoc(msgRef, {
                status: 'sent',
                createdAt: serverTimestamp()
            });

            // Update chat lastMessage sidebar preview as well!
            const chat = this.allChats.find(c => c.id === chatId);
            if (chat) {
                let displayLastMsg = msg.text;
                if (chat.type !== 'ai') {
                    displayLastMsg = this.lang === 'ar' ? '🔒 رسالة مشفرة' : '🔒 Encrypted Message';
                }
                await updateDoc(doc(db, 'chats', chatId), {
                    lastMessage: {
                        text: displayLastMsg,
                        senderId: this.user.uid,
                        msgId: msg.id,
                        isE2E: msg.isE2E,
                        ciphertext: msg.ciphertext || null,
                        iv: msg.iv || null,
                        keys: msg.keys || null
                    },
                    ...this.getUnreadCountsUpdate(chat),
                    updatedAt: serverTimestamp()
                });
            }
        } catch (e) {
            console.error("Failed to trigger scheduled message", e);
        } finally {
            this.triggeringMsgs.delete(msg.id);
        }
    }

    async sendScheduledMessageNow(chatId, msgId) {
        const msg = this.currentMessages[msgId];
        if (msg) {
            await this.triggerSendScheduledMessage(chatId, { id: msgId, ...msg });
        }
    }

    async deleteScheduledMessage(chatId, msgId) {
        try {
            await deleteDoc(doc(db, `chats/${chatId}/messages`, msgId));
        } catch (e) {
            console.error("Failed to delete scheduled message", e);
        }
    }

    openCanvasPad(chatId) {
        const overlay = document.createElement('div');
        overlay.id = 'canvas-pad-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: var(--bg); display: flex; flex-direction: column;
            user-select: none; -webkit-user-select: none;
        `;

        overlay.innerHTML = `
            <div style="height: 60px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: var(--glass-panel-solid); border-bottom: 1px solid var(--glass-border); backdrop-filter: blur(10px);">
                <button id="canvas-close" style="background: none; border: none; color: var(--text-primary); cursor: pointer; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;" onmouseover="this.style.background='var(--hover-bg)'" onmouseout="this.style.background='none'">
                    <i data-lucide="x" style="width: 24px; height: 24px;"></i>
                </button>
                <div style="font-weight: 600; font-size: 16px;">${this.lang === 'ar' ? 'لوحة الرسم' : 'Sketch Pad'}</div>
                <button id="canvas-send" style="background: var(--accent); color: white; border: none; padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: var(--shadow-sm);">
                    ${this.lang === 'ar' ? 'إرسال' : 'Send'}
                    <i data-lucide="send" style="width: 16px; height: 16px;"></i>
                </button>
            </div>
            <div style="flex: 1; position: relative; background: #ffffff; overflow: hidden;" id="canvas-container">
                <canvas id="drawing-canvas" style="display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair;"></canvas>
            </div>
            <div style="height: 80px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: var(--glass-panel-solid); border-top: 1px solid var(--glass-border); backdrop-filter: blur(10px); gap: 12px; overflow-x: auto;" class="scrollbar-hidden">
                <div style="display: flex; gap: 10px;" id="canvas-colors">
                    <button class="color-btn active" data-color="#000000" style="width: 36px; height: 36px; border-radius: 50%; border: 3px solid #000000; background: #000000; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="color-btn" data-color="#ef4444" style="width: 36px; height: 36px; border-radius: 50%; border: 3px solid transparent; background: #ef4444; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="color-btn" data-color="#3b82f6" style="width: 36px; height: 36px; border-radius: 50%; border: 3px solid transparent; background: #3b82f6; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="color-btn" data-color="#10b981" style="width: 36px; height: 36px; border-radius: 50%; border: 3px solid transparent; background: #10b981; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="color-btn" data-color="#f59e0b" style="width: 36px; height: 36px; border-radius: 50%; border: 3px solid transparent; background: #f59e0b; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="color-btn" data-color="#ec4899" style="width: 36px; height: 36px; border-radius: 50%; border: 3px solid transparent; background: #ec4899; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="color-btn" data-color="#ffffff" style="width: 36px; height: 36px; border-radius: 50%; border: 3px solid #e2e8f0; background: #ffffff; cursor: pointer; transition: transform 0.2s; display: flex; align-items: center; justify-content: center;"><i data-lucide="eraser" style="width: 18px; color: #64748b;"></i></button>
                </div>
                <button id="canvas-clear" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: none; padding: 10px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; transition: background 0.2s;">
                    <i data-lucide="trash-2" style="width: 20px; height: 20px;"></i>
                </button>
            </div>
        `;

        document.body.appendChild(overlay);
        if (window.lucide) lucide.createIcons({ node: overlay });

        const canvas = overlay.querySelector('#drawing-canvas');
        const ctx = canvas.getContext('2d');
        const container = overlay.querySelector('#canvas-container');

        // Setup canvas size
        const resizeCanvas = () => {
            const rect = container.getBoundingClientRect();
            // Important: we need to scale canvas for high DPI displays to avoid blurriness
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;

            // Default background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, rect.width, rect.height);

            // Setup drawing settings
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#000000';
        };
        resizeCanvas();

        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;
        let currentColor = '#000000';

        const getCoords = (e) => {
            if (e.touches && e.touches.length > 0) {
                return {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY - container.getBoundingClientRect().top
                };
            }
            return {
                x: e.clientX,
                y: e.clientY - container.getBoundingClientRect().top
            };
        };

        const startDrawing = (e) => {
            isDrawing = true;
            const { x, y } = getCoords(e);
            lastX = x;
            lastY = y;
            // Draw a single dot
            ctx.beginPath();
            ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = currentColor;
            ctx.fill();
            ctx.closePath();
            e.preventDefault();
        };

        const draw = (e) => {
            if (!isDrawing) return;
            const { x, y } = getCoords(e);

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.strokeStyle = currentColor;
            ctx.stroke();

            lastX = x;
            lastY = y;
            e.preventDefault();
        };

        const stopDrawing = () => {
            isDrawing = false;
        };

        // Events
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        window.addEventListener('mouseup', stopDrawing);

        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        window.addEventListener('touchend', stopDrawing);

        // Color picking
        const colorBtns = overlay.querySelectorAll('.color-btn');
        colorBtns.forEach(btn => {
            btn.onclick = () => {
                colorBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.border = b.dataset.color === '#ffffff' ? '3px solid #e2e8f0' : '3px solid transparent';
                    b.style.transform = 'scale(1)';
                });
                btn.classList.add('active');
                if (btn.dataset.color !== '#ffffff') {
                    btn.style.border = `3px solid ${btn.dataset.color}`;
                } else {
                    btn.style.border = `3px solid #cbd5e1`; // active eraser
                }
                btn.style.transform = 'scale(1.1)';

                currentColor = btn.dataset.color;
                ctx.lineWidth = currentColor === '#ffffff' ? 20 : 5; // bigger eraser
            };
        });

        // Clear
        overlay.querySelector('#canvas-clear').onclick = () => {
            const rect = container.getBoundingClientRect();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, rect.width, rect.height);
        };

        // Close
        const cleanUp = () => {
            window.removeEventListener('mouseup', stopDrawing);
            window.removeEventListener('touchend', stopDrawing);
            overlay.remove();
        };
        overlay.querySelector('#canvas-close').onclick = cleanUp;

        // Send
        overlay.querySelector('#canvas-send').onclick = () => {
            const dataUrl = canvas.toDataURL('image/png');
            cleanUp();
            this.showPasteImagePreview(dataUrl, chatId);
        };
    }

    startInChatDrawing(chatId) {
        const overlay = document.createElement('div');
        overlay.id = 'in-chat-drawing-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: transparent; display: flex; flex-direction: column;
            user-select: none; -webkit-user-select: none; pointer-events: none;
        `;

        overlay.innerHTML = `
            <div style="position: absolute; top: 16px; left: 16px; right: 16px; display: flex; justify-content: space-between; align-items: flex-start; z-index: 2; pointer-events: auto;">
                <button id="in-chat-close" style="background: rgba(0,0,0,0.5); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; box-shadow: var(--shadow-md); transition: all 0.2s;" onmouseover="this.style.background='rgba(0,0,0,0.7)'" onmouseout="this.style.background='rgba(0,0,0,0.5)'">
                    <i data-lucide="x" style="width: 24px; height: 24px;"></i>
                </button>
                <div style="display: flex; gap: 10px;">
                    <button id="in-chat-clear" style="background: rgba(0,0,0,0.5); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; box-shadow: var(--shadow-md); transition: all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.8)'" onmouseout="this.style.background='rgba(0,0,0,0.5)'">
                        <i data-lucide="trash-2" style="width: 20px; height: 20px;"></i>
                    </button>
                    <button id="in-chat-send" style="background: var(--accent); color: white; border: none; padding: 0 20px; height: 44px; border-radius: 22px; font-weight: 700; font-size: 15px; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: var(--shadow-lg); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        ${this.lang === 'ar' ? 'إرسال' : 'Send'}
                        <i data-lucide="send" style="width: 18px; height: 18px;"></i>
                    </button>
                </div>
            </div>
            
            <div style="flex: 1; position: absolute; inset: 0; z-index: 1; pointer-events: auto;" id="in-chat-canvas-container">
                <canvas id="in-chat-canvas" style="display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair;"></canvas>
            </div>
            
            <div style="position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; padding: 12px 20px; background: rgba(0,0,0,0.6); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.1); border-radius: 30px; gap: 16px; z-index: 2; pointer-events: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow-x: auto; max-width: 90vw;" class="scrollbar-hidden">
                <div style="display: flex; gap: 12px;" id="in-chat-colors">
                    <button class="in-chat-color active" data-color="#ef4444" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; background: #ef4444; cursor: pointer; transition: transform 0.2s; transform: scale(1.15); box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);"></button>
                    <button class="in-chat-color" data-color="#3b82f6" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; background: #3b82f6; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="in-chat-color" data-color="#10b981" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; background: #10b981; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="in-chat-color" data-color="#f59e0b" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; background: #f59e0b; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="in-chat-color" data-color="#ec4899" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; background: #ec4899; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="in-chat-color" data-color="#ffffff" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; background: #ffffff; cursor: pointer; transition: transform 0.2s;"></button>
                    <button class="in-chat-color" data-color="#000000" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; background: #000000; cursor: pointer; transition: transform 0.2s;"></button>
                    <div style="width: 1px; height: 24px; background: rgba(255,255,255,0.2); margin: 0 4px; flex-shrink: 0;"></div>
                    <button class="in-chat-color" data-color="eraser" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; background: rgba(255,255,255,0.2); cursor: pointer; transition: transform 0.2s; display: flex; align-items: center; justify-content: center;"><i data-lucide="eraser" style="width: 16px; color: white;"></i></button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        if (window.lucide) lucide.createIcons({ node: overlay });

        const canvas = overlay.querySelector('#in-chat-canvas');
        const ctx = canvas.getContext('2d');
        const container = overlay.querySelector('#in-chat-canvas-container');

        const resizeCanvas = () => {
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 6;
            ctx.strokeStyle = '#ef4444';
        };
        resizeCanvas();

        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;
        let currentColor = '#ef4444';
        let isEraser = false;

        let drawingData = [];
        let currentStroke = null;
        let drawingStartTime = 0;

        const getCoordsNorm = (e) => {
            const rect = container.getBoundingClientRect();
            let rawX, rawY;
            if (e.touches && e.touches.length > 0) {
                rawX = e.touches[0].clientX; rawY = e.touches[0].clientY;
            } else {
                rawX = e.clientX; rawY = e.clientY;
            }
            return { nx: rawX / rect.width, ny: rawY / rect.height };
        };

        const startDrawing = (e) => {
            isDrawing = true;
            if (!drawingStartTime) drawingStartTime = Date.now();

            const norm = getCoordsNorm(e);
            currentStroke = {
                color: currentColor,
                isEraser: isEraser,
                points: [{ ...norm, t: Date.now() - drawingStartTime }]
            };
            drawingData.push(currentStroke);

            const { x, y } = { x: norm.nx * container.getBoundingClientRect().width, y: norm.ny * container.getBoundingClientRect().height };
            lastX = x;
            lastY = y;

            ctx.beginPath();
            ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = currentColor;
            if (isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
            }
            ctx.fill();
            ctx.closePath();
            e.preventDefault();
        };

        const draw = (e) => {
            if (!isDrawing) return;
            const norm = getCoordsNorm(e);
            currentStroke.points.push({ ...norm, t: Date.now() - drawingStartTime });

            const { x, y } = { x: norm.nx * container.getBoundingClientRect().width, y: norm.ny * container.getBoundingClientRect().height };

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);

            if (isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = 24;
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.lineWidth = 6;
                ctx.strokeStyle = currentColor;
            }

            ctx.stroke();
            lastX = x;
            lastY = y;
            e.preventDefault();
        };

        const stopDrawing = () => {
            isDrawing = false;
        };

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        window.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        window.addEventListener('touchend', stopDrawing);

        const colorBtns = overlay.querySelectorAll('.in-chat-color');
        colorBtns.forEach(btn => {
            btn.onclick = () => {
                colorBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.border = '3px solid transparent';
                    b.style.transform = 'scale(1)';
                    b.style.boxShadow = 'none';
                });
                btn.classList.add('active');
                btn.style.border = '3px solid white';
                btn.style.transform = 'scale(1.15)';

                const c = btn.dataset.color;
                if (c === 'eraser') {
                    isEraser = true;
                } else {
                    isEraser = false;
                    currentColor = c;
                    btn.style.boxShadow = `0 0 10px ${c}`;
                }
            };
        });

        overlay.querySelector('#in-chat-clear').onclick = () => {
            const rect = container.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);
        };

        const cleanUp = () => {
            window.removeEventListener('mouseup', stopDrawing);
            window.removeEventListener('touchend', stopDrawing);
            overlay.remove();
        };
        overlay.querySelector('#in-chat-close').onclick = cleanUp;

        overlay.querySelector('#in-chat-send').onclick = () => {
            if (drawingData.length === 0) {
                this.showAlert(this.lang === 'ar' ? 'اللوحة فارغة' : 'Canvas Empty', this.lang === 'ar' ? 'قم بالرسم قبل الإرسال!' : 'Draw something before sending!');
                return;
            }
            cleanUp();
            this.sendScreenDrawing(chatId, drawingData);
        };
    }

    async sendScreenDrawing(chatId, drawingData) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (chat && chat.blockedBy && chat.blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'المحادثة محظورة' : 'Context Blocked', this.lang === 'ar' ? 'لا يمكن إرسال رسائل في محادثة محظورة.' : 'Cannot send messages in a blocked conversation.');
            return;
        }

        try {
            const batch = writeBatch(db);
            const msgRef = doc(collection(db, `chats/${chatId}/messages`));

            let preE2E = { type: 'screen_drawing', strokes: drawingData };
            let e2eData = preE2E;
            if (chat.type !== 'ai') {
                e2eData = await this.encryptMessagePayload(chat, preE2E);
            }

            const payload = {
                chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent',
                ...e2eData
            };

            if (this.replyToMsgId) {
                payload.replyTo = this.replyToMsgId;
            }

            batch.set(msgRef, payload);

            const displayLastMsg = this.lang === 'ar' ? '✨ رسم متحرك مباشر' : '✨ Live Screen Drawing';
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text: displayLastMsg, senderId: this.user.uid, msgId: msgRef.id, ...e2eData },
                ...this.getUnreadCountsUpdate(chat),
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();
            this.cancelReply();
        } catch (e) {
            console.error("Screen drawing send failed", e);
        }
    }

    replayScreenDrawing(msgId) {
        const msg = this.currentMessages[msgId];
        if (msg && msg.strokes) {
            this.playScreenDrawing(msg.strokes);
        }
    }

    playScreenDrawing(strokes) {
        if (!strokes || !strokes.length) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            pointer-events: none;
        `;
        const canvas = document.createElement('canvas');
        canvas.style.cssText = `display: block; width: 100%; height: 100%;`;
        overlay.appendChild(canvas);
        document.body.appendChild(overlay);

        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        let startTime = Date.now();
        let currentStrokeIdx = 0;
        let currentPointIdx = 0;

        const animate = () => {
            const now = Date.now() - startTime;

            while (currentStrokeIdx < strokes.length) {
                const stroke = strokes[currentStrokeIdx];

                while (currentPointIdx < stroke.points.length - 1) {
                    const p1 = stroke.points[currentPointIdx];
                    const p2 = stroke.points[currentPointIdx + 1];

                    if (p2.t <= now) {
                        ctx.beginPath();
                        ctx.moveTo(p1.nx * rect.width, p1.ny * rect.height);
                        ctx.lineTo(p2.nx * rect.width, p2.ny * rect.height);

                        if (stroke.isEraser) {
                            ctx.globalCompositeOperation = 'destination-out';
                            ctx.lineWidth = 24;
                            ctx.strokeStyle = 'rgba(0,0,0,1)';
                        } else {
                            ctx.globalCompositeOperation = 'source-over';
                            ctx.lineWidth = 6;
                            ctx.strokeStyle = stroke.color;
                        }
                        ctx.stroke();
                        currentPointIdx++;
                    } else {
                        requestAnimationFrame(animate);
                        return;
                    }
                }

                if (currentPointIdx >= stroke.points.length - 1) {
                    currentStrokeIdx++;
                    currentPointIdx = 0;
                }
            }

            setTimeout(() => {
                overlay.style.transition = 'opacity 1s ease';
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 1000);
            }, 3000); // Wait 3s after drawing ends before fading
        };

        requestAnimationFrame(animate);
    }

    // --- App Lock System ---
    showLockScreen() {
        this.isLocked = true;
        this.currentPinInput = "";
        const overlay = document.getElementById('app-lock-overlay');
        overlay.classList.remove('hidden');
        this.updatePinDots();
        lucide.createIcons({ node: overlay });
    }

    handlePinInput(digit) {
        if (this.currentPinInput.length < 4) {
            this.currentPinInput += digit;
            this.updatePinDots();
            if (navigator.vibrate) navigator.vibrate(10);

            if (this.currentPinInput.length === 4) {
                setTimeout(() => this.verifyPin(), 200);
            }
        }
    }

    clearPin() {
        this.currentPinInput = "";
        this.updatePinDots();
    }

    updatePinDots() {
        const dots = document.querySelectorAll('.pin-dot');
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i < this.currentPinInput.length);
        });
    }

    verifyPin() {
        if (this.currentPinInput === this.userData?.appLockPin) {
            this.unlockApp();
        } else {
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            this.currentPinInput = "";
            this.updatePinDots();
            const title = document.getElementById('lock-title');
            title.innerText = this.lang === 'ar' ? 'رمز خاطئ!' : 'Incorrect PIN!';
            title.style.color = '#ef4444';
            setTimeout(() => {
                title.innerText = this.lang === 'ar' ? 'هامستر مقفول' : 'Hamster Locked';
                title.style.color = 'white';
            }, 1000);
        }
    }

    unlockApp() {
        this.isLocked = false;
        this.isUnlockedSession = true; // Stay unlocked this session
        document.getElementById('app-lock-overlay').classList.add('hidden');
    }

    // Note: App lock methods moved to settings.js

    // --- Wallpaper System ---
    // Note: Storage loaders moved to settings.js

    // Note: Settings and Wallpaper moved to settings.js

    // Note: Date formatting moved to ui.js

    // --- PWA Installation Logic ---
    // Note: PWA Install moved to ui.js

    showGroupQR(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        const joinLink = `${window.location.origin}${window.location.pathname}?joinGroup=${chatId}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(joinLink)}`;
        this.showModal(`
            <div class="qr-modal-content">
                <div class="qr-header">
                    <div class="qr-icon-wrapper">
                        <i data-lucide="qr-code"></i>
                    </div>
                    <h3>${chat.name}</h3>
                    <p>${this.lang === 'ar' ? 'امسح الرمز للانضمام إلى المجموعة' : 'Scan code to join the group'}</p>
                </div>
                <div class="qr-code-wrapper">
                    <img src="${qrUrl}" class="qr-code-img" alt="QR Code">
                </div>
                <div class="qr-link-container" onclick="app.copyGroupJoinLink('${joinLink}')" title="${this.lang === 'ar' ? 'اضغط لنسخ الرابط' : 'Click to copy link'}">
                    <div class="qr-link-text">${joinLink}</div>
                    <div class="qr-copy-btn">
                        <i data-lucide="copy" style="width: 16px; height: 16px;"></i>
                    </div>
                </div>
                <button class="btn-ghost qr-close-btn" onclick="app.closeModal()">${this.t('dismiss')}</button>
            </div>
        `);
        if (window.lucide) lucide.createIcons({ node: document.getElementById('modal-content') });
    }

    copyGroupJoinLink(link) {
        navigator.clipboard.writeText(link);
        this.showAlert(
            this.lang === 'ar' ? 'تم النسخ بنجاح' : 'Link Copied',
            this.lang === 'ar' ? 'تم نسخ رابط المجموعة إلى الحافظة.' : 'Group invitation link has been copied to clipboard.'
        );
    }

    async handleGroupJoinLink(chatId) {
        window.history.replaceState({}, document.title, window.location.pathname);
        const join = async () => {
            const chatRef = doc(db, 'chats', chatId);
            try {
                // If they are already a member, they can read the document safely.
                // We attempt to read. If it fails with permission denied, they are likely not a member.
                let isAlreadyMember = false;
                try {
                    const snap = await getDoc(chatRef);
                    if (snap.exists()) {
                        const data = snap.data();
                        if (data.memberIds && data.memberIds.includes(this.user.uid)) {
                            isAlreadyMember = true;
                        }
                    }
                } catch (readErr) {
                    console.log("Reading chat failed (likely not a member yet). Bypassing read restrictions...", readErr);
                }

                if (!isAlreadyMember) {
                    // Add UID to memberIds AND save their full profile in memberData
                    // Use dot notation for memberData to avoid overwriting other members
                    await updateDoc(chatRef, {
                        memberIds: arrayUnion(this.user.uid),
                        [`memberData.${this.user.uid}`]: {
                            name: this.userData?.displayName || this.user.displayName || 'User',
                            photo: this.userData?.photoURL || this.user.photoURL || '',
                            username: this.userData?.username || ''
                        }
                    });
                }
                
                // Select chat once member is joined
                this.selectChat(chatId);
            } catch (err) {
                console.error("Failed to join group via link:", err);
                this.showAlert(
                    this.lang === 'ar' ? 'خطأ في الانضمام' : 'Join Error',
                    this.lang === 'ar' ? 'فشل الانضمام للمجموعة. قد تكون المجموعة غير موجودة أو تم حذفها.' : 'Failed to join group. The group may not exist or has been deleted.'
                );
            }
        };

        if (this.user) { 
            join(); 
        } else {
            const int = setInterval(() => {
                if (this.user) { 
                    clearInterval(int); 
                    join(); 
                }
            }, 1000);
        }
    }

    // --- Attachment Menu Methods ---
    toggleAttachmentMenu(event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('attachment-menu');
        if (menu) {
            menu.classList.toggle('hidden');
        }
    }

    closeAttachmentMenu() {
        const menu = document.getElementById('attachment-menu');
        if (menu) {
            menu.classList.add('hidden');
        }
    }

    // --- Hamster Poll Methods ---
    showPollModal(chatId) {
        this.showModal(`
            <div class="modal-card" style="width: 100%; max-width: 400px; padding: 24px;">
                <h2 style="margin-bottom: 20px; font-size: 20px; font-weight: 800; color: var(--accent); display: flex; align-items: center; gap: 10px;">
                    <i data-lucide="bar-chart-2"></i> ${this.lang === 'ar' ? 'إنشاء استطلاع رأي' : 'Create Poll'}
                </h2>
                
                <div class="form-group" style="margin-bottom: 24px;">
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                        ${this.lang === 'ar' ? 'سؤال الهامستر' : 'Hamster Question'}
                    </label>
                    <input type="text" id="poll-question-input" placeholder="${this.lang === 'ar' ? 'ما هو استطلاعك؟' : 'What is your poll about?'}" style="width: 100%; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-primary); font-family: inherit;">
                </div>

                <div id="poll-options-inputs-container">
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                        ${this.lang === 'ar' ? 'الخيارات' : 'Options'}
                    </label>
                    <div id="poll-inputs-list">
                        <!-- Options will be added here -->
                    </div>
                </div>

                <div style="margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <button class="glass-btn secondary" style="width: 100%;" onclick="app.closeModal()">${this.t('dismiss')}</button>
                    <button class="glass-btn primary" style="width: 100%;" onclick="app.sendPoll('${chatId}')">${this.lang === 'ar' ? 'إرسال الاستطلاع' : 'Cast Poll'}</button>
                </div>
            </div>
        `);

        // Add initial 2 options
        this.addPollOptionRow();
        this.addPollOptionRow();
        lucide.createIcons();
    }

    addPollOptionRow() {
        const container = document.getElementById('poll-inputs-list');
        if (!container) return;

        const index = container.children.length + 1;
        const row = document.createElement('div');
        row.className = 'poll-creator-option-row';
        row.innerHTML = `
            <input type="text" class="poll-opt-input" placeholder="${this.lang === 'ar' ? 'خيار ' : 'Option '}${index}" style="width: 100%; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-primary);">
            ${index > 2 ? `<button class="glass-btn secondary" onclick="this.parentElement.remove()" style="padding: 0; color: var(--danger);"><i data-lucide="trash-2" style="width: 18px;"></i></button>` : ''}
        `;

        // Insert before the last child if it's the add button? No, I'll just append.
        container.appendChild(row);

        // Add the "Add Option" button if not already there or move it to end
        let addBtn = document.getElementById('add-poll-opt-btn');
        if (addBtn) addBtn.remove();

        const addBtnRow = document.createElement('div');
        addBtnRow.id = 'add-poll-opt-btn';
        addBtnRow.style.marginTop = '8px';
        addBtnRow.innerHTML = `
            <button class="glass-btn secondary" style="width: 100%; height: 44px; border-style: dashed;" onclick="app.addPollOptionRow()">
                <i data-lucide="plus" style="width: 16px; margin-right: 4px;"></i> ${this.lang === 'ar' ? 'إضافة خيار' : 'Add Option'}
            </button>
        `;
        container.appendChild(addBtnRow);
        lucide.createIcons({ node: container });
    }

    async sendPoll(chatId) {
        const question = document.getElementById('poll-question-input')?.value.trim();
        const optionInputs = document.querySelectorAll('.poll-opt-input');
        const options = Array.from(optionInputs).map(i => i.value.trim()).filter(v => v !== '');

        if (!question || options.length < 2) {
            return this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Incomplete', this.lang === 'ar' ? 'يرجى إدخال سؤال وخيارين على الأقل.' : 'Please enter a question and at least 2 options.');
        }

        const pollPayload = {
            type: 'poll',
            question,
            options: options.map(opt => ({ text: opt, votes: [] })),
            status: 'active'
        };

        try {
            const batch = writeBatch(db);
            const msgRef = doc(collection(db, `chats/${chatId}/messages`));

            const payload = {
                chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent',
                ...pollPayload
            };

            batch.set(msgRef, payload);
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text: `📊 ${question}`, senderId: this.user.uid, msgId: msgRef.id },
                ...this.getUnreadCountsUpdate(chat),
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();
            this.closeModal();
            this.scrollToBottom();
        } catch (e) {
            console.error("Poll send failed", e);
        }
    }

    async voteInPoll(chatId, msgId, optionIdx) {
        const msgRef = doc(db, `chats/${chatId}/messages`, msgId);
        try {
            const snap = await getDoc(msgRef);
            if (!snap.exists()) return;
            const data = snap.data();
            const options = [...data.options];

            // Toggle vote: Remove from all options, then add to selected if it wasn't there
            let alreadyVotedThis = false;
            options.forEach((opt, idx) => {
                if (!opt.votes) opt.votes = [];
                if (idx === optionIdx && opt.votes.includes(this.user.uid)) {
                    alreadyVotedThis = true;
                }
                opt.votes = opt.votes.filter(uid => uid !== this.user.uid);
            });

            if (!alreadyVotedThis) {
                options[optionIdx].votes.push(this.user.uid);
            }

            await updateDoc(msgRef, { options });
        } catch (e) {
            console.error("Vote failed", e);
        }
    }

    // --- Admin Dashboard (Abuse Reports) ---
    // Note: Admin logic moved to admin.js

    // --- Agora Voice & Video Call Logic ---

    // Note: Call methods moved to calls.js

    // --- In-App Notification ---
    showInAppNotification(chat) {
        const toast = document.getElementById('in-app-notification');
        if (!toast) return;

        const partner = this.getChatPartner(chat);
        const titleText = this.lang === 'ar' ? `رسالة جديدة من ${partner.name}` : `New message from ${partner.name}`;
        
        let msgText = chat.lastMessage?.text || (this.lang === 'ar' ? 'أرسل رسالة جديدة' : 'Sent a new message');
        if (msgText.length > 45) {
            msgText = msgText.substring(0, 45) + '...';
        }

        toast.innerHTML = `
            <img src="${partner.photo || 'https://i.pravatar.cc/150'}" onerror="this.src='https://ui-avatars.com/api/?name=U'">
            <div class="in-app-notification-content">
                <div class="in-app-notification-title">${titleText}</div>
                <div class="in-app-notification-msg">${msgText}</div>
            </div>
        `;

        toast.onclick = () => {
            this.handleNavigation('chats');
            this.selectChat(chat.id);
            toast.classList.remove('show');
        };

        toast.classList.remove('show');
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });

        if (this._toastTimer) clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 4500);
    }

    getUnreadCountsUpdate(chat) {
        if (!chat) return {};
        const unreadCounts = chat.unreadCounts || {};
        chat.memberIds.forEach(id => {
            if (id !== this.user.uid) {
                unreadCounts[id] = (unreadCounts[id] || 0) + 1;
            }
        });
        return { unreadCounts };
    }

}


extendAuth(HamsterApp);
extendCalls(HamsterApp);
extendAI(HamsterApp);
extendStories(HamsterApp);
extendUI(HamsterApp);
extendSettings(HamsterApp);
extendAdmin(HamsterApp);
extendMedia(HamsterApp);
extendE2E(HamsterApp);

// Global Execution
const app = new HamsterApp();
window.app = app;
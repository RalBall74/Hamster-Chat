import {
    db, onSnapshot, query, where, collection, orderBy, addDoc, getDocs, writeBatch, doc, getDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove, deleteDoc
} from './firebase-config.js';

export function extendStories(HamsterApp) {
    HamsterApp.prototype.listenForStories = function() {
        // Cleanup old stories occasionally
        this.cleanupExpiredStories();

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const q = query(
            collection(db, 'stories'),
            where('createdAt', '>', oneDayAgo),
            orderBy('createdAt', 'desc')
        );

        onSnapshot(q, (snapshot) => {
            this.allStories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (this.currentPage === 'stories') this.renderStoriesPage();
            
            this.updateStoriesBadge && this.updateStoriesBadge();
            this.renderFilteredChats && this.renderFilteredChats();
            
            // Real-time update for open story
            if (this.activeStoryId) {
                this.viewStory(this.activeStoryId);
            }
        });
    };

    HamsterApp.prototype.updateStoriesBadge = function() {
        if (!this.allStories || !this.user) return;
        
        const contactUids = new Set();
        (this.allChats || []).forEach(chat => {
            (chat.memberIds || []).forEach(uid => {
                if (uid !== this.user.uid) contactUids.add(uid);
            });
        });

        const hasUnseen = this.allStories.some(s => 
            s.uid !== this.user.uid && 
            contactUids.has(s.uid) && 
            (!s.viewers || !s.viewers.includes(this.user.uid))
        );

        const badge = document.getElementById('stories-nav-badge');
        if (badge) {
            if (hasUnseen) {
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    };

    HamsterApp.prototype.cleanupExpiredStories = async function() {
        try {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const q = query(collection(db, 'stories'), where('createdAt', '<', oneDayAgo));
            const snap = await getDocs(q);
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
        } catch (e) { console.error("Story cleanup err:", e); }
    };

    HamsterApp.prototype.renderStoriesPage = function() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        let storiesHTML = '';
        const myStory = this.allStories?.find(s => s.uid === this.user.uid);

        // My Story Section - Large & Prominent
        storiesHTML += `
            <div style="margin-bottom: 32px;">
                <h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">${this.lang === 'ar' ? 'قصتي' : 'Your Status'}</h3>
                <div style="background: ${myStory ? 'linear-gradient(135deg, var(--accent), #9333ea)' : 'var(--glass-panel)'}; border-radius: 24px; padding: 24px; display: flex; align-items: center; gap: 20px; box-shadow: ${myStory ? '0 10px 20px rgba(109, 40, 217, 0.2)' : 'none'}; cursor: pointer; transition: transform 0.2s;" onclick="${myStory ? `app.viewStory('${myStory.id}')` : `document.getElementById('story-upload').click()`}">
                    <div style="position: relative;">
                        <img src="${this.userData.photoURL}" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 3px solid white;">
                        <div style="position: absolute; bottom: -2px; right: -2px; background: ${myStory ? '#10b981' : 'var(--accent)'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white;">${myStory ? '✓' : '+'}</div>
                    </div>
                    <div style="flex: 1;">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: ${myStory ? 'white' : 'var(--text-primary)'};">${myStory ? (this.lang === 'ar' ? 'عرض قصتك' : 'View your story') : (this.lang === 'ar' ? 'إضافة قصة' : 'Add to story')}</h3>
                        <p style="margin: 4px 0 0; font-size: 14px; color: ${myStory ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)'};">${myStory ? (this.lang === 'ar' ? 'نشطة الآن' : 'Active now') : (this.lang === 'ar' ? 'شارك يومياتك مع أصدقائك' : 'Share moments with friends')}</p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="glass-btn" onclick="event.stopPropagation(); document.getElementById('story-upload').click()" style="width: 36px; height: 36px; border-radius: 50%; padding: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); border: none;"><i data-lucide="camera" style="width: 16px;"></i></button>
                        <button class="glass-btn" onclick="event.stopPropagation(); app.promptTextStory()" style="width: 36px; height: 36px; border-radius: 50%; padding: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); border: none;"><i data-lucide="type" style="width: 16px;"></i></button>
                    </div>
                    <input type="file" id="story-upload" hidden accept="image/*" onchange="app.handleStoryUpload(event)">
                </div>
            </div>
        `;

        // Build a set of UIDs this user has chatted with before
        const contactUids = new Set();
        (this.allChats || []).forEach(chat => {
            (chat.memberIds || []).forEach(uid => {
                if (uid !== this.user.uid) contactUids.add(uid);
            });
        });

        const otherStories = (this.allStories || []).filter(s =>
            s.uid !== this.user.uid && contactUids.has(s.uid)
        );

        if (otherStories.length > 0) {
            storiesHTML += `<h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">${this.lang === 'ar' ? 'تحديثات الأصدقاء' : 'Recent Updates'}</h3>`;
            storiesHTML += `<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">`;
            otherStories.forEach(s => {
                storiesHTML += `
                    <div class="glass-card" style="position: relative; height: 200px; border-radius: 20px; overflow: hidden; cursor: pointer; background: ${s.type === 'text' ? (s.bg || 'var(--accent)') : 'none'};" onclick="app.viewStory('${s.id}')">
                        ${s.type === 'text' ? `
                            <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 20px; text-align: center; color: white; font-weight: 700; font-size: 14px;">
                                ${s.text}
                            </div>
                        ` : `
                            <img src="${s.image}" style="width: 100%; height: 100%; object-fit: cover; filter: brightness(0.8);" draggable="false" oncontextmenu="return false;">
                        `}
                        <div style="position: absolute; top: 12px; left: 12px; display: flex; align-items: center; gap: 8px;">
                            <div style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--accent); padding: 1px; background: white;">
                                <img src="${s.photo}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" draggable="false" oncontextmenu="return false;">
                            </div>
                        </div>
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; padding: 12px; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);">
                            <span style="font-size: 14px; font-weight: 600; color: white; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</span>
                        </div>
                    </div>
                `;
            });
            storiesHTML += `</div>`;
        } else {
            storiesHTML += `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; background: var(--glass-panel); border-radius: 30px; text-align: center; border: 2px dashed var(--glass-border);">
                    <div style="width: 60px; height: 60px; background: var(--app-bg); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; color: var(--text-secondary);">
                        <i data-lucide="circle-dashed" style="width: 32px; height: 32px;"></i>
                    </div>
                    <h3 style="margin: 0 0 8px; font-size: 16px; color: var(--text-primary);">${this.lang === 'ar' ? 'لا توجد قصص بعد' : 'Quiet for now'}</h3>
                    <p style="margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.5;">${this.lang === 'ar' ? 'كن أول من يشارك قصة اليوم!' : 'Be the first one to share a story today and inspire others!'}</p>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="page-container" style="padding: 24px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <button class="mobile-back-btn" onclick="app.handleNavigation('chats')" style="background: var(--glass-panel); border: none; width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-primary);"><i data-lucide="chevron-left"></i></button>
                        <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.5px;">${this.t('stories')}</h1>
                    </div>
                    <button class="glass-btn" onclick="document.getElementById('story-upload').click()" style="width: 40px; height: 40px; border-radius: 12px; padding: 0; display: flex; align-items: center; justify-content: center;"><i data-lucide="camera" style="width: 20px;"></i></button>
                </div>
                ${storiesHTML}
            </div>
        `;
        lucide.createIcons();
    };

    HamsterApp.prototype.handleStoryUpload = async function(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Story aspect ratio is usually 9:16, but we'll crop to square for simplicity or keep original
                    const maxWidth = 1080;
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (maxWidth / width) * height;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    const base64 = canvas.toDataURL('image/jpeg', 0.7);

                    await addDoc(collection(db, 'stories'), {
                        uid: this.user.uid,
                        name: this.userData.displayName,
                        photo: this.userData.photoURL,
                        image: base64,
                        createdAt: serverTimestamp()
                    });

                    this.showAlert(this.lang === 'ar' ? 'تم النشر' : 'Moment Captured', this.lang === 'ar' ? 'تم نشر القصة بنجاح!' : 'Story posted successfully!');
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error(err);
            this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Upload Error', this.lang === 'ar' ? 'فشل رفع القصة.' : 'Error uploading story');
        }
    };

    HamsterApp.prototype.viewStory = function(storyId) {
        this.activeStoryId = storyId;
        const story = this.allStories.find(s => s.id === storyId);
        if (!story) return;

        const isMine = story.uid === this.user.uid;
        const timeStr = story.createdAt ? this.formatLastSeen(story.createdAt.seconds * 1000) : '';

        let contentHTML = '';
        if (story.type === 'text') {
            contentHTML = `
                <div style="width: 100%; height: 100%; background: ${story.bg || 'var(--accent)'}; display: flex; align-items: center; justify-content: center; padding: 40px; text-align: center; color: white; font-size: 24px; font-weight: 800; line-height: 1.4;">
                    ${story.text}
                </div>
            `;
        } else {
            contentHTML = `<img src="${story.image}" style="width: 100%; height: 100%; object-fit: contain; display: block;">`;
        }

        const hasLiked = story.likes?.includes(this.user.uid);
        const replyAreaHTML = !isMine ? `
            <div style="position: absolute; bottom: 30px; left: 0; right: 0; padding: 0 20px; display: flex; align-items: center; gap: 10px; z-index: 100;">
                <div style="flex: 1; background: rgba(30, 41, 59, 0.85); border-radius: 30px; height: 50px; display: flex; align-items: center; padding: 0 8px 0 20px; backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.12); box-sizing: border-box;">
                    <input type="text" id="story-reply-input" placeholder="${this.lang === 'ar' ? 'رد على القصة...' : 'Reply to story...'}" 
                        style="flex: 1; height: 100%; padding: 0; margin: 0 8px 0 0; background: transparent; border: none; color: white; font-size: 15px; outline: none; box-sizing: border-box; line-height: normal;"
                        onkeydown="if(event.key === 'Enter') app.replyToStory('${story.id}', this.value)">
                    <button onclick="app.replyToStory('${story.id}', document.getElementById('story-reply-input').value)" 
                        style="width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; transform: ${this.lang === 'ar' ? 'scaleX(-1)' : 'none'}; flex-shrink: 0;">
                        <i data-lucide="send" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
                <button onclick="app.sendStoryReaction('${story.id}')" style="width: 50px; height: 50px; border-radius: 50%; background: rgba(30, 41, 59, 0.85); color: ${hasLiked ? '#ef4444' : 'white'}; border: 1px solid rgba(255,255,255,0.12); cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(16px); transition: all 0.2s; flex-shrink: 0;">
                    <i data-lucide="heart" style="width: 22px; height: 22px; ${hasLiked ? 'fill: #ef4444;' : ''}"></i>
                </button>
            </div>
        ` : '';

        this.showModal(`
            <div style="position: relative; width: 100%; height: 100%; background: #000; overflow: hidden; display: flex; flex-direction: column;">
                <!-- Header -->
                <div style="position: absolute; top: 0; left: 0; right: 0; padding: 20px 16px; background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent); display: flex; align-items: center; gap: 12px; z-index: 100;">
                    <button onclick="app.closeModal()" style="background: transparent; border: none; color: white; cursor: pointer; display: flex; align-items: center; padding: 4px;"><i data-lucide="chevron-left" style="width: 28px; height: 28px;"></i></button>
                    <div style="width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); overflow: hidden; flex-shrink: 0;">
                        <img src="${story.uid === this.user.uid ? this.userData.photoURL : story.photo}" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <div style="flex: 1; overflow: hidden;">
                        <div style="color: white; font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${story.uid === this.user.uid ? this.userData.displayName : story.name}</div>
                        <div style="color: rgba(255,255,255,0.6); font-size: 12px;">${timeStr}</div>
                    </div>
                     ${isMine ? `
                        <button onclick="app.deleteStory('${story.id}')" style="background: transparent; border: none; color: white; opacity: 0.8; cursor: pointer; padding: 8px;"><i data-lucide="trash-2" style="width: 20px;"></i></button>
                    ` : ''}
                </div>

                <!-- Content Area -->
                <div style="flex: 1; display: flex; align-items: center; justify-content: center; position: relative; width: 100%; height: 100%;">
                    ${contentHTML}
                </div>

                <!-- Footer / Reply -->
                ${replyAreaHTML}

                <!-- Views/Likes for Owner -->
                ${isMine ? `
                    <div style="position: absolute; bottom: 30px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 100;">
                        <div style="background: rgba(0,0,0,0.7); padding: 10px 20px; border-radius: 20px; color: white; display: flex; align-items: center; gap: 14px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.15); font-size: 13px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" onclick="app.showStoryViewersPanel('${story.id}')">
                            <div style="display: flex; align-items: center; gap: 6px;"><i data-lucide="eye" style="width: 15px; height: 15px;"></i> ${story.viewers?.length || 0}</div>
                            <div style="width: 1px; height: 12px; background: rgba(255,255,255,0.25);"></div>
                            <div style="display: flex; align-items: center; gap: 6px;"><i data-lucide="heart" style="width: 15px; height: 15px; fill: #ef4444; stroke: #ef4444;"></i> ${story.likes?.length || 0}</div>
                        </div>
                    </div>

                    <!-- Bottom Sheet for Viewers/Likes -->
                    <div id="story-viewers-sheet" style="position: absolute; bottom: -100%; left: 0; right: 0; height: 65%; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(20px); border-radius: 24px 24px 0 0; border-top: 1px solid rgba(255,255,255,0.15); z-index: 1000; transition: bottom 0.3s cubic-bezier(0.1, 0.76, 0.55, 0.94); display: flex; flex-direction: column; overflow: hidden; padding: 20px 20px 30px; box-shadow: 0 -10px 40px rgba(0,0,0,0.5);">
                        <!-- Drag Handle -->
                        <div style="width: 40px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 0 auto 16px; flex-shrink: 0;"></div>

                        <!-- Header -->
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-shrink: 0; direction: ${this.lang === 'ar' ? 'rtl' : 'ltr'};">
                            <h3 style="color: white; margin: 0; font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                                <i data-lucide="eye" style="color: var(--accent); width: 18px; height: 18px;"></i>
                                ${this.lang === 'ar' ? 'المشاهدات والتفاعلات' : 'Views & Likes'}
                            </h3>
                            <button onclick="document.getElementById('story-viewers-sheet').style.bottom = '-100%'" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                                <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                            </button>
                        </div>

                        <!-- Loading Indicator -->
                        <div id="viewers-loading" style="flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-weight: 500; font-size: 14px; gap: 10px;">
                            <div class="spinner" style="border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--accent); border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite;"></div>
                            <span>${this.lang === 'ar' ? 'جاري تحميل المشاهدين...' : 'Loading viewers...'}</span>
                        </div>

                        <!-- Viewers List Container -->
                        <div id="viewers-list-container" style="flex: 1; overflow-y: auto; display: none; flex-direction: column; gap: 10px; padding-right: 4px;">
                        </div>
                    </div>
                ` : ''}
            </div>
        `, true);
        lucide.createIcons({ node: document.getElementById('modal-content') });

        if (!isMine) {
            this.markStoryViewed(story.id);
        }
    };

    HamsterApp.prototype.markStoryViewed = async function(storyId) {
        const storyRef = doc(db, 'stories', storyId);
        const story = this.allStories.find(s => s.id === storyId);
        if (!story) return;
        const viewers = story.viewers || [];
        if (!viewers.includes(this.user.uid)) {
            await updateDoc(storyRef, { viewers: arrayUnion(this.user.uid) });
        }
    };

    HamsterApp.prototype.sendStoryReaction = async function(storyId) {
        const storyRef = doc(db, 'stories', storyId);
        const story = this.allStories.find(s => s.id === storyId);
        if (!story) return;

        const likes = story.likes || [];
        if (likes.includes(this.user.uid)) {
            await updateDoc(storyRef, { likes: arrayRemove(this.user.uid) });
        } else {
            await updateDoc(storyRef, { likes: arrayUnion(this.user.uid) });
        }
    };

    HamsterApp.prototype.replyToStory = async function(storyId, text) {
        if (!text || !text.trim()) return;
        try {
            const story = this.allStories.find(s => s.id === storyId);
            if (!story) return;

            const targetId = story.uid;
            let chatId = '';

            // Safe, bulletproof lookup to find ANY existing 1-on-1 direct chat with this user
            const existingChat = this.allChats.find(c => c.type !== 'group' && c.type !== 'ai' && c.memberIds.includes(targetId));
            
            // Calculate unread message badge count update for the recipient
            const unreadUpdate = existingChat ? this.getUnreadCountsUpdate(existingChat) : { unreadCounts: { [targetId]: 1 } };

            if (existingChat) {
                chatId = existingChat.id;
            } else {
                const newChatRef = await addDoc(collection(db, 'chats'), {
                    type: 'direct',
                    memberIds: [this.user.uid, targetId],
                    memberData: {
                        [this.user.uid]: { name: this.userData.displayName, photo: this.userData.photoURL, username: this.userData.username },
                        [targetId]: { name: story.name, photo: story.photo }
                    },
                    archivedBy: [],
                    updatedAt: serverTimestamp(),
                    lastMessage: null
                });
                chatId = newChatRef.id;
            }

            const replyText = `[${this.lang === 'ar' ? 'رد على القصة' : 'Reply to story'}] ${text.trim()}`;
            
            // Build direct chat context for E2E encryption
            const chatObject = existingChat || {
                id: chatId,
                type: 'direct',
                memberIds: [this.user.uid, targetId]
            };

            // Attempt E2E encryption for maximum security
            let e2eData = {};
            try {
                e2eData = await this.encryptMessagePayload(chatObject, { text: replyText });
            } catch (err) {
                console.warn("E2E encryption failed for story reply, falling back to plain text:", err);
                e2eData = {
                    text: replyText,
                    isE2E: false,
                    ciphertext: ""
                };
            }

            const msgRef = doc(collection(db, `chats/${chatId}/messages`));
            const payload = {
                chatId,
                senderId: this.user.uid,
                createdAt: serverTimestamp(),
                status: 'sent',
                storyRef: {
                    storyId: story.id,
                    type: story.type || 'image',
                    preview: story.type === 'text' ? (story.text || '') : (story.image || '')
                },
                ...e2eData
            };

            const batch = writeBatch(db);
            batch.set(msgRef, payload);

            const displayLastMsg = e2eData.isE2E ? (this.lang === 'ar' ? '🔒 رد على قصة' : '🔒 Replied to story') : replyText;
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { 
                    text: displayLastMsg, 
                    senderId: this.user.uid, 
                    msgId: msgRef.id,
                    ...e2eData
                },
                ...unreadUpdate,
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();

            document.getElementById('story-reply-input').value = '';
            this.closeModal();

            // Dynamically transition and open the chat view instantly (seamless WhatsApp/Instagram feel)
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            const chatsNav = document.querySelector('.nav-item[data-page="chats"]');
            if (chatsNav) chatsNav.classList.add('active');

            this.handleNavigation('chats');
            this.selectChat(chatId);
        } catch (error) {
            console.error("Critical error in replyToStory:", error);
            this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Error', this.lang === 'ar' ? 'حدث خطأ أثناء إرسال الرد، يرجى المحاولة لاحقاً.' : 'An error occurred while sending your reply. Please try again.');
        }
    };

    HamsterApp.prototype.deleteStory = async function(storyId) {
        this.closeModal();
        this.showConfirm(
            this.lang === 'ar' ? 'حذف القصة' : 'Delete Story',
            this.lang === 'ar' ? 'هل أنت متأكد من حذف هذه القصة؟' : 'Are you sure you want to delete this story?',
            async () => {
                await deleteDoc(doc(db, 'stories', storyId));
            }
        );
    };

    HamsterApp.prototype.promptTextStory = function() {
        this.showPrompt(
            this.lang === 'ar' ? 'قصة نصية' : 'Text Story',
            this.lang === 'ar' ? 'ماذا يدور في ذهنك؟' : 'What is on your mind?',
            '',
            async (text) => {
                if (text && text.trim()) {
                    await this.submitTextStory(text.trim());
                }
            }
        );
    };

    HamsterApp.prototype.submitTextStory = async function(text) {
        const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        await addDoc(collection(db, 'stories'), {
            uid: this.user.uid,
            name: this.userData.displayName,
            photo: this.userData.photoURL,
            type: 'text',
            text: text,
            bg: randomColor,
            createdAt: serverTimestamp()
        });

        this.showAlert(this.lang === 'ar' ? 'تم النشر' : 'Moment Captured', this.lang === 'ar' ? 'تم نشر القصة بنجاح!' : 'Story shared successfully!');
    };

    HamsterApp.prototype.showStoryViewersPanel = async function(storyId) {
        const sheet = document.getElementById('story-viewers-sheet');
        if (!sheet) return;

        // Animate up
        sheet.style.bottom = '0';

        const loading = document.getElementById('viewers-loading');
        const container = document.getElementById('viewers-list-container');

        loading.style.display = 'flex';
        container.style.display = 'none';
        container.innerHTML = '';

        try {
            const story = this.allStories.find(s => s.id === storyId);
            if (!story) throw new Error("Story not found");

            const viewers = story.viewers || [];
            const likes = story.likes || [];

            if (viewers.length === 0) {
                loading.style.display = 'none';
                container.style.display = 'flex';
                container.innerHTML = `
                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-muted); gap: 10px; padding: 40px 0;">
                        <i data-lucide="eye-off" style="width: 32px; height: 32px; opacity: 0.5;"></i>
                        <span style="font-size: 13px;">${this.lang === 'ar' ? 'لا يوجد مشاهدات بعد' : 'No views yet'}</span>
                    </div>
                `;
                if (window.lucide) lucide.createIcons({ node: container });
                return;
            }

            const viewerDetails = await Promise.all(viewers.map(async uid => {
                try {
                    const userDoc = await getDoc(doc(db, 'users', uid));
                    if (userDoc.exists()) {
                        return { uid, ...userDoc.data() };
                    }
                } catch (e) {
                    console.error("Failed to fetch user info for viewer:", uid, e);
                }
                return { uid, displayName: 'User', photoURL: 'https://ui-avatars.com/api/?name=User' };
            }));

            let listHTML = '';
            viewerDetails.forEach(v => {
                const hasLiked = likes.includes(v.uid);
                const photo = v.photoURL || `https://ui-avatars.com/api/?name=${v.displayName || 'U'}`;
                const name = v.displayName || 'User';
                const usernameLabel = v.username ? `@${v.username}` : '';

                listHTML += `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 14px; border: 1px solid rgba(255,255,255,0.05); direction: ${this.lang === 'ar' ? 'rtl' : 'ltr'};">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <img src="${photo}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);" onerror="this.src='https://ui-avatars.com/api/?name=U'">
                            <div style="display: flex; flex-direction: column; text-align: ${this.lang === 'ar' ? 'right' : 'left'};">
                                <span style="color: white; font-size: 14px; font-weight: 600;">${name}</span>
                                ${usernameLabel ? `<span style="color: var(--text-muted); font-size: 11px;">${usernameLabel}</span>` : ''}
                            </div>
                        </div>
                        ${hasLiked ? `
                            <div style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); color: #ef4444; flex-shrink: 0;">
                                <i data-lucide="heart" style="width: 16px; height: 16px; fill: #ef4444;"></i>
                            </div>
                        ` : ''}
                    </div>
                `;
            });

            loading.style.display = 'none';
            container.style.display = 'flex';
            container.innerHTML = listHTML;

            if (window.lucide) lucide.createIcons({ node: container });
        } catch (err) {
            console.error("Error displaying story viewers:", err);
            loading.style.display = 'none';
            container.style.display = 'flex';
            container.innerHTML = `
                <div style="color: #ef4444; font-weight: 500; font-size: 13px; text-align: center; width: 100%; padding: 40px 0;">
                    ${this.lang === 'ar' ? 'حدث خطأ أثناء تحميل القائمة' : 'Failed to load list'}
                </div>
            `;
        }
    };
}

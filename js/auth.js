import {
    auth, db, googleProvider,
    onAuthStateChanged, signInWithPopup, signOut,
    doc, onSnapshot, getDoc, setDoc, serverTimestamp, getDocs, collection, where, query
} from './firebase-config.js';

export function extendAuth(HamsterApp) {
    HamsterApp.prototype.setupAuth = function() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.user = user;

                // Link User to OneSignal
                if (window.OneSignalDeferred) {
                    window.OneSignalDeferred.push(async function(OneSignal) {
                        await OneSignal.login(user.uid);
                    });
                }

                // Show App immediately for better UX
                document.getElementById('auth-overlay').classList.add('hidden');
                document.getElementById('hamster-app').classList.remove('hidden');

                // Initialize with basic auth data first
                this.userData = {
                    uid: user.uid,
                    displayName: user.displayName || 'User',
                    photoURL: user.photoURL || 'assets/logo.jpg',
                    email: user.email
                };
                this.updateGlobalUserUI();

                // Initialize E2E Encryption BEFORE loading chats so sidebar can decrypt instantly
                try {
                    await this.initE2E();
                } catch(e) { console.error("E2E Init error", e); }

                // Start listeners
                this.listenForChats();
                this.listenForStories();

                // Start live listener for bans
                if (this.userStateListener) this.userStateListener();
                this.userStateListener = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
                    if (docSnap.exists()) {
                        const d = docSnap.data();
                        
                        // Update local data live so UI (like Admin Panel) reacts immediately
                        this.userData = { ...this.userData, ...d };

                        if (d.bannedForever || (d.bannedUntil && d.bannedUntil > Date.now())) {
                            this.showAlert(this.lang === 'ar' ? 'محظور' : 'Banned', this.lang === 'ar' ? 'تم حظر حسابك من قبل الإدارة لانتهاك الشروط.' : 'Your account has been suspended by the admin.');
                            setTimeout(() => this.logout(), 3500);
                        }
                    }
                });

                // Start active call listener
                this.listenForIncomingCalls();
                this.cleanupOldCalls();

                try {
                    await this.syncUser(user);
                    this.updateGlobalUserUI(); // Final update with DB data

                    // Update localStorage with synced data
                    if (this.userData?.appLockPin) localStorage.setItem('hamster-lock-pin', this.userData.appLockPin);
                    if (this.userData?.wallpaper) localStorage.setItem('hamster-wallpaper', this.userData.wallpaper);

                    // Re-check App Lock in case it was enabled on another device
                    if (this.userData?.appLockPin && !this.isUnlockedSession && !this.isLocked) {
                        this.showLockScreen();
                    }

                    console.log("Hamster: Session Synced", user.email);
                } catch (e) {
                    console.error("Hamster: Sync failed (working offline?)", e);
                }
            } else {
                this.user = null;
                this.userData = null;
                // Hide Lock Screen if shown from localStorage but no user session exists
                document.getElementById('app-lock-overlay').classList.add('hidden');
                this.isLocked = false;

                // Show Login
                document.getElementById('hamster-app').classList.add('hidden');
                document.getElementById('auth-overlay').classList.remove('hidden');
                if (window.lucide) lucide.createIcons({ node: document.getElementById('auth-overlay') });
            }
        });
    };

    HamsterApp.prototype.generateUniqueUsername = async function(base, uid) {
        let candidate = base.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!candidate) candidate = 'user';

        let suffix = '';
        let attempts = 0;
        while (attempts < 20) {
            const q = query(collection(db, 'users'), where('username', '==', candidate + suffix));
            const snap = await getDocs(q);
            const taken = snap.docs.some(d => d.id !== uid);
            if (!taken) return candidate + suffix;
            suffix = suffix === '' ? '2' : String(parseInt(suffix) + 1);
            attempts++;
        }
        // Last resort: append random 4 digits
        return candidate + Math.floor(1000 + Math.random() * 9000);
    };

    HamsterApp.prototype.syncUser = async function(user) {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);

        let existingData = {};
        if (snap.exists()) {
            existingData = snap.data();
            // Merge with existing local data to avoid losing localStorage values before sync
            this.userData = { ...this.userData, ...existingData };
        }

        // Only generate/validate username if the user doesn't already have one
        let username = existingData.username;
        if (!username) {
            const base = user.email.split('@')[0];
            username = await this.generateUniqueUsername(base, user.uid);
        }

        const payload = {
            uid: user.uid,
            displayName: existingData.displayName || user.displayName,
            email: user.email,
            photoURL: existingData.photoURL || user.photoURL,
            username,
            lastSeen: serverTimestamp()
        };

        await setDoc(userRef, payload, { merge: true });
        this.userData = { ...existingData, ...payload };

        if (this.presenceInterval) clearInterval(this.presenceInterval);
        this.presenceInterval = setInterval(() => {
            setDoc(doc(db, 'users', user.uid), { lastSeen: serverTimestamp() }, { merge: true });
        }, 60000);
    };

    HamsterApp.prototype.login = async function() {
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (e) {
            console.error("Login failed", e);
            this.showAlert(this.lang === 'ar' ? 'فشل الاتصال' : 'Connection Error', this.lang === 'ar' ? 'يرجى المحاولة مرة أخرى.' : 'Please try again.');
        }
    };

    HamsterApp.prototype.logout = async function() {
        if (this.presenceInterval) clearInterval(this.presenceInterval);
        await signOut(auth);
        window.location.reload();
    };

    HamsterApp.prototype.updateGlobalUserUI = function() {
        if (!this.user) return;
        const imgHTML = `<img src="${this.userData?.photoURL || this.user.photoURL}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;

        const container = document.getElementById('current-user-avatar');
        if (container) container.innerHTML = imgHTML;

        const mobileContainer = document.getElementById('mobile-user-avatar');
        if (mobileContainer) mobileContainer.innerHTML = imgHTML;
    };
}
import {
    db, onSnapshot, query, where, collection, doc, addDoc, serverTimestamp, updateDoc, deleteDoc, getDocs, setDoc, getDoc
} from './firebase-config.js';

export function extendCalls(HamsterApp) {
    HamsterApp.prototype.toggleCallDropdown = function() {
        const dd = document.getElementById('call-dropdown');
        if (dd) dd.classList.toggle('hidden');
    };

    HamsterApp.prototype.cleanupOldCalls = async function() {
        if (!this.user || !this.user.uid) return;
        try {
            const now = Date.now();
            const ONE_HOUR = 60 * 60 * 1000;
            
            // 1. Cleanup 1-on-1 calls where I am the caller
            const myCallsQuery = query(collection(db, 'calls'), where('callerId', '==', this.user.uid));
            const myCallsSnap = await getDocs(myCallsQuery);
            myCallsSnap.forEach(async (docSnap) => {
                const data = docSnap.data();
                const callTime = data.createdAt?.toMillis ? data.createdAt.toMillis() : now;
                if (data.status === 'ended' || data.status === 'rejected' || (now - callTime > ONE_HOUR)) {
                    await deleteDoc(doc(db, 'calls', docSnap.id)).catch(e => console.warn(e));
                }
            });

            // 2. Cleanup group calls where I am the initiator
            const myGroupCallsQuery = query(collection(db, 'groupCalls'), where('initiatorId', '==', this.user.uid));
            const myGroupCallsSnap = await getDocs(myGroupCallsQuery);
            myGroupCallsSnap.forEach(async (docSnap) => {
                const data = docSnap.data();
                const callTime = data.createdAt?.toMillis ? data.createdAt.toMillis() : now;
                if (data.status === 'ended' || (now - callTime > ONE_HOUR)) {
                    await deleteDoc(doc(db, 'groupCalls', docSnap.id)).catch(e => console.warn(e));
                }
            });
            console.log("Cleanup of old calls completed.");
        } catch(e) {
            console.error("Cleanup calls error:", e);
        }
    };

    HamsterApp.prototype.listenForIncomingCalls = function() {
        if (this.incomingCallUnsub) this.incomingCallUnsub();
        
        const q = query(collection(db, 'calls'), where('calleeId', '==', this.user.uid));
        this.incomingCallUnsub = onSnapshot(q, (snap) => {
            const callingDocs = snap.docs.filter(doc => doc.data().status === 'calling');
            
            if (callingDocs.length === 0) {
                if (this.currentCallData && this.currentCallData.status === 'calling' && this.currentCallData.calleeId === this.user.uid) {
                    this.hideCallOverlay();
                    this.currentCallData = null;
                }
                return;
            }

            const callDoc = callingDocs[0];
            const data = callDoc.data();
            data.id = callDoc.id;

            if (this.currentCallData && this.currentCallData.id === data.id && this.currentCallData.status !== 'calling') return;

            this.currentCallData = data;
            this.isVideoCall = data.callType === 'video';
            
            const callerName = data.callerName || 'Unknown';
            const callerPhoto = data.callerPhoto || 'assets/logo.jpg';
            const typeLabel = this.isVideoCall 
                ? (this.lang === 'ar' ? 'مكالمة فيديو واردة...' : 'Incoming Video Call...') 
                : (this.lang === 'ar' ? 'مكالمة صوتية واردة...' : 'Incoming Voice Call...');
            
            this.playRingtone();
            this.showCallOverlay(callerName, callerPhoto, 'incoming', typeLabel);
        });

        // Also listen for incoming group calls
        this.listenForIncomingGroupCalls();
    };

    HamsterApp.prototype.startCall = async function(chatId, callType = 'audio') {
        if (!this.agoraAppId || this.agoraAppId === "") {
            this.showAlert(this.lang === 'ar' ? 'تذكير' : 'Setup Required', this.lang === 'ar' ? 'الرجاء إدخال Agora App ID الخاص بك في ملف app.js.' : 'Please insert your Agora App ID in app.js inside the constructor.');
            return;
        }

        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        if (chat.type === 'group') {
            this.startGroupCall(chatId, callType);
            return;
        }

        const blockedBy = chat.blockedBy || [];
        if (blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'مكالمة مقفلة' : 'Call Blocked', this.lang === 'ar' ? 'لا يمكنك إجراء مكالمات في محادثة محظورة.' : 'You cannot make calls in a blocked conversation.');
            return;
        }

        this.isVideoCall = callType === 'video';
        const partner = this.getChatPartner(chat);
        const calleeId = chat.memberIds.find(id => id !== this.user.uid);

        if (!calleeId) return;

        try {
            const callDocRef = await addDoc(collection(db, 'calls'), {
                chatId: chatId,
                callerId: this.user.uid,
                calleeId: calleeId,
                callerName: this.userData.displayName,
                callerPhoto: this.userData.photoURL,
                callType: callType,
                status: 'calling',
                channelName: chatId,
                createdAt: serverTimestamp()
            });

            this.currentCallData = { id: callDocRef.id, status: 'calling', channelName: chatId, callType: callType };
            const statusLabel = this.isVideoCall
                ? (this.lang === 'ar' ? 'مكالمة فيديو...' : 'Video Calling...')
                : (this.lang === 'ar' ? 'جاري الاتصال...' : 'Calling...');
            this.playRingtone();
            this.showCallOverlay(partner.name, partner.photo, 'outgoing', statusLabel);

            // Listen for answer/reject
            if (this.activeCallListener) this.activeCallListener();
            this.activeCallListener = onSnapshot(doc(db, 'calls', callDocRef.id), async (docSnap) => {
                if (!docSnap.exists()) {
                    this.endCall(true);
                    return;
                }
                const data = docSnap.data();
                if (data.status === 'answered') {
                    this.stopRingtone();
                    this.currentCallData.status = 'answered';
                    document.getElementById('call-status').innerText = '00:00';
                    document.getElementById('call-actions-outgoing').classList.add('hidden');
                    document.getElementById('call-actions-active').classList.remove('hidden');
                    if (this.isVideoCall) {
                        document.getElementById('call-cam-btn').style.display = 'flex';
                    }
                    this.startCallTimer();
                    await this.joinAgoraChannel(data.channelName);
                } else if (data.status === 'rejected' || data.status === 'ended') {
                    this.endCall(true);
                }
            });
        } catch (e) {
            console.error("Start call error:", e);
            this.showAlert('Error', 'Failed to start call: ' + e.message + "\n\n(Have you updated the Firestore Rules?)");
        }
    };

    HamsterApp.prototype.playRingtone = function() {
        const audio = document.getElementById('call-ringtone-audio');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.warn("Ringtone play failed:", e));
        }
    };

    HamsterApp.prototype.stopRingtone = function() {
        const audio = document.getElementById('call-ringtone-audio');
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
    };

    HamsterApp.prototype.toggleCallMinimize = function() {
        const overlay = document.getElementById('call-overlay');
        const isMinimized = overlay.classList.toggle('minimized');
        const btn = document.querySelector('#call-top-bar button i');
        if (btn) {
            btn.setAttribute('data-lucide', isMinimized ? 'maximize-2' : 'minimize-2');
            if (window.lucide) lucide.createIcons();
        }
    };

    HamsterApp.prototype.answerCall = async function() {
        if (!this.currentCallData || this.currentCallData.status !== 'calling') return;
        
        try {
            this.stopRingtone();
            this.currentCallData.status = 'answered';
            
            document.getElementById('call-actions-incoming').classList.add('hidden');
            document.getElementById('call-actions-active').classList.remove('hidden');
            document.getElementById('call-status').innerText = '00:00';
            // Show camera button for video calls
            if (this.isVideoCall) {
                document.getElementById('call-cam-btn').style.display = 'flex';
            }
            this.startCallTimer();

            await updateDoc(doc(db, 'calls', this.currentCallData.id), { status: 'answered', answeredAt: serverTimestamp() });
            
            if (this.activeCallListener) this.activeCallListener();
            this.activeCallListener = onSnapshot(doc(db, 'calls', this.currentCallData.id), (docSnap) => {
                if (!docSnap.exists() || docSnap.data().status === 'ended') {
                    this.endCall(true);
                }
            });

            await this.joinAgoraChannel(this.currentCallData.channelName);
        } catch (e) {
            console.error("Answer err:", e);
            this.endCall();
        }
    };

    HamsterApp.prototype.rejectCall = async function() {
        if (this.currentCallData && this.currentCallData.id) {
            try {
                await deleteDoc(doc(db, 'calls', this.currentCallData.id));
            } catch (e) { console.error(e); }
        }
        this.hideCallOverlay();
        this.currentCallData = null;
    };

    HamsterApp.prototype.endCall = async function(isRemote = false) {
        if (!this.currentCallData) {
            this.hideCallOverlay();
            return;
        }

        if (!isRemote && this.currentCallData.id) {
            try {
                await deleteDoc(doc(db, 'calls', this.currentCallData.id));
            } catch (e) { console.error(e); }
        }

        this.leaveAgoraChannel();
        this.stopRingtone();
        this.hideCallOverlay();
        if (this.activeCallListener) {
            this.activeCallListener();
            this.activeCallListener = null;
        }
        this.currentCallData = null;
        this.isVideoCall = false;
        clearInterval(this.callTimer);
    };

    HamsterApp.prototype.joinAgoraChannel = async function(channelName) {
        if (!window.AgoraRTC) {
            console.error("Agora SDK not loaded");
            return;
        }
        if (!this.agoraClient) {
            this.agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            
            this.agoraClient.on("user-published", async (user, mediaType) => {
                await this.agoraClient.subscribe(user, mediaType);
                if (mediaType === "audio") {
                    user.audioTrack.play();
                }
                if (mediaType === "video") {
                    const remoteContainer = document.getElementById('remote-video-container');
                    remoteContainer.style.display = 'block';
                    remoteContainer.innerHTML = '';
                    user.videoTrack.play(remoteContainer);
                    // In video call, hide static avatar/name when remote video appears
                    document.getElementById('call-avatar').style.display = 'none';
                    document.getElementById('call-name').style.display = 'none';
                }
            });

            this.agoraClient.on("user-unpublished", (user, mediaType) => {
                if (mediaType === "video") {
                    const remoteContainer = document.getElementById('remote-video-container');
                    remoteContainer.style.display = 'none';
                    remoteContainer.innerHTML = '';
                    // Re-show avatar if remote stops video
                    document.getElementById('call-avatar').style.display = 'block';
                    document.getElementById('call-name').style.display = 'block';
                }
            });

            this.agoraClient.on("network-quality", (quality) => {
                const indicator = document.getElementById('call-network-quality');
                const label = indicator.querySelector('span');
                const icon = indicator.querySelector('i');
                
                // 0: Unknown, 1: Excellent, 2: Good, 3: Poor, 4: Bad, 5: Very Bad, 6: Down
                if (quality.downlinkNetworkQuality <= 2) {
                    indicator.style.color = '#10b981';
                    label.innerText = this.lang === 'ar' ? 'ممتاز' : 'Excellent';
                } else if (quality.downlinkNetworkQuality <= 4) {
                    indicator.style.color = '#f59e0b';
                    label.innerText = this.lang === 'ar' ? 'ضعيف' : 'Poor';
                } else {
                    indicator.style.color = '#ef4444';
                    label.innerText = this.lang === 'ar' ? 'سيء جداً' : 'Bad';
                }
            });
        }

        try {
            await this.agoraClient.join(this.agoraAppId, channelName, null, null);

            // Audio track (always)
            this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            
            if (this.isVideoCall) {
                // Video track
                this.localVideoTrack = await AgoraRTC.createCameraVideoTrack();
                await this.agoraClient.publish([this.localAudioTrack, this.localVideoTrack]);
                
                // Play local preview in small PiP
                const localContainer = document.getElementById('local-video-container');
                localContainer.style.display = 'block';
                localContainer.innerHTML = '';
                this.localVideoTrack.play(localContainer);
                
                console.log("Joined Agora Video Call");
            } else {
                await this.agoraClient.publish([this.localAudioTrack]);
                console.log("Joined Agora Voice Call");
            }
        } catch (e) {
            console.error("Agora join failed:", e);
            if (e.message && (e.message.includes("PERMISSION_DENIED") || e.message.includes("NotAllowedError"))) {
                this.showAlert(this.lang === 'ar' ? 'صلاحيات مطلوبة' : 'Permissions Required', this.lang === 'ar' ? 'يرجى السماح للتطبيق باستخدام الميكروفون والكاميرا.' : 'Please grant microphone and camera permissions.');
            } else {
                this.showAlert('Call Error', 'Error: ' + (e.message || 'Could not join room.'));
            }
            this.endCall();
        }
    };

    HamsterApp.prototype.leaveAgoraChannel = async function() {
        if (this.localAudioTrack) {
            this.localAudioTrack.stop();
            this.localAudioTrack.close();
            this.localAudioTrack = null;
        }
        if (this.localVideoTrack) {
            this.localVideoTrack.stop();
            this.localVideoTrack.close();
            this.localVideoTrack = null;
        }
        if (this.agoraClient) {
            await this.agoraClient.leave();
        }
        // Clear video containers
        document.getElementById('remote-video-container').innerHTML = '';
        document.getElementById('remote-video-container').style.display = 'none';
        document.getElementById('local-video-container').innerHTML = '';
        document.getElementById('local-video-container').style.display = 'none';
        console.log("Left Agora Call");
    };

    HamsterApp.prototype.toggleMuteCall = function() {
        if (this.localAudioTrack) {
            const isMuted = !this.localAudioTrack.muted;
            this.localAudioTrack.setMuted(isMuted);
            const btn = document.getElementById('call-mute-btn');
            if (isMuted) {
                btn.style.background = '#ef4444';
                btn.innerHTML = '<i data-lucide="mic-off"></i>';
            } else {
                btn.style.background = 'rgba(255,255,255,0.1)';
                btn.innerHTML = '<i data-lucide="mic"></i>';
            }
            if (window.lucide) lucide.createIcons({ node: btn });
        }
    };

    HamsterApp.prototype.toggleCameraCall = async function() {
        const btn = document.getElementById('call-cam-btn');
        if (this.localVideoTrack) {
            // Camera is ON -> Turn OFF
            this.localVideoTrack.stop();
            this.localVideoTrack.close();
            await this.agoraClient.unpublish([this.localVideoTrack]);
            this.localVideoTrack = null;
            document.getElementById('local-video-container').style.display = 'none';
            document.getElementById('local-video-container').innerHTML = '';
            btn.style.background = '#ef4444';
            btn.innerHTML = '<i data-lucide="video-off"></i>';
        } else {
            // Camera is OFF -> Turn ON
            try {
                this.localVideoTrack = await AgoraRTC.createCameraVideoTrack();
                await this.agoraClient.publish([this.localVideoTrack]);
                const localContainer = document.getElementById('local-video-container');
                localContainer.style.display = 'block';
                localContainer.innerHTML = '';
                this.localVideoTrack.play(localContainer);
                btn.style.background = 'rgba(255,255,255,0.1)';
                btn.innerHTML = '<i data-lucide="video"></i>';
            } catch (e) {
                console.error("Camera toggle err:", e);
                this.showAlert('Error', this.lang === 'ar' ? 'تعذر تشغيل الكاميرا.' : 'Could not enable camera.');
            }
        }
        if (window.lucide) lucide.createIcons({ node: btn });
    };

    HamsterApp.prototype.showCallOverlay = function(name, photo, state, statusText) {
        // Set partner info
        document.getElementById('call-name').innerText = name;
        document.getElementById('call-avatar').src = photo || 'assets/logo.jpg';
        document.getElementById('call-status').innerText = statusText;

        // Set my own info (the logged-in user)
        if (this.userData) {
            document.getElementById('call-my-avatar').src = this.userData.photoURL || 'assets/logo.jpg';
            document.getElementById('call-my-name').innerText = this.userData.displayName || '';
        }

        // Reset visibility of dynamic elements
        document.getElementById('call-avatar').style.display = 'block';
        document.getElementById('call-name').style.display = 'block';
        document.getElementById('call-actions-incoming').classList.add('hidden');
        document.getElementById('call-actions-outgoing').classList.add('hidden');
        document.getElementById('call-actions-active').classList.add('hidden');
        document.getElementById('call-cam-btn').style.display = 'none';
        document.getElementById('remote-video-container').style.display = 'none';
        document.getElementById('local-video-container').style.display = 'none';

        if (state === 'incoming') {
            document.getElementById('call-actions-incoming').classList.remove('hidden');
        } else if (state === 'outgoing') {
            document.getElementById('call-actions-outgoing').classList.remove('hidden');
        } else if (state === 'active') {
            document.getElementById('call-actions-active').classList.remove('hidden');
        }

        document.getElementById('call-overlay').classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    };

    HamsterApp.prototype.hideCallOverlay = function() {
        const overlay = document.getElementById('call-overlay');
        overlay.classList.add('hidden');
        overlay.classList.remove('minimized');
        document.getElementById('remote-video-container').style.display = 'none';
        document.getElementById('local-video-container').style.display = 'none';
        this.stopRingtone();
        clearInterval(this.callTimer);
    };

    HamsterApp.prototype.startCallTimer = function() {
        let seconds = 0;
        clearInterval(this.callTimer);
        this.callTimer = setInterval(() => {
            seconds++;
            const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
            const secs = (seconds % 60).toString().padStart(2, '0');
            const statusEl = document.getElementById('call-status');
            if (statusEl) statusEl.innerText = `${mins}:${secs}`;
        }, 1000);
    };

    // ==========================================================================
    // GROUP CALL IMPLEMENTATION (Agora RTC Mesh + Firestore Signaling)
    // ==========================================================================

    HamsterApp.prototype.startGroupCall = async function(chatId, callType = 'audio') {
        if (!this.agoraAppId || this.agoraAppId === "") {
            this.showAlert(this.lang === 'ar' ? 'تذكير' : 'Setup Required', this.lang === 'ar' ? 'الرجاء إدخال Agora App ID الخاص بك في ملف app.js.' : 'Please insert your Agora App ID in app.js inside the constructor.');
            return;
        }

        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        // Check if there is already an active group call for this chat
        try {
            const activeCallQuery = query(
                collection(db, 'groupCalls'), 
                where('chatId', '==', chatId), 
                where('status', '==', 'active')
            );
            const activeSnap = await getDocs(activeCallQuery);
            if (!activeSnap.empty) {
                // An active call exists! Join it immediately
                const existingCallDoc = activeSnap.docs[0];
                const callData = existingCallDoc.data();
                callData.id = existingCallDoc.id;
                this.currentGroupCallData = callData;
                this.isGroupVideoCall = callData.callType === 'video';
                
                this.showGroupCallOverlay(chat.name, chat.photo, 'active', this.lang === 'ar' ? 'جاري الانضمام...' : 'Joining...');
                await this.answerGroupCall();
                return;
            }
        } catch (e) {
            console.error("Error checking existing group call:", e);
        }

        this.isGroupVideoCall = callType === 'video';
        const channelName = `group_${chatId}`;

        // Prepare participants list with photos and names
        const participants = {};
        participants[this.user.uid] = {
            status: 'joined',
            name: this.userData.displayName || 'Me',
            photo: this.userData.photoURL || '',
            micMuted: false,
            camMuted: !this.isGroupVideoCall
        };

        chat.memberIds.forEach(uid => {
            if (uid !== this.user.uid) {
                participants[uid] = {
                    status: 'ringing',
                    name: chat.memberData?.[uid]?.name || 'Member',
                    photo: chat.memberData?.[uid]?.photo || '',
                    micMuted: false,
                    camMuted: true
                };
            }
        });

        console.log("GC [Dialer]: Building participants map. MemberIds:", chat.memberIds, "My UID:", this.user.uid);
        console.log("GC [Dialer]: Constructed participants map:", participants);

        try {
            this.isGroupCallActive = true;
            console.log("GC [Dialer]: Writing active group call document to Firestore...");
            const callDocRef = await addDoc(collection(db, 'groupCalls'), {
                chatId: chatId,
                chatName: chat.name,
                chatPhoto: chat.photo || '',
                callType: callType,
                channelName: channelName,
                initiatorId: this.user.uid,
                initiatorName: this.userData.displayName || 'Me',
                status: 'active',
                participants: participants,
                createdAt: serverTimestamp()
            });

            console.log("GC [Dialer]: Successfully wrote groupCalls doc. ID:", callDocRef.id);

            this.currentGroupCallData = {
                id: callDocRef.id,
                chatId: chatId,
                chatName: chat.name,
                chatPhoto: chat.photo || '',
                callType: callType,
                channelName: channelName,
                initiatorId: this.user.uid,
                participants: participants
            };

            this.playRingtone();
            this.showGroupCallOverlay(chat.name, chat.photo, 'outgoing', this.lang === 'ar' ? 'جاري رنين الأعضاء...' : 'Ringing group...');

            // Real-time listener for this group call session
            if (this.activeGroupCallListener) this.activeGroupCallListener();
            this.activeGroupCallListener = onSnapshot(doc(db, 'groupCalls', callDocRef.id), (docSnap) => {
                if (!docSnap.exists()) {
                    this.leaveGroupCall(true);
                    return;
                }
                const data = docSnap.data();
                data.id = docSnap.id;
                this.currentGroupCallData = data;

                if (data.status === 'ended') {
                    this.leaveGroupCall(true);
                    return;
                }

                // Stop ringtone for caller if someone else joined
                const otherJoined = Object.entries(data.participants).some(([uid, p]) => uid !== this.user.uid && p.status === 'joined');
                if (otherJoined) {
                    this.stopRingtone();
                }

                this.renderGroupCallGrid(data.participants);
            });

            // Join Agora room
            await this.joinGroupAgoraChannel(channelName);
        } catch (e) {
            console.error("Start group call error:", e);
            this.showAlert('Error', 'Failed to start group call: ' + e.message);
        }
    };

    HamsterApp.prototype.listenForIncomingGroupCalls = function() {
        if (this.incomingGroupCallUnsub) this.incomingGroupCallUnsub();

        console.log("GC [Listener]: Initializing listenForIncomingGroupCalls. User UID:", this.user?.uid);

        const q = query(collection(db, 'groupCalls'), where('status', '==', 'active'));
        this.incomingGroupCallUnsub = onSnapshot(q, (snap) => {
            console.log("GC [Listener]: Received Firestore update. Active group calls count:", snap.size);
            
            // If we are actively in a group call session, ignore incoming listener updates!
            if (this.isGroupCallActive) {
                console.log("GC [Listener]: isGroupCallActive is TRUE. Ignoring update.");
                return;
            }

            // Find call where I am still "ringing"
            const callDoc = snap.docs.find(doc => {
                const data = doc.data();
                const myParticipant = data.participants?.[this.user.uid];
                console.log(`GC [Listener]: Checking call doc ${doc.id}. My status in participants map:`, myParticipant);
                return myParticipant && myParticipant.status === 'ringing';
            });

            if (!callDoc) {
                console.log("GC [Listener]: No active call found where my status is 'ringing'.");
                // If we were ringing but the call was ended or canceled
                if (this.currentGroupCallData && this.currentGroupCallData.participants?.[this.user.uid]?.status === 'ringing') {
                    console.log("GC [Listener]: My previous state was ringing, dismissing call overlay.");
                    this.hideGroupCallOverlay();
                    this.currentGroupCallData = null;
                }
                return;
            }

            const data = callDoc.data();
            data.id = callDoc.id;

            console.log("GC [Listener]: Found incoming group call! Doc ID:", data.id);

            // Avoid showing incoming multiple times for the same active screen
            if (this.currentGroupCallData && this.currentGroupCallData.id === data.id) {
                console.log("GC [Listener]: Incoming overlay already active for this call ID.");
                return;
            }

            this.currentGroupCallData = data;
            this.isGroupVideoCall = data.callType === 'video';

            console.log("GC [Listener]: Launching incoming call overlay.");
            this.playRingtone();
            this.showGroupCallOverlay(data.chatName, data.chatPhoto, 'incoming', this.lang === 'ar' ? 'مكالمة جماعية واردة...' : 'Incoming Group Call...');
        });
    };

    HamsterApp.prototype.answerGroupCall = async function() {
        if (!this.currentGroupCallData) return;

        try {
            this.isGroupCallActive = true;
            this.stopRingtone();
            this.showGroupCallOverlay(this.currentGroupCallData.chatName, this.currentGroupCallData.chatPhoto, 'active', this.lang === 'ar' ? 'جاري التوصيل...' : 'Connecting...');

            // Update status to joined in Firestore
            const callRef = doc(db, 'groupCalls', this.currentGroupCallData.id);
            await updateDoc(callRef, {
                [`participants.${this.user.uid}.status`]: 'joined',
                [`participants.${this.user.uid}.micMuted`]: false,
                [`participants.${this.user.uid}.camMuted`]: !this.isGroupVideoCall
            });

            // Start group call document active listener
            if (this.activeGroupCallListener) this.activeGroupCallListener();
            this.activeGroupCallListener = onSnapshot(callRef, (docSnap) => {
                if (!docSnap.exists()) {
                    this.leaveGroupCall(true);
                    return;
                }
                const data = docSnap.data();
                data.id = docSnap.id;
                this.currentGroupCallData = data;

                if (data.status === 'ended') {
                    this.leaveGroupCall(true);
                    return;
                }

                // Stop ringtone if someone else joined (just in case)
                const otherJoined = Object.entries(data.participants).some(([uid, p]) => uid !== this.user.uid && p.status === 'joined');
                if (otherJoined) {
                    this.stopRingtone();
                }

                this.renderGroupCallGrid(data.participants);
            });

            // Join Agora WebRTC
            await this.joinGroupAgoraChannel(this.currentGroupCallData.channelName);
            this.startGroupCallTimer();
        } catch (e) {
            console.error("Answer group call error:", e);
            this.leaveGroupCall();
        }
    };

    HamsterApp.prototype.rejectGroupCall = async function() {
        if (!this.currentGroupCallData) return;

        try {
            this.isGroupCallActive = false;
            const callId = this.currentGroupCallData.id;
            const callRef = doc(db, 'groupCalls', callId);
            await updateDoc(callRef, {
                [`participants.${this.user.uid}.status`]: 'rejected'
            });
            await this.checkGroupCallEnd(callId);
        } catch (e) {
            console.error("Reject group call error:", e);
        }

        this.hideGroupCallOverlay();
        this.currentGroupCallData = null;
    };

    HamsterApp.prototype.checkGroupCallEnd = async function(callId) {
        try {
            const callRef = doc(db, 'groupCalls', callId);
            const docSnap = await getDoc(callRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.status === 'ended') return;

                const activeParticipants = Object.values(data.participants).filter(p => p.status === 'joined');
                const ringingParticipants = Object.values(data.participants).filter(p => p.status === 'ringing');

                if (activeParticipants.length === 0 || (activeParticipants.length === 1 && ringingParticipants.length === 0)) {
                    await updateDoc(callRef, { status: 'ended' });
                }
            }
        } catch (e) {
            console.error("Error checking group call end:", e);
        }
    };


    HamsterApp.prototype.leaveGroupCall = async function(isRemote = false) {
        this.isGroupCallActive = false;
        if (!this.currentGroupCallData) {
            this.hideGroupCallOverlay();
            return;
        }

        const callId = this.currentGroupCallData.id;

        if (!isRemote) {
            try {
                const callRef = doc(db, 'groupCalls', callId);
                await updateDoc(callRef, {
                    [`participants.${this.user.uid}.status`]: 'left'
                });

                await this.checkGroupCallEnd(callId);
            } catch (e) {
                console.error("Error updating left state in Firestore:", e);
            }
        }

        await this.leaveGroupAgoraChannel();
        this.stopRingtone();
        this.hideGroupCallOverlay();

        if (this.activeGroupCallListener) {
            this.activeGroupCallListener();
            this.activeGroupCallListener = null;
        }

        this.currentGroupCallData = null;
        this.isGroupVideoCall = false;
        clearInterval(this.groupCallTimer);
    };

    HamsterApp.prototype.joinGroupAgoraChannel = async function(channelName) {
        if (!window.AgoraRTC) {
            console.error("Agora SDK not loaded");
            return;
        }

        if (!this.agoraClient) {
            this.agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        }

        this.agoraClient.removeAllListeners();
        
        // Listen for remote streams
        this.agoraClient.on("user-published", async (user, mediaType) => {
            await this.agoraClient.subscribe(user, mediaType);
            
            if (mediaType === "audio") {
                user.audioTrack.play();
            }
            
            if (mediaType === "video") {
                const videoContainer = document.getElementById(`gc-video-${user.uid}`);
                if (videoContainer) {
                    videoContainer.style.display = 'block';
                    videoContainer.innerHTML = '';
                    user.videoTrack.play(videoContainer);
                    
                    // Hide static avatar container since user is showing video
                    const tile = document.getElementById(`gc-tile-${user.uid}`);
                    if (tile) {
                        const avatarContainer = tile.querySelector('.gc-tile-avatar-container');
                        if (avatarContainer) avatarContainer.style.opacity = '0';
                    }
                }
            }
        });

        this.agoraClient.on("user-unpublished", (user, mediaType) => {
            if (mediaType === "video") {
                const videoContainer = document.getElementById(`gc-video-${user.uid}`);
                if (videoContainer) {
                    videoContainer.style.display = 'none';
                    videoContainer.innerHTML = '';
                }
                
                // Restore static avatar
                const tile = document.getElementById(`gc-tile-${user.uid}`);
                if (tile) {
                    const avatarContainer = tile.querySelector('.gc-tile-avatar-container');
                    if (avatarContainer) avatarContainer.style.opacity = '1';
                }
            }
        });

        // Active speaker volume tracker
        this.agoraClient.enableAudioVolumeIndicator();
        this.agoraClient.on("volume-indicator", volumes => {
            volumes.forEach(volumeInfo => {
                const uid = volumeInfo.uid;
                const volume = volumeInfo.level;
                const tile = document.getElementById(`gc-tile-${uid}`);
                if (tile) {
                    if (volume > 8) {
                        tile.classList.add('active-speaker');
                    } else {
                        tile.classList.remove('active-speaker');
                    }
                }
            });
        });

        try {
            // Join with string Firebase UID
            await this.agoraClient.join(this.agoraAppId, channelName, null, this.user.uid);

            this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            
            const muteBtn = document.getElementById('gc-mute-btn');
            const camBtn = document.getElementById('gc-cam-btn');
            
            muteBtn.classList.remove('active-off');
            muteBtn.innerHTML = '<i data-lucide="mic"></i>';
            camBtn.classList.remove('active-off');
            camBtn.innerHTML = '<i data-lucide="video"></i>';

            if (this.isGroupVideoCall) {
                this.localVideoTrack = await AgoraRTC.createCameraVideoTrack();
                await this.agoraClient.publish([this.localAudioTrack, this.localVideoTrack]);
                
                // Play local video track inside local participant tile
                const localVideoContainer = document.getElementById(`gc-video-${this.user.uid}`);
                if (localVideoContainer) {
                    localVideoContainer.style.display = 'block';
                    localVideoContainer.innerHTML = '';
                    this.localVideoTrack.play(localVideoContainer);
                    
                    const localTile = document.getElementById(`gc-tile-${this.user.uid}`);
                    if (localTile) {
                        const avatarContainer = localTile.querySelector('.gc-tile-avatar-container');
                        if (avatarContainer) avatarContainer.style.opacity = '0';
                    }
                }
            } else {
                await this.agoraClient.publish([this.localAudioTrack]);
                camBtn.classList.add('active-off');
                camBtn.innerHTML = '<i data-lucide="video-off"></i>';
            }

            if (window.lucide) lucide.createIcons();
            console.log("Successfully joined Agora Group Call");
        } catch (e) {
            console.error("Agora group channel join failed:", e);
            let friendlyError = e.message || 'Unknown error';
            if (e.name === 'NotAllowedError' || e.message?.includes("PERMISSION_DENIED")) {
                friendlyError = this.lang === 'ar' 
                    ? 'تم رفض إذن الوصول للميكروفون أو الكاميرا. يرجى تفعيل الصلاحيات من إعدادات المتصفح.' 
                    : 'Microphone or Camera permission denied. Please grant media access in your browser settings.';
            } else if (e.name === 'NotFoundError' || e.message?.includes("DEVICE_NOT_FOUND") || e.message?.includes("Requested device not found")) {
                friendlyError = this.lang === 'ar' 
                    ? 'لم يتم العثور على ميكروفون أو كاميرا متصلة بالجهاز! يرجى توصيل ميكروفون لإجراء المكالمة.' 
                    : 'No microphone or camera detected on this device! Please plug in a microphone to make the call.';
            } else if (e.name === 'NotReadableError') {
                friendlyError = this.lang === 'ar' 
                    ? 'الميكروفون أو الكاميرا قيد الاستخدام من تطبيق آخر حالياً.' 
                    : 'Microphone or camera is already in use by another app.';
            }
            
            this.showAlert(this.lang === 'ar' ? 'خطأ في الاتصال' : 'Call Error', friendlyError);
            this.leaveGroupCall();
        }
    };

    HamsterApp.prototype.leaveGroupAgoraChannel = async function() {
        if (this.localAudioTrack) {
            this.localAudioTrack.stop();
            this.localAudioTrack.close();
            this.localAudioTrack = null;
        }
        if (this.localVideoTrack) {
            this.localVideoTrack.stop();
            this.localVideoTrack.close();
            this.localVideoTrack = null;
        }
        if (this.agoraClient) {
            try {
                await this.agoraClient.leave();
            } catch (e) { console.error(e); }
        }
        
        const grid = document.getElementById('gc-participants-grid');
        if (grid) grid.innerHTML = '';
        console.log("Left Agora Group Call Room");
    };

    HamsterApp.prototype.toggleMuteGroupCall = async function() {
        if (this.localAudioTrack) {
            const isMuted = !this.localAudioTrack.muted;
            await this.localAudioTrack.setMuted(isMuted);
            
            const btn = document.getElementById('gc-mute-btn');
            if (isMuted) {
                btn.classList.add('active-off');
                btn.innerHTML = '<i data-lucide="mic-off"></i>';
            } else {
                btn.classList.remove('active-off');
                btn.innerHTML = '<i data-lucide="mic"></i>';
            }
            if (window.lucide) lucide.createIcons({ node: btn });

            // Propagate mute state to all remote participants via Firestore
            if (this.currentGroupCallData) {
                const callRef = doc(db, 'groupCalls', this.currentGroupCallData.id);
                updateDoc(callRef, {
                    [`participants.${this.user.uid}.micMuted`]: isMuted
                }).catch(e => console.error("Update micMuted err:", e));
            }
        }
    };

    HamsterApp.prototype.toggleCameraGroupCall = async function() {
        if (!this.agoraClient) return;

        const btn = document.getElementById('gc-cam-btn');
        const localVideoContainer = document.getElementById(`gc-video-${this.user.uid}`);
        const localTile = document.getElementById(`gc-tile-${this.user.uid}`);

        if (this.localVideoTrack) {
            // Disable camera
            this.localVideoTrack.stop();
            this.localVideoTrack.close();
            await this.agoraClient.unpublish([this.localVideoTrack]);
            this.localVideoTrack = null;
            
            if (localVideoContainer) {
                localVideoContainer.style.display = 'none';
                localVideoContainer.innerHTML = '';
            }
            if (localTile) {
                const avatarContainer = localTile.querySelector('.gc-tile-avatar-container');
                if (avatarContainer) avatarContainer.style.opacity = '1';
            }

            btn.classList.add('active-off');
            btn.innerHTML = '<i data-lucide="video-off"></i>';
            
            if (this.currentGroupCallData) {
                const callRef = doc(db, 'groupCalls', this.currentGroupCallData.id);
                updateDoc(callRef, {
                    [`participants.${this.user.uid}.camMuted`]: true
                }).catch(e => console.error("Update camMuted err:", e));
            }
        } else {
            // Enable camera
            try {
                this.localVideoTrack = await AgoraRTC.createCameraVideoTrack();
                await this.agoraClient.publish([this.localVideoTrack]);

                if (localVideoContainer) {
                    localVideoContainer.style.display = 'block';
                    localVideoContainer.innerHTML = '';
                    this.localVideoTrack.play(localVideoContainer);
                }
                if (localTile) {
                    const avatarContainer = localTile.querySelector('.gc-tile-avatar-container');
                    if (avatarContainer) avatarContainer.style.opacity = '0';
                }

                btn.classList.remove('active-off');
                btn.innerHTML = '<i data-lucide="video"></i>';

                if (this.currentGroupCallData) {
                    const callRef = doc(db, 'groupCalls', this.currentGroupCallData.id);
                    updateDoc(callRef, {
                        [`participants.${this.user.uid}.camMuted`]: false
                    }).catch(e => console.error("Update camMuted err:", e));
                }
            } catch (e) {
                console.error("Camera group toggle err:", e);
                this.showAlert('Error', this.lang === 'ar' ? 'تعذر تشغيل الكاميرا.' : 'Could not enable camera.');
            }
        }
        if (window.lucide) lucide.createIcons({ node: btn });
    };

    HamsterApp.prototype.renderGroupCallGrid = function(participants) {
        const grid = document.getElementById('gc-participants-grid');
        if (!grid) return;

        const activeTiles = [];

        Object.entries(participants).forEach(([uid, p]) => {
            if (p.status !== 'joined' && p.status !== 'ringing') {
                const existingTile = document.getElementById(`gc-tile-${uid}`);
                if (existingTile) existingTile.remove();
                return;
            }

            activeTiles.push(uid);

            let tile = document.getElementById(`gc-tile-${uid}`);
            if (!tile) {
                tile = document.createElement('div');
                tile.id = `gc-tile-${uid}`;
                tile.className = 'gc-tile';
                
                tile.innerHTML = `
                    <div id="gc-video-${uid}" class="gc-tile-video" style="display: none;"></div>
                    <div class="gc-tile-avatar-container">
                        <img class="gc-tile-avatar" src="${p.photo || 'assets/logo.jpg'}">
                        <span class="gc-tile-name">${uid === this.user.uid ? (this.lang === 'ar' ? 'أنت' : 'You') : p.name}</span>
                    </div>
                    <div class="gc-tile-badges">
                        <div id="gc-mic-muted-${uid}" class="gc-tile-badge mic-muted hidden"><i data-lucide="mic-off"></i></div>
                    </div>
                    <div id="gc-status-label-${uid}" class="gc-tile-status-label hidden"></div>
                `;
                grid.appendChild(tile);
            }

            // Sync mic muted badge
            const micBadge = document.getElementById(`gc-mic-muted-${uid}`);
            if (micBadge) {
                if (p.micMuted) {
                    micBadge.classList.remove('hidden');
                } else {
                    micBadge.classList.add('hidden');
                }
            }

            // Render status overlay labels
            const statusLabel = document.getElementById(`gc-status-label-${uid}`);
            if (statusLabel) {
                if (p.status === 'ringing') {
                    statusLabel.className = 'gc-tile-status-label ringing';
                    statusLabel.innerText = this.lang === 'ar' ? 'جاري الرنين...' : 'Ringing...';
                    statusLabel.classList.remove('hidden');
                } else if (p.status === 'joined') {
                    statusLabel.className = 'gc-tile-status-label joined';
                    statusLabel.innerText = this.lang === 'ar' ? 'انضم' : 'Joined';
                    statusLabel.classList.remove('hidden');
                    
                    setTimeout(() => {
                        if (statusLabel) statusLabel.classList.add('hidden');
                    }, 3000);
                } else {
                    statusLabel.classList.add('hidden');
                }
            }
        });

        // Cleanup stale elements
        const tiles = grid.querySelectorAll('.gc-tile');
        tiles.forEach(t => {
            const uid = t.id.replace('gc-tile-', '');
            if (!activeTiles.includes(uid)) {
                t.remove();
            }
        });

        // Set layout rules dynamically
        const tileCount = activeTiles.length;
        if (tileCount === 1) {
            grid.style.gridTemplateColumns = '1fr';
            grid.style.maxWidth = '500px';
        } else if (tileCount === 2) {
            grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
            grid.style.maxWidth = '900px';
        } else {
            grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
            grid.style.maxWidth = '1000px';
        }

        if (window.lucide) lucide.createIcons({ node: grid });
    };

    HamsterApp.prototype.showGroupCallOverlay = function(groupName, avatar, state, statusText) {
        document.getElementById('gc-group-name').innerText = groupName;
        document.getElementById('gc-group-avatar').src = avatar || 'assets/logo.jpg';
        document.getElementById('gc-status-text').innerText = statusText;

        const overlay = document.getElementById('group-call-overlay');
        overlay.classList.remove('hidden');

        const incomingUI = document.getElementById('gc-incoming-ui');
        const grid = document.getElementById('gc-participants-grid');
        const controls = document.getElementById('gc-controls');

        if (state === 'incoming') {
            incomingUI.classList.remove('hidden');
            grid.classList.add('hidden');
            controls.classList.add('hidden');

            document.getElementById('gc-incoming-name').innerText = groupName;
            document.getElementById('gc-incoming-avatar').src = avatar || 'assets/logo.jpg';
        } else {
            incomingUI.classList.add('hidden');
            grid.classList.remove('hidden');
            controls.classList.remove('hidden');
        }

        if (window.lucide) lucide.createIcons();
    };

    HamsterApp.prototype.hideGroupCallOverlay = function() {
        this.isGroupCallActive = false;
        const overlay = document.getElementById('group-call-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('minimized');
        }
        this.stopRingtone();
        clearInterval(this.groupCallTimer);
    };

    HamsterApp.prototype.toggleGroupCallMinimize = function() {
        const overlay = document.getElementById('group-call-overlay');
        if (!overlay) return;
        
        const isMinimized = overlay.classList.toggle('minimized');
        const btn = document.querySelector('.gc-minimize-btn i');
        if (btn) {
            btn.setAttribute('data-lucide', isMinimized ? 'maximize-2' : 'minimize-2');
            if (window.lucide) lucide.createIcons({ node: btn.parentElement });
        }
    };

    HamsterApp.prototype.startGroupCallTimer = function() {
        let seconds = 0;
        clearInterval(this.groupCallTimer);
        this.groupCallTimer = setInterval(() => {
            seconds++;
            const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
            const secs = (seconds % 60).toString().padStart(2, '0');
            const timerEl = document.getElementById('gc-timer');
            if (timerEl) timerEl.innerText = `${mins}:${secs}`;
        }, 1000);
    };
}

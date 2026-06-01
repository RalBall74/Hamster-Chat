import { db, doc, setDoc, updateDoc, addDoc, collection, serverTimestamp, deleteDoc } from './firebase-config.js';

export function extendMedia(HamsterApp) {
    HamsterApp.prototype.viewImage = function(src, canDownload = true) {
        const viewer = document.getElementById('image-viewer');
        const img = document.getElementById('full-view-image');
        const dlBtn = document.getElementById('download-img-btn');
        if (!viewer || !img) return;
        img.src = src;
        viewer.classList.remove('hidden');
        img.oncontextmenu = (e) => e.preventDefault();
        if (canDownload) {
            dlBtn.style.display = 'flex';
            dlBtn.onclick = () => this.downloadImage(src);
        } else {
            dlBtn.style.display = 'none';
        }
        if (window.lucide) lucide.createIcons();
    };

    HamsterApp.prototype.closeImageViewer = function() {
        const viewer = document.getElementById('image-viewer');
        if (viewer) viewer.classList.add('hidden');
    };

    HamsterApp.prototype.downloadImage = async function(url) {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `hamster-image-${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error("Download failed:", e);
            window.open(url, '_blank');
        }
    };

    

   

    HamsterApp.prototype._recState = null; // null | 'recording' | 'paused' | 'review'
    HamsterApp.prototype._recStartTime = 0;
    HamsterApp.prototype._recElapsed = 0;
    HamsterApp.prototype._recTimerInterval = null;
    HamsterApp.prototype._recAnalyser = null;
    HamsterApp.prototype._recAnimFrame = null;
    HamsterApp.prototype._recAudioCtx = null;
    HamsterApp.prototype._recReviewBlob = null;
    HamsterApp.prototype._recReviewAudio = null;

    HamsterApp.prototype.startRecording = async function() {
        if (this._recState) return; // Already recording

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return alert(this.lang === 'ar' ? 'المتصفح لا يدعم التسجيل الصوتي' : 'Browser does not support recording');
        }
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
            this._recordedMimeType = mimeType;
            this._recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = this._recAudioCtx.createMediaStreamSource(this.audioStream);
            this._recAnalyser = this._recAudioCtx.createAnalyser();
            this._recAnalyser.fftSize = 256;

            const effect = this.userData?.settings?.voiceEffect || 'none';
            let finalStream = this.audioStream;

            if (effect !== 'none') {
                const dest = this._recAudioCtx.createMediaStreamDestination();
                finalStream = dest.stream;
                let lastNode = source;

                if (effect === 'deep') {
                    // Deep monster growl: Low freq ring mod + Lowpass filter
                    const osc = this._recAudioCtx.createOscillator();
                    osc.type = 'sawtooth';
                    osc.frequency.value = 45;
                    const ringGain = this._recAudioCtx.createGain();
                    source.connect(ringGain);
                    osc.connect(ringGain.gain);
                    osc.start();

                    const filter = this._recAudioCtx.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = 600;
                    ringGain.connect(filter);
                    lastNode = filter;
                } else if (effect === 'thin') {
                    // High pitch alien/chipmunk: High freq ring mod + Highpass filter
                    const osc = this._recAudioCtx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.value = 700;
                    const ringGain = this._recAudioCtx.createGain();
                    source.connect(ringGain);
                    osc.connect(ringGain.gain);
                    osc.start();

                    const filter = this._recAudioCtx.createBiquadFilter();
                    filter.type = 'highpass';
                    filter.frequency.value = 800;
                    ringGain.connect(filter);
                    lastNode = filter;
                } else if (effect === 'distorted') {
                    // Evil radio transmission: Square ring mod + Heavy distortion
                    const osc = this._recAudioCtx.createOscillator();
                    osc.type = 'square';
                    osc.frequency.value = 120;
                    const ringGain = this._recAudioCtx.createGain();
                    source.connect(ringGain);
                    osc.connect(ringGain.gain);
                    osc.start();

                    const shaper = this._recAudioCtx.createWaveShaper();
                    const k = 400; // distortion amount
                    const n_samples = 44100;
                    const curve = new Float32Array(n_samples);
                    const deg = Math.PI / 180;
                    for (let i = 0; i < n_samples; ++i) {
                        const x = i * 2 / n_samples - 1;
                        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
                    }
                    shaper.curve = curve;
                    shaper.oversample = '4x';
                    
                    // Add a lowpass to reduce harsh high pitched noise from distortion
                    const filter = this._recAudioCtx.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = 3000;

                    ringGain.connect(shaper);
                    shaper.connect(filter);
                    lastNode = filter;
                }

                lastNode.connect(dest);
                lastNode.connect(this._recAnalyser);
            } else {
                source.connect(this._recAnalyser);
            }

            this.mediaRecorder = new MediaRecorder(finalStream, { mimeType });
            this.audioChunks = [];
            this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
            this.mediaRecorder.onstop = () => {}; // We handle it manually now
            this.mediaRecorder.start(100); // Get data every 100ms for smooth waveform

            this._recState = 'recording';
            this._recElapsed = 0;
            this._recStartTime = Date.now();

            this._showRecordingPanel();
            this._startRecTimer();
            this._drawLiveWaveform();
        } catch (e) {
            console.error(e);
            alert(this.lang === 'ar' ? 'فشل الوصول للميكروفون' : 'Mic access denied');
        }
    };

    HamsterApp.prototype._showRecordingPanel = function() {
        const inputArea = document.querySelector('.input-area');
        if (!inputArea) return;

        // Save original input HTML for restore
        if (!this._originalInputHTML) {
            this._originalInputHTML = inputArea.innerHTML;
        }

        const isAr = this.lang === 'ar';

        inputArea.innerHTML = `
            <div class="voice-rec-panel" id="voice-rec-panel">
                <button type="button" class="voice-rec-btn voice-rec-delete" onclick="app.cancelRecording()" title="${isAr ? 'إلغاء' : 'Cancel'}">
                    <i data-lucide="trash-2"></i>
                </button>
                <div class="voice-rec-center">
                    <div class="voice-rec-indicator" id="voice-rec-indicator">
                        <span class="voice-rec-dot"></span>
                        <span class="voice-rec-timer" id="voice-rec-timer">0:00</span>
                    </div>
                    <div class="voice-rec-waveform" id="voice-rec-waveform"></div>
                    <div class="voice-rec-slide-hint" id="voice-rec-slide-hint">
                        <i data-lucide="chevrons-left" style="width: 13px; height: 13px;"></i>
                        <span>${isAr ? 'اسحب للإلغاء' : 'Slide to cancel'}</span>
                    </div>
                </div>
                <button type="button" class="voice-rec-btn voice-rec-pause" id="voice-rec-pause-btn" onclick="app.togglePauseRecording()" title="${isAr ? 'إيقاف مؤقت' : 'Pause'}">
                    <i data-lucide="pause"></i>
                </button>
                <button type="button" class="voice-rec-send-btn" id="voice-rec-send-btn" onclick="app.stopAndReviewRecording()">
                    <i data-lucide="send" style="width: 18px;"></i>
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();

        // Add slide to cancel gesture
        this._setupSlideToCancel();
    };

    HamsterApp.prototype._showReviewPanel = function() {
        const inputArea = document.querySelector('.input-area');
        if (!inputArea) return;

        const isAr = this.lang === 'ar';

        inputArea.innerHTML = `
            <div class="voice-rec-panel voice-rec-review" id="voice-rec-panel">
                <button type="button" class="voice-rec-btn voice-rec-delete" onclick="app.cancelRecording()" title="${isAr ? 'حذف' : 'Delete'}">
                    <i data-lucide="trash-2"></i>
                </button>
                <div class="voice-rec-center">
                    <button type="button" class="voice-rec-review-play" id="voice-rec-review-play" onclick="app.toggleReviewPlayback()">
                        <i data-lucide="play" id="voice-rec-review-icon"></i>
                    </button>
                    <div class="voice-rec-review-waveform" id="voice-rec-review-waveform"></div>
                    <span class="voice-rec-timer" id="voice-rec-timer">0:00</span>
                </div>
                <button type="button" class="voice-rec-send-btn voice-rec-send-final" onclick="app.sendRecording()">
                    <i data-lucide="send" style="width: 18px;"></i>
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();

        // Generate waveform from recorded audio
        this._generateReviewWaveform();
    };

    HamsterApp.prototype._setupSlideToCancel = function() {
        // Attach gesture only on the waveform/center area to avoid intercepting button clicks
        const waveform = document.getElementById('voice-rec-waveform');
        const hint = document.getElementById('voice-rec-slide-hint');
        if (!waveform) return;

        let startX = 0;
        let isDragging = false;

        const onStart = (e) => {
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            isDragging = true;
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const currentX = e.touches ? e.touches[0].clientX : e.clientX;
            const diff = startX - currentX;
            if (diff > 80) {
                isDragging = false;
                this.cancelRecording();
            } else if (diff > 0 && hint) {
                hint.style.opacity = String(Math.max(0, 0.65 - diff / 80));
            }
        };

        const onEnd = () => {
            isDragging = false;
            if (hint) hint.style.opacity = '';
        };

        waveform.addEventListener('touchstart', onStart, { passive: true });
        waveform.addEventListener('touchmove', onMove, { passive: true });
        waveform.addEventListener('touchend', onEnd);
        waveform.addEventListener('mousedown', onStart);
        waveform.addEventListener('mousemove', onMove);
        waveform.addEventListener('mouseup', onEnd);
    };

    HamsterApp.prototype._startRecTimer = function() {
        // Reset accumulated elapsed when starting fresh
        this._recElapsed = 0;
        this._recTimerInterval = setInterval(() => {
            let total = this._recElapsed;
            // Add current session time only when actively recording
            if (this._recState === 'recording') {
                total += (Date.now() - this._recStartTime) / 1000;
            }
            const timer = document.getElementById('voice-rec-timer');
            if (timer) timer.textContent = this.formatTime(total);
        }, 100);
    };

    HamsterApp.prototype._drawLiveWaveform = function() {
        if (this._recState !== 'recording' && this._recState !== 'paused') return;

        const container = document.getElementById('voice-rec-waveform');
        if (!container || !this._recAnalyser) return;

        // BUG FIX: Cancel any existing rAF loop before starting a new one
        // (prevents double-loop when called again after resume)
        if (this._recAnimFrame) {
            cancelAnimationFrame(this._recAnimFrame);
            this._recAnimFrame = null;
        }

        const bufferLength = this._recAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Throttle: add a bar every ~80ms (~12 bars/sec) instead of every rAF frame
        let lastBarTime = 0;
        const BAR_INTERVAL_MS = 80;
        const MAX_BARS = 80;

        const draw = (timestamp) => {
            if (this._recState !== 'recording' && this._recState !== 'paused') return;

            this._recAnimFrame = requestAnimationFrame(draw);
            this._recAnalyser.getByteFrequencyData(dataArray);

            // Only add new bars when actively recording AND enough time has passed
            if (this._recState === 'recording' && timestamp - lastBarTime >= BAR_INTERVAL_MS) {
                lastBarTime = timestamp;

                // Get average volume for this slice
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
                const avg = sum / bufferLength;
                const normalizedHeight = Math.max(3, (avg / 255) * 26);

                const bar = document.createElement('div');
                bar.className = 'voice-rec-live-bar';
                bar.style.height = normalizedHeight + 'px';
                container.appendChild(bar);

                // Remove oldest bars to maintain sliding window
                while (container.children.length > MAX_BARS) {
                    container.removeChild(container.firstChild);
                }
            }
        };

        requestAnimationFrame(draw);
    };

    HamsterApp.prototype.togglePauseRecording = function() {
        if (!this.mediaRecorder) return;

        const pauseBtn = document.getElementById('voice-rec-pause-btn');
        const dot = document.querySelector('#voice-rec-indicator .voice-rec-dot');

        if (this._recState === 'recording') {
            // Save elapsed before pausing
            this._recElapsed += (Date.now() - this._recStartTime) / 1000;
            this.mediaRecorder.pause();
            this._recState = 'paused';

            if (pauseBtn) {
                pauseBtn.innerHTML = '<i data-lucide="mic"></i>';
                pauseBtn.classList.add('voice-rec-resume');
                pauseBtn.title = this.lang === 'ar' ? 'استئناف' : 'Resume';
            }
            if (dot) dot.classList.add('paused');
            if (window.lucide) lucide.createIcons();

        } else if (this._recState === 'paused') {
            this.mediaRecorder.resume();
            this._recState = 'recording';
            // Reset start time so timer continues from where it left off
            this._recStartTime = Date.now();

            if (pauseBtn) {
                pauseBtn.innerHTML = '<i data-lucide="pause"></i>';
                pauseBtn.classList.remove('voice-rec-resume');
                pauseBtn.title = this.lang === 'ar' ? 'إيقاف مؤقت' : 'Pause';
            }
            if (dot) dot.classList.remove('paused');
            if (window.lucide) lucide.createIcons();

            this._drawLiveWaveform();
        }
    };

    HamsterApp.prototype.cancelRecording = function() {
        // BUG FIX: Reset onstop BEFORE stopping to prevent any pending stale
        // onstop handler (set by stopAndReviewRecording) from firing after cancel.
        if (this.mediaRecorder) this.mediaRecorder.onstop = () => {};

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        if (this.audioStream) this.audioStream.getTracks().forEach(t => t.stop());
        if (this._recTimerInterval) { clearInterval(this._recTimerInterval); this._recTimerInterval = null; }
        if (this._recAnimFrame) { cancelAnimationFrame(this._recAnimFrame); this._recAnimFrame = null; }
        if (this._recAudioCtx) { this._recAudioCtx.close(); this._recAudioCtx = null; }
        if (this._recReviewAudio) {
            this._recReviewAudio.pause();
            // BUG FIX: Revoke the blob URL to prevent memory leak
            if (this._recReviewAudioUrl) { URL.revokeObjectURL(this._recReviewAudioUrl); this._recReviewAudioUrl = null; }
            this._recReviewAudio = null;
        }

        this._recState = null;
        this._recReviewBlob = null;
        this.audioChunks = [];
        this.mediaRecorder = null;
        this.audioStream = null;

        // Restore original input
        this._restoreInputArea();
    };

    HamsterApp.prototype.stopAndReviewRecording = function() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;

        // Calculate total elapsed including current un-paused session
        const totalElapsed = this._recElapsed + (
            this._recState === 'recording' ? (Date.now() - this._recStartTime) / 1000 : 0
        );

        // Stop timer and animation
        if (this._recTimerInterval) clearInterval(this._recTimerInterval);
        if (this._recAnimFrame) cancelAnimationFrame(this._recAnimFrame);
        if (this._recAudioCtx) { this._recAudioCtx.close(); this._recAudioCtx = null; }

        this.mediaRecorder.onstop = () => {
            if (this.audioChunks.length === 0) {
                this.cancelRecording();
                return;
            }
            this._recReviewBlob = new Blob(this.audioChunks, { type: this._recordedMimeType || 'audio/webm' });
            this._recState = 'review';
            this._recElapsed = totalElapsed;

            if (this.audioStream) this.audioStream.getTracks().forEach(t => t.stop());

            this._showReviewPanel();
            // Show approximate time until waveform decode gives exact duration
            const timer = document.getElementById('voice-rec-timer');
            if (timer) timer.textContent = this.formatTime(totalElapsed);
        };

        this.mediaRecorder.stop();
    };

    HamsterApp.prototype._generateReviewWaveform = function() {
        const container = document.getElementById('voice-rec-review-waveform');
        if (!container || !this._recReviewBlob) return;

        const reader = new FileReader();
        reader.readAsArrayBuffer(this._recReviewBlob);
        reader.onloadend = () => {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.decodeAudioData(reader.result.slice(0), (decoded) => {
                const rawData = decoded.getChannelData(0);
                const barCount = 60;
                // BUG FIX: guard blockSize against zero for very short recordings
                const blockSize = Math.max(1, Math.floor(rawData.length / barCount));
                let barsHTML = '';

                for (let i = 0; i < barCount; i++) {
                    let sum = 0;
                    const end = Math.min((i + 1) * blockSize, rawData.length);
                    for (let j = i * blockSize; j < end; j++) {
                        sum += Math.abs(rawData[j]);
                    }
                    const avg = sum / blockSize;
                    const h = Math.max(4, Math.min(28, avg * 80));
                    barsHTML += `<div class="voice-rec-review-bar" style="height: ${h}px;"></div>`;
                }

                container.innerHTML = `
                    <div class="voice-rec-review-bars">${barsHTML}</div>
                    <input type="range" class="voice-rec-review-slider" id="voice-rec-review-slider" value="0" min="0" max="100" oninput="app.seekReviewAudio(this.value)">
                `;

                // Update duration with the decoded exact value
                const timer = document.getElementById('voice-rec-timer');
                if (timer) timer.textContent = this.formatTime(decoded.duration);
                this._recElapsed = decoded.duration;

                audioCtx.close();
            }, (err) => {
                // Fallback: random bars (decoding failed)
                console.warn('Audio decode failed, using fallback waveform:', err);
                let barsHTML = '';
                for (let i = 0; i < 60; i++) {
                    const h = 4 + Math.random() * 20;
                    barsHTML += `<div class="voice-rec-review-bar" style="height: ${h}px;"></div>`;
                }
                container.innerHTML = `
                    <div class="voice-rec-review-bars">${barsHTML}</div>
                    <input type="range" class="voice-rec-review-slider" id="voice-rec-review-slider" value="0" min="0" max="100" oninput="app.seekReviewAudio(this.value)">
                `;
                // BUG FIX: close ctx on error path too
                audioCtx.close();
            });
        };
    };

    HamsterApp.prototype.toggleReviewPlayback = function() {
        if (!this._recReviewBlob) return;

        if (!this._recReviewAudio) {
            // BUG FIX: Store the blob URL so we can revoke it later (prevent memory leak)
            this._recReviewAudioUrl = URL.createObjectURL(this._recReviewBlob);
            this._recReviewAudio = new Audio(this._recReviewAudioUrl);

            this._recReviewAudio.ontimeupdate = () => {
                const slider = document.getElementById('voice-rec-review-slider');
                const timer = document.getElementById('voice-rec-timer');
                const bars = document.querySelectorAll('#voice-rec-review-waveform .voice-rec-review-bar');
                if (slider && this._recReviewAudio.duration) {
                    const progress = (this._recReviewAudio.currentTime / this._recReviewAudio.duration) * 100;
                    slider.value = progress;
                    const activeBars = Math.floor((progress / 100) * bars.length);
                    bars.forEach((bar, idx) => {
                        bar.classList.toggle('active', idx < activeBars);
                    });
                }
                if (timer) timer.textContent = this.formatTime(this._recReviewAudio.currentTime);
            };

            this._recReviewAudio.onended = () => {
                // BUG FIX: get icon fresh from DOM instead of stale closure variable
                const icon = document.getElementById('voice-rec-review-icon');
                if (icon) { icon.setAttribute('data-lucide', 'play'); lucide.createIcons(); }
                const timer = document.getElementById('voice-rec-timer');
                if (timer) timer.textContent = this.formatTime(this._recElapsed);
                const bars = document.querySelectorAll('#voice-rec-review-waveform .voice-rec-review-bar');
                bars.forEach(bar => bar.classList.remove('active'));
                const slider = document.getElementById('voice-rec-review-slider');
                if (slider) slider.value = 0;
            };
        }

        // BUG FIX: get icon fresh each call to avoid stale reference
        const icon = document.getElementById('voice-rec-review-icon');
        if (this._recReviewAudio.paused) {
            this._recReviewAudio.play();
            if (icon) { icon.setAttribute('data-lucide', 'pause'); lucide.createIcons(); }
        } else {
            this._recReviewAudio.pause();
            if (icon) { icon.setAttribute('data-lucide', 'play'); lucide.createIcons(); }
        }
    };

    HamsterApp.prototype.seekReviewAudio = function(value) {
        if (this._recReviewAudio && this._recReviewAudio.duration) {
            this._recReviewAudio.currentTime = (value / 100) * this._recReviewAudio.duration;
        }
    };

    HamsterApp.prototype.sendRecording = async function() {
        if (!this._recReviewBlob) return;

        // Stop review playback if playing
        if (this._recReviewAudio) {
            this._recReviewAudio.pause();
            // BUG FIX: Revoke blob URL before discarding
            if (this._recReviewAudioUrl) { URL.revokeObjectURL(this._recReviewAudioUrl); this._recReviewAudioUrl = null; }
            this._recReviewAudio = null;
        }

        const audioBlob = this._recReviewBlob;
        this._recState = null;
        this._recReviewBlob = null;
        this._restoreInputArea();

        // Convert to base64 and send
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
            const base64Audio = reader.result;
            if (this.activeChatId) {
                const chat = this.allChats.find(c => c.id === this.activeChatId);
                let preE2E = { audio: base64Audio };
                let e2eData = preE2E;
                if (chat && chat.type !== 'ai') {
                    e2eData = await this.encryptMessagePayload(chat, preE2E);
                }

                const payload = { senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent', ...e2eData };
                if (this.userData?.privacy?.destroyVoiceOnPlay) {
                    payload.destroyVoiceOnPlay = true;
                }
                if (this.replyToMsgId) payload.replyTo = this.replyToMsgId;
                const msgRef = await addDoc(collection(db, `chats/${this.activeChatId}/messages`), payload);
                const text = this.lang === 'ar' ? '🔒 وسائط مشفرة' : '🔒 Encrypted Media';
                await updateDoc(doc(db, 'chats', this.activeChatId), { updatedAt: serverTimestamp(), lastMessage: { text, senderId: this.user.uid, msgId: msgRef.id, ...e2eData }, ...this.getUnreadCountsUpdate(chat) });
                this.cancelReply();
                this.scrollToBottom();
            }
        };
    };

    // Keep backward compatibility - old stopRecording now sends immediately
    HamsterApp.prototype.stopRecording = function() {
        // This is now a no-op since we changed to tap-based recording
    };

    HamsterApp.prototype._restoreInputArea = function() {
        const inputArea = document.querySelector('.input-area');
        if (!inputArea || !this._originalInputHTML) return;
        inputArea.innerHTML = this._originalInputHTML;
        this._originalInputHTML = null;
        if (window.lucide) lucide.createIcons();

        // Re-bind form submit
        const chatId = this.activeChatId;
        const msgForm = document.getElementById('msg-form');
        if (msgForm && chatId) {
            msgForm.onsubmit = (e) => {
                e.preventDefault();
                this.handleSendMessage(chatId);
            };
        }

        // Re-bind paste handler
        const msgInput = document.getElementById('msg-input');
        if (msgInput && chatId) {
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
    };

    // Legacy handler - kept for compatibility
    HamsterApp.prototype.handleAudioUpload = async function() {
        // No longer used - sendRecording handles this
    };

    HamsterApp.prototype.toggleGifPicker = async function(chatId) {
        const container = document.getElementById('gif-picker-container');
        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            this.searchGiphy('', chatId);
        } else {
            container.classList.add('hidden');
        }
    };

    HamsterApp.prototype.searchGiphy = async function(queryText, chatId) {
        const apiKey = 'yLtVx79gZR2UkbElF8g8O8HSM8hSuzYp';
        const url = queryText 
            ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(queryText)}&limit=20`
            : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=20`;
        try {
            const res = await fetch(url);
            const json = await res.json();
            const grid = document.getElementById('gif-grid');
            if (!grid) return;
            grid.innerHTML = json.data.map(gif => {
                const url = gif.images.fixed_height_small.url;
                return `<img src="${url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 6px; cursor: pointer;" onclick="app.sendGif('${url}', '${chatId}')">`;
            }).join('');
        } catch (e) { console.error("Giphy Search Error", e); }
    };

    HamsterApp.prototype.sendGif = async function(gifUrl, chatId) {
        document.getElementById('gif-picker-container').classList.add('hidden');
        const searchInput = document.getElementById('gif-search');
        if(searchInput) searchInput.value = '';
        const chat = this.allChats.find(c => c.id === chatId);
        let preE2E = { gifUrl };
        let e2eData = preE2E;
        if (chat && chat.type !== 'ai') {
            e2eData = await this.encryptMessagePayload(chat, preE2E);
        }

        const payload = { chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent', ...e2eData };
        if (this.replyToMsgId) { payload.replyTo = this.replyToMsgId; this.clearReply(); }
        const msgRef = doc(collection(db, `chats/${chatId}/messages`));
        await setDoc(msgRef, payload);
        const chatRef = doc(db, 'chats', chatId);
        const text = this.lang === 'ar' ? '🔒 وسائط مشفرة' : '🔒 Encrypted Media';
        await setDoc(chatRef, { updatedAt: serverTimestamp(), lastMessage: { text, senderId: this.user.uid, ...e2eData }, ...this.getUnreadCountsUpdate(chat) }, { merge: true });
        this.scrollToBottom();
    };

    HamsterApp.prototype.toggleAudio = function(btn, msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const icon = document.getElementById(`icon-${msgId}`);
        // BUG FIX: null check — audio element may not exist if message was re-rendered
        if (!audio || !icon) return;

        if (audio.paused) {
            document.querySelectorAll('audio').forEach(a => {
                if (a.id.startsWith('audio-') && a.id !== `audio-${msgId}`) {
                    a.pause();
                    const otherId = a.id.replace('audio-', '');
                    const otherIcon = document.getElementById(`icon-${otherId}`);
                    if (otherIcon) otherIcon.setAttribute('data-lucide', 'play');
                }
            });
            audio.play();
            icon.setAttribute('data-lucide', 'pause');
        } else {
            audio.pause();
            icon.setAttribute('data-lucide', 'play');
        }
        lucide.createIcons();
    };

    HamsterApp.prototype.updateAudioProgress = function(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const slider = document.querySelector(`#player-${msgId} .wa-audio-slider`);
        const timeDisplay = document.getElementById(`dur-${msgId}`);
        const bars = document.querySelectorAll(`#player-${msgId} .wa-waveform-bar`);
        if (audio && slider) {
            const progress = (audio.currentTime / audio.duration) * 100;
            slider.value = progress || 0;
            const activeBarsCount = Math.floor((progress / 100) * bars.length);
            bars.forEach((bar, index) => {
                if (index < activeBarsCount) bar.classList.add('active');
                else bar.classList.remove('active');
            });
            timeDisplay.innerText = this.formatTime(audio.currentTime);
        }
    };

    HamsterApp.prototype.seekAudio = function(slider, msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        if (audio && audio.duration) audio.currentTime = (slider.value / 100) * audio.duration;
    };

    HamsterApp.prototype.resetAudioPlayer = async function(msgId) {
        const icon = document.getElementById(`icon-${msgId}`);
        const slider = document.querySelector(`#player-${msgId} .wa-audio-slider`);
        const bars = document.querySelectorAll(`#player-${msgId} .wa-waveform-bar`);
        if (icon) { icon.setAttribute('data-lucide', 'play'); if(window.lucide) lucide.createIcons(); }
        if (slider) slider.value = 0;
        bars.forEach(bar => bar.classList.remove('active'));

        // Handle auto-delete for "destroyVoiceOnPlay" setting
        const msg = this.currentMessages ? this.currentMessages[msgId] : null;
        if (msg && msg.destroyVoiceOnPlay && msg.senderId !== this.user.uid) {
            try {
                // Delete the message completely from Firestore silently
                await deleteDoc(doc(db, `chats/${this.activeChatId}/messages`, msgId));
            } catch (err) {
                console.error("Failed to auto-delete voice message", err);
            }
        }
    };

    HamsterApp.prototype.setAudioDuration = function(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const timeDisplay = document.getElementById(`dur-${msgId}`);
        if (!audio || !timeDisplay) return;
        if (audio.duration && isFinite(audio.duration) && audio.duration < 3600) {
            timeDisplay.innerText = this.formatTime(audio.duration);
            return;
        }
        try {
            const src = audio.src;
            if (!src) return;
            const decode = (buffer) => {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                // BUG FIX: close ctx on both success AND error to prevent AudioContext leak
                ctx.decodeAudioData(
                    buffer,
                    (decoded) => { timeDisplay.innerText = this.formatTime(decoded.duration); ctx.close(); },
                    (err) => { console.warn('setAudioDuration decode failed', err); ctx.close(); }
                );
            };
            if (src.startsWith('data:')) {
                const base64 = src.split(',')[1];
                const binaryStr = atob(base64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                decode(bytes.buffer);
            } else { fetch(src).then(r => r.arrayBuffer()).then(decode); }
        } catch (e) { console.error("Audio duration fallback failed", e); }
    };
}

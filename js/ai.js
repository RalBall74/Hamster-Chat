import {
    db, doc, setDoc, getDoc, serverTimestamp, updateDoc, collection
} from './firebase-config.js';

export function extendAI(HamsterApp) {
    HamsterApp.prototype.handleAIMessage = async function(chatId, text) {
        if (!text) return;

        const now = Date.now();
        const uid = this.user?.uid;
        if (!uid) return;

        // ── All limits stored server-side in Firestore (tamper-proof) ──
        const userRef = doc(db, 'users', uid);

        let userSnap;
        try {
            userSnap = await getDoc(userRef);
        } catch (e) {
            console.error('Failed to read AI limits:', e);
            // Fail open — still allow the message so the user isn't blocked on Firestore errors
        }

        const userData = userSnap?.data() || {};
        const limitsData = userData.aiLimits || {};

        // ── Rate limit 1: 5 messages per 5 minutes (general) ──
        const WINDOW_MS = 5 * 60 * 1000;
        const msgWindowStart = limitsData.msgWindowStart || 0;
        let msgCount = limitsData.msgCount || 0;

        if (now - msgWindowStart > WINDOW_MS) {
            // Window expired — reset
            msgCount = 0;
        }

        if (msgCount >= 5) {
            const remainingSec = Math.ceil((WINDOW_MS - (now - msgWindowStart)) / 1000);
            this.showAlert(
                this.lang === 'ar' ? 'الرجاء الانتظار' : 'Please wait',
                this.lang === 'ar'
                    ? `لقد وصلت للحد المسموح (5 رسائل كل 5 دقائق). انتظر ${remainingSec} ثانية.`
                    : `You have reached the limit (5 messages per 5 min). Wait ${remainingSec}s.`
            );
            return;
        }

        // ── Commit limit increments to Firestore atomically ──
        const newMsgWindowStart = (now - msgWindowStart > WINDOW_MS) ? now : msgWindowStart;
        const updatePayload = {
            'aiLimits.msgCount': msgCount + 1,
            'aiLimits.msgWindowStart': newMsgWindowStart,
        };

        // Save limits — don't await so we don't block the UX
        updateDoc(userRef, updatePayload).catch(e => {
            console.warn('Limit write failed via updateDoc, trying setDoc merge:', e);
            setDoc(userRef, { aiLimits: { msgCount: msgCount + 1, msgWindowStart: newMsgWindowStart } }, { merge: true });
        });

        // ── Proceed with message ──
        const input = document.getElementById('msg-input');
        if (input) input.value = '';
        document.getElementById('mention-dropdown')?.remove();

        const chatRef = doc(db, 'chats', chatId);

        // 1. Save User Message
        const msgRef = doc(collection(db, `chats/${chatId}/messages`));
        await setDoc(msgRef, {
            chatId,
            text,
            senderId: uid,
            createdAt: serverTimestamp(),
            status: 'read'
        });

        // 2. Scroll to bottom
        setTimeout(() => this.scrollToBottom(), 100);

        // 3. Show AI Typing State
        await setDoc(chatRef, {
            memberIds: [uid, 'hamster_ai_bot'],
            typing: { 'hamster_ai_bot': true }
        }, { merge: true });

        try {
            const aiReply = await this.fetchGeminiReply(text);
            const aiMsgRef = doc(collection(db, `chats/${chatId}/messages`));

            // 4. Setup initial doc with placeholder
            await setDoc(aiMsgRef, {
                chatId, text: '...', senderId: 'hamster_ai_bot', createdAt: serverTimestamp(), status: 'read'
            });

            // 5. Stream words to Firestore for a real premium typing effect
            const words = aiReply.split(' ');
            let currentText = '';
            const chunkSize = words.length > 50 ? 3 : 1;

            for (let i = 0; i < words.length; i++) {
                currentText += (i === 0 ? '' : ' ') + words[i];
                if (i % chunkSize === 0 || i === words.length - 1) {
                    await updateDoc(aiMsgRef, { text: currentText });
                    await new Promise(r => setTimeout(r, 80));
                }
            }

            // Update chat metadata
            await setDoc(chatRef, {
                lastMessage: { text: aiReply, senderId: 'hamster_ai_bot' },
                updatedAt: serverTimestamp()
            }, { merge: true });

        } catch (err) {
            console.error('[Hamster AI]', err);
            // Show a friendly message in the chat bubble — never expose raw API errors
            try {
                const errMsg = this.lang === 'ar'
                    ? 'حصل خطأ، حاول بعد قليل 🐹'
                    : 'Something went wrong, please try again in a moment 🐹';
                const errMsgRef = doc(collection(db, `chats/${chatId}/messages`));
                await setDoc(errMsgRef, {
                    chatId, text: errMsg, senderId: 'hamster_ai_bot',
                    createdAt: serverTimestamp(), status: 'read'
                });
                await setDoc(chatRef, {
                    lastMessage: { text: errMsg, senderId: 'hamster_ai_bot' },
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } catch (_) { /* silently ignore */ }
        } finally {
            await setDoc(chatRef, { typing: { 'hamster_ai_bot': false } }, { merge: true });
        }
    };

    HamsterApp.prototype.fetchGeminiReply = async function(promptStr) {
        // Replace this URL with your actual Vercel deployment URL
        const backendUrl = 'https://hamster-chat.vercel.app/api/gemini';
        
        const res = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptStr })
        });

        const data = await res.json();

        if (!res.ok || data.error) {
            // Log internally only — never expose to the user
            console.error('[Hamster AI API]', res.status, data.error || data);
            throw new Error('API_ERROR');
        }

        if (!data.reply) {
            console.warn('[Hamster AI] Empty reply from server');
            throw new Error('EMPTY_REPLY');
        }

        return data.reply;
    };

    HamsterApp.prototype.markdownToHTML = function(text) {
        let html = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: inherit; text-decoration: underline;">$1</a>') // Markdown Links
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\n\s*\*\s(.*?)/g, '<br>• $1') // Lists
            .replace(/`(.*?)`/g, '<code style="background: rgba(0,0,0,0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>') // Inline Code
            .replace(/\n/g, '<br>');
        
        return this.linkify(html);
    };
}

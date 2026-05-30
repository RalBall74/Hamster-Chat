import {
    db, doc, setDoc, serverTimestamp, updateDoc, collection
} from './firebase-config.js';

export function extendAI(HamsterApp) {
    HamsterApp.prototype.handleAIMessage = async function(chatId, text) {
        if (!text) return;

        const now = Date.now();

        // ── Rate limit 1: 5 messages per 5 minutes (general) ──
        let aiUsage = JSON.parse(localStorage.getItem('hamster_ai_usage') || '{"count": 0, "firstMsgTime": 0}');
        if (now - aiUsage.firstMsgTime > 5 * 60 * 1000) {
            aiUsage = { count: 0, firstMsgTime: now };
        }
        if (aiUsage.count >= 5) {
            this.showAlert(
                this.lang === 'ar' ? 'الرجاء الانتظار' : 'Please wait',
                this.lang === 'ar' ? 'لقد وصلت للحد المسموح (5 رسائل كل 5 دقائق). يرجى الانتظار لتوفير الموارد.' : 'You have reached the limit (5 messages per 5 minutes). Please wait to save resources.'
            );
            return;
        }

        // ── Rate limit 2: 5 image requests per day ──
        const isImageRequest = /(صورة|ارسم|رسم|رسملي|صوّر|generate.*image|draw|create.*image|image of|picture of)/i.test(text);
        if (isImageRequest) {
            const todayStr = new Date().toDateString();
            let imgUsage = JSON.parse(localStorage.getItem('hamster_ai_image_usage') || '{"count": 0, "date": ""}');
            if (imgUsage.date !== todayStr) {
                imgUsage = { count: 0, date: todayStr };
            }
            if (imgUsage.count >= 5) {
                this.showAlert(
                    this.lang === 'ar' ? 'تجاوزت الحد اليومي' : 'Daily Limit Reached',
                    this.lang === 'ar' ? 'لقد استخدمت 5 صور اليوم. يمكنك طلب المزيد غداً 🐹' : 'You have used your 5 daily image generations. Come back tomorrow! 🐹'
                );
                return;
            }
            imgUsage.count++;
            localStorage.setItem('hamster_ai_image_usage', JSON.stringify(imgUsage));
        }

        const input = document.getElementById('msg-input');
        if (input) input.value = '';
        
        aiUsage.count++;
        localStorage.setItem('hamster_ai_usage', JSON.stringify(aiUsage));
        document.getElementById('mention-dropdown')?.remove();

        const chatRef = doc(db, 'chats', chatId);
        
        // 1. Save User Message
        const msgRef = doc(collection(db, `chats/${chatId}/messages`));
        await setDoc(msgRef, {
            chatId,
            text,
            senderId: this.user.uid,
            createdAt: serverTimestamp(),
            status: 'read'
        });

        // 2. Scroll to bottom
        setTimeout(() => this.scrollToBottom(), 100);

        // 3. Show AI Typing State
        await setDoc(chatRef, {
            memberIds: [this.user.uid, 'hamster_ai_bot'],
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
            const chunkSize = words.length > 50 ? 3 : 1; // Faster for long texts

            for (let i = 0; i < words.length; i++) {
                currentText += (i === 0 ? '' : ' ') + words[i];
                
                // Update every chunk of words
                if (i % chunkSize === 0 || i === words.length - 1) {
                    await updateDoc(aiMsgRef, { text: currentText });
                    await new Promise(r => setTimeout(r, 80)); // 80ms delay per chunk
                }
            }

            // Update chat metadata
            await setDoc(chatRef, {
                lastMessage: { text: aiReply, senderId: 'hamster_ai_bot' },
                updatedAt: serverTimestamp()
            }, { merge: true });

        } catch (err) {
            console.error(err);
            this.showAlert('AI Error', this.lang === 'ar' ? 'فشل الهامستر في الرد. تأكد من اتصالك بالإنترنت.' : 'Hamster failed to reply. Check your connection.');
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
        console.log("Hamster AI Response:", data);

        if (!res.ok || data.error) {
            return `API Error: ${data.error || 'Unknown error'}`;
        }

        return data.reply || 'No response from Hamster AI.';
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

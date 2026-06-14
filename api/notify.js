export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'OPTIONS') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const allowedOrigins = [
        'https://ralball74.github.io',
        'https://hamster-chat.vercel.app',
        'http://127.0.0.1:5500'
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { recipientIds, senderName, senderAvatar, chatName, lang } = req.body;

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const ONESIGNAL_APP_ID = "46020686-56fa-4902-a627-a5225a65490d";
    const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

    if (!ONESIGNAL_REST_API_KEY) {
        return res.status(500).json({ error: 'OneSignal API key not configured on server' });
    }

    let text = chatName ? `رسالة جديدة في ${chatName}` : `رسالة جديدة من ${senderName || 'مستخدم'}`;

    try {
        const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                include_aliases: {
                    external_id: recipientIds
                },
                target_channel: "push",
                headings: { en: "Hamster Chat", ar: "هامستر شات" },
                contents: { en: text, ar: text },
                chrome_web_badge: "https://hamster-chat.vercel.app/assets/badge.png",
                chrome_web_icon: senderAvatar || "https://hamster-chat.vercel.app/assets/logo.jpg",
                large_icon: senderAvatar || "https://hamster-chat.vercel.app/assets/logo.jpg",
                priority: 10,
                android_visibility: 1,
                web_push_topic: "new_message"
            })
        });

        const data = await response.json();
        
        if (data.errors) {
            console.warn("OneSignal Warning:", data.errors);
            return res.status(200).json({ success: false, ignored: true, error: data.errors });
        }

        return res.json({ success: true, data });
    } catch (error) {
        console.error('OneSignal Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

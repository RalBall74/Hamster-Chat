export default async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'OPTIONS') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const allowedOrigins = [
        'https://ralball74.github.io', // GitHub Pages base domain
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

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const systemPrompt = `أنت هو (هامستر)، المساعد الذكي والرفيق الرسمي والذراع التقني لمستخدمي تطبيق "هامستر شات".
شخصيتك:
- ذكي، لبق، وفخور بعملك.
- المطور هو "البشمهندس عاصم أبو النصر" (نادِه بالبشمهندس، ولكن لا تكرر اللقب كثيراً ليكون الكلام طبيعياً).
- عاصم عمره 15 عاماً وهو "ملك البرمجة".
- هدفك الأساسي: خدمة المستخدمين بالرد على أسئلتهم بذكاء وبطريقة ودودة بالعامية المصرية.او الانجليزية حسب لغة المستخدم

عن التطبيق (Hamster Chat):
- تصميم فخم (Glassmorphism / Dark Mode).
- ميزات قوية (مكالمات، ستوري، أمان فائق).
- تكنولوجيا: Firebase و JavaScript.

مشاريع أخرى للبشمهندس عاصم:
- "قراني": https://ralball74.github.io/qurany.assem/ (موقع اسلامي متكامل)
- "متجر تدفق": https://ralball74.github.io/TadfuqStore/ (موقع تطبيقات تدفق)

تعليمات الحوار الهامة:
- كن مختصراً جداً ولا تحشو كلاماً بدون فائدة.
- ممنوع تماماً استخدام أكواد HTML.
- ممنوع استخدام روابط ماركداون [اسم](رابط)، فقط اكتب الرابط الصريح.
- لا تكرر لقب المطور في كل سطر، ذكره مرة واحدة يكفي.
- كن طبيعياً جداً في ردودك وابعد عن الأسلوب الروبوتي الجاف.
- لا تذكر أنك Gemini أبداً.
- هام جداً: إذا طلب منك المستخدم توليد، إنشاء، رسم، أو تصميم صورة، قم بالرد برابط مباشر لتوليد الصورة عبر خدمة Pollinations هكذا: https://image.pollinations.ai/prompt/وصف%20الصورة%20باللغة%20الانجليزية%20بدون%20مسافات (اجعل الوصف باللغة الإنجليزية حصراً واستخدم %20 بدلاً من المسافات). يمكنك كتابة تعليق قصير לפני الرابط، ولكن **ممنوع منعاً باتاً** استخدام كلمة "رابط" أو "لينك"، فقط قل "إليك الصورة التي طلبتها:" أو شيء مشابه.

السؤال هو: ${prompt}`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }]
                })
            }
        );

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ error: data.error.message });
        }

        if (data.candidates?.[0]?.finishReason === 'SAFETY') {
            return res.json({ reply: 'عذراً، تم حجب الرد بسبب معايير السلامة.' });
        }

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
            || 'No response from Hamster AI.';

        return res.json({ reply });

    } catch (error) {
        console.error('Gemini API error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// ========== فحص التحميل المزدوج ==========
if (window.facebookExtractorLoaded) {
    console.warn('⚠️ Facebook Extractor محمل مسبقاً، تخطي التحميل المزدوج');
}else{
window.facebookExtractorLoaded = true;

// ========== إعدادات الاستخراج ==========
const EXTRACTION_SETTINGS = {
    SCROLL_TIMES: 20,
    SCROLL_DELAY: 3000,
    MAX_POSTS: 100
};

let extractionActive = false;
let extractedPosts = [];
let scrollInterval;
let scrollCount = 0;

// ========== تهيئة المحتوى ==========
console.log('🚀 Facebook Posts Extractor loaded successfully');

// إرسال إشعار بأن content script جاهز
chrome.runtime.sendMessage({
    action: 'contentScriptReady',
    message: '✅ محرك الاستخراج جاهز للعمل'
});

// ========== نظام معالجة الرسائل ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📩 content script استلم:', request.action);

    // إرسال رد فوري أولاً
    sendResponse({ received: true });

    // معالجة الطلب
    handleMessage(request).then(result => {
        if (result && request.needResponse) {
            chrome.runtime.sendMessage(result);
        }
    }).catch(error => {
        console.error('❌ خطأ في معالجة الرسالة:', error);
        chrome.runtime.sendMessage({
            action: 'updateStatus',
            message: `❌ خطأ: ${error.message}`,
            type: 'error'
        });
    });

    return true; // إبقاء القناة مفتوحة للردود غير المتزامنة
});

async function handleMessage(request) {
    switch (request.action) {
        case 'ping':
            return { success: true, message: 'متصل وجاهز' };

        case 'startExtraction':
            await startExtraction();
            return { success: true, message: 'بدأ الاستخراج' };

        case 'stopExtraction':
            stopExtraction();
            return { success: true, message: 'توقف الاستخراج' };

        case 'downloadCSV':
            downloadCSV();
            return { success: true, message: 'بدأ التنزيل' };

        case 'getStats':
            return {
                action: 'currentStats',
                stats: {
                    totalPosts: extractedPosts.length,
                    totalComments: extractedPosts.reduce((sum, post) => sum + post.comments, 0),
                    totalLikes: extractedPosts.reduce((sum, post) => sum + post.likes, 0),
                    totalShares: extractedPosts.reduce((sum, post) => sum + post.shares, 0)
                }
            };

        default:
            throw new Error(`إجراء غير معروف: ${request.action}`);
    }
}

// ========== دوال الاستخراج الرئيسية ==========
async function startExtraction() {
    if (extractionActive) {
        sendStatus('⚠️ الاستخراج يعمل بالفعل', 'warning');
        return;
    }

    extractionActive = true;
    extractedPosts = [];
    scrollCount = 0;

    sendStatus('🚀 بدء استخراج المنشورات...', 'info');
    sendProgress(0);

    // بدء التمرير التلقائي
    startAutoScroll();
}

function stopExtraction() {
    if (!extractionActive) return;

    extractionActive = false;
    if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
    }

    sendStatus(`⏹️ توقف الاستخراج - تم جمع ${extractedPosts.length} منشور`, 'warning');
    sendProgress(0);
}

function startAutoScroll() {
    scrollInterval = setInterval(async () => {
        if (!extractionActive || scrollCount >= EXTRACTION_SETTINGS.SCROLL_TIMES) {
            if (extractionActive) {
                extractionComplete();
            }
            return;
        }

        // التمرير لأسفل
        window.scrollBy(0, window.innerHeight * 2);
        scrollCount++;

        // تحديث التقدم
        const progress = (scrollCount / EXTRACTION_SETTINGS.SCROLL_TIMES) * 100;
        sendProgress(progress);

        // استخراج المنشورات
        await extractAndProcessPosts();

        sendStatus(`↕️ التمريرة ${scrollCount}/${EXTRACTION_SETTINGS.SCROLL_TIMES} - ${extractedPosts.length} منشور`);

        // إيقاف إذا وصلنا للحد الأقصى
        if (extractedPosts.length >= EXTRACTION_SETTINGS.MAX_POSTS) {
            extractionComplete();
        }

    }, EXTRACTION_SETTINGS.SCROLL_DELAY);
}

async function extractAndProcessPosts() {
    try {
        const newPosts = extractPostsFromFeed();
        const validPosts = validatePosts(newPosts);

        if (validPosts.length > 0) {
            // تجنب التكرارات
            const uniquePosts = validPosts.filter(newPost =>
                !extractedPosts.some(existingPost => existingPost.postId === newPost.postId)
            );

            extractedPosts = [...extractedPosts, ...uniquePosts];
            updateStats();

            // إرسال عينة من المنشور الجديد
            if (uniquePosts.length > 0) {
                console.log('📄 منشورات جديدة:', uniquePosts.length);

                uniquePosts.forEach((post, index) => {
                    console.log(`   ${index + 1}. ${post.author}: "${post.text.substring(0, 50)}..."`);
                });
            }
        }
    } catch (error) {
        console.error('❌ خطأ في استخراج المنشورات:', error);
        sendStatus('❌ خطأ في استخراج المنشورات', 'error');
    }
}

function extractionComplete() {
    extractionActive = false;
    if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
    }

    sendStatus(`✅ اكتمل الاستخراج! تم جمع ${extractedPosts.length} منشور`, 'success');
    sendProgress(100);

    chrome.runtime.sendMessage({
        action: 'extractionComplete',
        postCount: extractedPosts.length
    });
}

// ========== دوال المساعدة ==========
function sendStatus(message, type = 'info') {
    chrome.runtime.sendMessage({
        action: 'updateStatus',
        message: message,
        type: type
    });
}

function sendProgress(percentage) {
    chrome.runtime.sendMessage({
        action: 'updateProgress',
        percentage: Math.min(100, Math.max(0, percentage))
    });
}

function updateStats() {
    const stats = {
        totalPosts: extractedPosts.length,
        totalComments: extractedPosts.reduce((sum, post) => sum + post.comments, 0),
        totalLikes: extractedPosts.reduce((sum, post) => sum + post.likes, 0),
        totalShares: extractedPosts.reduce((sum, post) => sum + post.shares, 0)
    };

    chrome.runtime.sendMessage({
        action: 'updateStats',
        stats: stats
    });
}

// ========== دوال الاستخراج الأساسية ==========
function extractPostsFromFeed() {
    try {
        const posts = [];

        // محددات المنشورات المحسنة
        const selectors = [
            'div[role="article"]',
            'div[data-pagelet*="Feed"]',
            'div[class*="story"]',
            'div[data-ad-preview="message"]',
            '[data-pagelet*="MainFeed"] > div > div'
        ];

        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                try {
                    const post = extractPostData(el);
                    if (post) {
                        posts.push(post);
                    }
                } catch (e) {
                    // تجاهل الأخطاء في المنشورات الفردية
                }
            });
        });

        return posts;
    } catch (error) {
        console.error('❌ خطأ في extractPostsFromFeed:', error);
        return [];
    }
}

function extractPostData(element) {
    try {
        // 🔥 استخراج الرابط والـ PostId
        let postUrl = 'غير معروف';
        let postId = 'غير معروف';

        // البحث عن روابط المنشورات
        const postLinkSelectors = [
            'a[href*="/posts/"]',
            'a[href*="/story.php"]',
            'a[href*="/photo.php"]',
            'a[href*="/video.php"]',
            'a[aria-label*="Post"]',
            'a[role="link"][href*="facebook.com"]',
            'a[data-testid*="post_link"]',
            'a[href*="/permalink.php"]'
        ];

        for (const selector of postLinkSelectors) {
            const linkEl = element.querySelector(selector);
            if (linkEl?.href) {
                const url = linkEl.href;

                // تصفية الروابط غير المرغوب فيها
                if (!url.includes('/friends/') &&
                    !url.includes('/groups/') &&
                    !url.includes('/events/') &&
                    !url.includes('/marketplace/') &&
                    !url.includes('/watch/') &&
                    !url.includes('/messages/') &&
                    !url.includes('/games/')) {

                    postUrl = url;

                    // استخراج PostId من الرابط
                    try {
                        const urlObj = new URL(url);

                        if (urlObj.pathname.includes('/posts/')) {
                            const match = urlObj.pathname.match(/\/posts\/([^\/?]+)/);
                            if (match) postId = match[1];
                        } else if (urlObj.pathname.includes('/story.php')) {
                            const storyFbid = urlObj.searchParams.get('story_fbid');
                            if (storyFbid) postId = storyFbid;
                        } else if (urlObj.pathname.includes('/photo.php')) {
                            const fbid = urlObj.searchParams.get('fbid');
                            if (fbid) postId = fbid;
                        } else if (urlObj.pathname.includes('/video.php')) {
                            const v = urlObj.searchParams.get('v');
                            if (v) postId = v;
                        } else if (urlObj.pathname.includes('/permalink.php')) {
                            const storyFbid = urlObj.searchParams.get('story_fbid');
                            if (storyFbid) postId = storyFbid;
                        }

                    } catch (e) {
                        console.log('خطأ في parsing الرابط');
                    }

                    break;
                }
            }
        }

        // 🔥 استخراج المؤلف
        let author = 'غير معروف';
        const authorSelectors = [
            'a[role="link"][tabindex="0"] span',
            'span[dir="auto"] a',
            'h3 a',
            'a[data-testid*="post_actor"]',
            'a[href*="/"] span:first-child'
        ];

        for (const selector of authorSelectors) {
            const authorEl = element.querySelector(selector);
            if (authorEl?.textContent?.trim()) {
                const authorText = authorEl.textContent.trim();
                if (authorText.length > 1 &&
                    !authorText.includes('·') &&
                    !authorText.includes('Shared') &&
                    !authorText.includes('مشاركة') &&
                    !['Like', 'Comment', 'Share', 'تعليق', 'إعجاب', 'مشاركة', 'Sponsored', 'مُموّل'].includes(authorText)) {
                    author = authorText;
                    break;
                }
            }
        }

        // 🔥 استخراج النص
        const textSelectors = [
            'div[dir="auto"]',
            'div[data-ad-comet-preview="message"]',
            'div[class*="userContent"]',
            'span[class*="message"]'
        ];

        let text = '';
        for (const selector of textSelectors) {
            const textEls = element.querySelectorAll(selector);
            if (textEls.length > 0) {
                const texts = Array.from(textEls)
                    .map(el => el.textContent?.trim() || '')
                    .filter(t => t.length > 10 &&
                        !t.includes('See Translation') &&
                        !t.includes('عرض الترجمة'));

                if (texts.length > 0) {
                    const longestText = texts.sort((a, b) => b.length - a.length)[0];
                    if (longestText && longestText.length > text.length) {
                        text = longestText;
                    }
                }
            }
        }

        if (!text || text.length < 5) {
            text = element.textContent?.trim() || '';
        }

        // 🔥 تصفية المحتوى غير المرغوب
        if (!text || text.length < 15 ||
            text.includes('Sponsored') ||
            text.includes('مُموّل') ||
            element.querySelector('[aria-label*="Sponsored"]') ||
            element.querySelector('[data-testid*="sponsored"]')) {
            return null;
        }

        // إذا لم نجد رابط، نستخدم بيانات المؤلف والنص لإنشاء معرف فريد
        if (postId === 'غير معروف') {
            const uniqueContent = author + text.substring(0, 30);
            postId = `feed_${btoa(uniqueContent).substring(0, 20)}_${Date.now()}`;
        }

        // 🔥 طرق بديلة لاستخراج PostId
        if (postId === 'غير معروف') {
            const dataAttrs = ['data-ft', 'data-store', 'data-gt'];
            for (const attr of dataAttrs) {
                const dataValue = element.getAttribute(attr);
                if (dataValue) {
                    try {
                        const data = JSON.parse(dataValue);
                        if (data.top_level_post_id) postId = data.top_level_post_id;
                        else if (data.content_owner_id_new) postId = data.content_owner_id_new;
                        else if (data.post_id) postId = data.post_id;
                        if (postId !== 'غير معروف') break;
                    } catch (e) {
                        const idMatch = dataValue.match(/"post_id":"(\d+)"/);
                        if (idMatch) postId = idMatch[1];
                    }
                }
            }
        }

        // 🔥 إنشاء PostId فريد إذا فشلت جميع المحاولات
        if (postId === 'غير معروف') {
            const textContent = element.textContent || '';
            const textHash = textContent.substring(0, 50).replace(/\s+/g, '').substring(0, 15);
            postId = `feed_${Date.now()}_${textHash}`;
        }

        // 🔥 استخراج الوقت
        let time = 'غير معروف';
        const timeSelectors = [
            'span[class*="timestamp"]',
            'abbr',
            '[data-utime]',
            'a[class*="timestamp"]',
            'span[aria-label*="hr"]',
            'span[aria-label*="min"]',
            'span[aria-label*="day"]',
            'span[aria-label*="week"]',
            'span[aria-label*="month"]',
            'span[aria-label*="year"]',
            'span[dir="auto"] span',
            'span[class*="time"]'
        ];

        for (const selector of timeSelectors) {
            const timeEl = element.querySelector(selector);
            if (timeEl) {
                // المحاولة الأولى: من data-utime
                const utime = timeEl.getAttribute('data-utime');
                if (utime) {
                    try {
                        const postDate = new Date(parseInt(utime) * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    } catch (e) { }
                }

                // المحاولة الثانية: من aria-label
                const ariaLabel = timeEl.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.trim()) {
                    time = ariaLabel.trim();
                    break;
                }

                // المحاولة الثالثة: من النص
                if (timeEl.textContent?.trim()) {
                    const timeText = timeEl.textContent.trim();
                    const now = new Date();

                    if (timeText.match(/^(\d+)\s*(s|sec|ثانية?)$/i)) {
                        const seconds = parseInt(timeText.match(/(\d+)/)[1]);
                        const postDate = new Date(now.getTime() - seconds * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    }
                    else if (timeText.match(/^(\d+)\s*(m|min|دقيقة?)$/i)) {
                        const minutes = parseInt(timeText.match(/(\d+)/)[1]);
                        const postDate = new Date(now.getTime() - minutes * 60 * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    }
                    else if (timeText.match(/^(\d+)\s*(h|hr|ساعة?)$/i)) {
                        const hours = parseInt(timeText.match(/(\d+)/)[1]);
                        const postDate = new Date(now.getTime() - hours * 60 * 60 * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    }
                    else if (timeText.match(/^(\d+)\s*(d|يوم?)$/i)) {
                        const days = parseInt(timeText.match(/(\d+)/)[1]);
                        const postDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    }
                    else if (timeText.match(/^(\d+)\s*(w|أسبوع?)$/i)) {
                        const weeks = parseInt(timeText.match(/(\d+)/)[1]);
                        const postDate = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    }
                    else if (timeText.match(/^(\d+)\s*(mo|month|شهر?)$/i)) {
                        const months = parseInt(timeText.match(/(\d+)/)[1]);
                        const postDate = new Date(now.getTime() - months * 30 * 24 * 60 * 60 * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    }
                    else if (timeText.match(/^(\d+)\s*(y|year|سنة?)$/i)) {
                        const years = parseInt(timeText.match(/(\d+)/)[1]);
                        const postDate = new Date(now.getTime() - years * 365 * 24 * 60 * 60 * 1000);
                        time = postDate.toLocaleString('ar-EG');
                        break;
                    }
                    else if (timeText.length > 5 && (timeText.includes('/') || timeText.includes('-') || timeText.match(/\d{4}/))) {
                        time = timeText;
                        break;
                    }
                }
            }
        }

        // إذا فشل كل شيء، نضع وقت افتراضي
        if (time === 'غير معروف') {
            time = new Date().toLocaleString('ar-EG');
        }

        // 🔥 استخراج التفاعلات
        const fullElementText = element.textContent || '';

        const extractNumber = (patterns) => {
            for (const pattern of patterns) {
                const match = fullElementText.match(pattern);
                if (match && match[1]) {
                    const arabicToEnglish = {
                        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
                        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
                    };

                    const numberText = match[1].trim().replace(/,/g, '');
                    const englishNumber = numberText.replace(
                        /[٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹]/g,
                        char => arabicToEnglish[char] || char
                    );

                    return parseInt(englishNumber) || 0;
                }
            }
            return 0;
        };

        const totalReactions = extractNumber([
            /كل التفاعلات:\s*([٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹,\s]+)/,
            /Total reactions:\s*(\d+[,]?\d*)/i
        ]);

        const comments = extractNumber([/(\d+)\s*(تعليق|comment)/i]);
        const likes = extractNumber([/(\d+)\s*(إعجاب|like)/i]);
        const shares = extractNumber([/(\d+)\s*(مشاركة|share)/i]);

        // توزيع التفاعلات
        let finalComments = comments;
        let finalLikes = likes;
        let finalShares = shares;

        if (totalReactions > 0 && comments === 0 && likes === 0 && shares === 0) {
            finalLikes = Math.floor(totalReactions * 0.60);
            finalComments = Math.floor(totalReactions * 0.30);
            finalShares = Math.floor(totalReactions * 0.10);
        }

        // التحقق من وجود وسائط
        const hasMedia = element.querySelector('img, video, [data-testid*="media"]') !== null;

        // 🔥 تحديد نوع المنشور
        let postType = 'منشور عادي';
        if (element.querySelector('video')) {
            postType = 'فيديو';
        } else if (element.querySelector('img') && !element.querySelector('svg')) {
            postType = 'صورة';
        } else if (text.includes('shared') || text.includes('مشاركة')) {
            postType = 'مشاركة';
        } else if (author.includes(' shared ')) {
            postType = 'مشاركة';
        }
        // const MAX_LENGTH = 1500;
        // const isTruncated = text.length > MAX_LENGTH;
        const isTruncated = /عرض المزيد|See more/i.test(text);
        return {
            postId,
            postUrl,
            author,
            text: text.substring(0, 1500),
            comments: finalComments,
            likes: finalLikes,
            shares: finalShares,
            reactions: totalReactions,
            time,
            hasMedia,
            postType,
            isTruncated
        };

    } catch (error) {
        console.log('⚠️ خطأ في extractPostData:', error.message);
        return null;
    }
}

function validatePosts(posts) {
    return posts.filter(post => {
        if (!post || !post.text) return false;
        if (post.text.length < 15) return false;
        if (post.author === 'غير معروف') return false;

        // تصفية المحتوى غير المرغوب
        const invalidPatterns = [
            'أشخاص قد تعرفهم',
            'إضافة صديق',
            'Sponsored',
            'مُموّل',
            'صديق مشترك',
            'عرض الكل'
        ];

        for (const pattern of invalidPatterns) {
            if (post.text.includes(pattern) || post.author.includes(pattern)) {
                return false;
            }
        }

        return true;
    });
}

function downloadCSV() {
    if (extractedPosts.length === 0) {
        sendStatus('❌ لا توجد بيانات للتنزيل', 'error');
        return;
    }

    try {
        // تحويل البيانات إلى CSV
        const headers = ['PostId', 'PostUrl', 'Author', 'Text', 'Comments', 'Likes', 'Shares', 'Reactions', 'PostTime', 'HasMedia', 'PostType', 'IsTruncated'];
        let csv = '\uFEFF' + headers.join(',') + '\n';

        extractedPosts.forEach(post => {
            const row = [
                `"${(post.postId || '').replace(/"/g, '""')}"`,
                `"${(post.postUrl || '').replace(/"/g, '""')}"`,
                `"${(post.author || '').replace(/"/g, '""')}"`,
                `"${(post.text || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
                post.comments,
                post.likes,
                post.shares,
                post.reactions,
                `"${(post.time || '').replace(/"/g, '""')}"`,
                post.hasMedia,
                `"${(post.postType || '').replace(/"/g, '""')}"`,
                post.isTruncated
            ];
            csv += row.join(',') + '\n';
        });

        // إنشاء ملف وتنزيله
        const blob = new Blob([csv], { type: 'text/csv; charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const filename = `facebook_posts_${new Date().toISOString().split('T')[0]}.csv`;

        // إرسال طلب التنزيل إلى background script
        chrome.runtime.sendMessage({
            action: 'downloadFile',
            url: url,
            filename: filename
        });

        sendStatus(`✅ تم إنشاء ملف بـ ${extractedPosts.length} منشور`, 'success');

    } catch (error) {
        console.error('❌ خطأ في إنشاء CSV:', error);
        sendStatus('❌ فشل في إنشاء الملف', 'error');
    }
}}
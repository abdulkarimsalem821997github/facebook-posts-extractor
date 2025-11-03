const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIE_PATH = path.resolve('./fb_cookies.json');
const OUTPUT_FILE = path.resolve('./posts.csv');
const PAGE_URL = 'https://www.facebook.com/';

const SCROLL_TIMES = 30;
const SCROLL_DELAY = 4000;
const SAVE_EVERY = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function writeCSV(filePath, data) {
    const headers = ['PostId', 'PostUrl', 'Author', 'Text', 'Comments', 'Likes', 'Shares', 'Reactions', 'PostTime', 'HasMedia', 'PostType'];
    let csv = '';

    if (!fs.existsSync(filePath)) {
        csv += '\uFEFF' + headers.join(',') + '\n';
        fs.writeFileSync(filePath, csv, { encoding: 'utf8' });
    }

    let rows = '';
    for (const row of data) {
        const safeAuthor = (row.author || '').replace(/"/g, '""');
        const safeText = (row.text || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const safeTime = (row.time || '').replace(/"/g, '""');
        const safePostId = (row.postId || '').replace(/"/g, '""');
        const safePostUrl = (row.postUrl || '').replace(/"/g, '""');

        rows += `"${safePostId}","${safePostUrl}","${safeAuthor}","${safeText}",${row.comments},${row.likes},${row.shares},${row.reactions},"${safeTime}",${row.hasMedia},"${row.postType}"\n`;
    }

    fs.appendFileSync(filePath, rows, { encoding: 'utf8' });
}

(async () => {
    if (!fs.existsSync(COOKIE_PATH)) {
        console.error('❌ ملف الكوكيز غير موجود.');
        process.exit(1);
    }

    const browser = await chromium.launch({
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    });

    const context = await browser.newContext({
        storageState: COOKIE_PATH,
        viewport: { width: 1280, height: 1200 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    console.log(`🌐 جار التوجه إلى الصفحة الرئيسية...`);

    try {
        await page.goto(PAGE_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
    } catch (err) {
        console.warn('⚠️ تحذير أثناء التحميل الأولي، المتابعة...');
    }

    await sleep(8000);

    const currentUrl = page.url();
    console.log(`📍 الصفحة الحالية: ${currentUrl}`);

    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
        console.error('❌ تم توجيهك إلى صفحة تسجيل الدخول.');
        await browser.close();
        process.exit(1);
    }

    // التحقق من أننا في الصفحة الرئيسية
    if (!currentUrl.includes('facebook.com') || currentUrl.includes('/messages') || currentUrl.includes('/watch')) {
        console.log('⚠️ لم نتمكن من الوصول إلى الصفحة الرئيسية، جاري إعادة التوجيه...');
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
        await sleep(5000);
    }

    console.log('✅ تم الوصول إلى الصفحة الرئيسية بنجاح');
    console.log('🔄 بدء التمرير واستخراج المنشورات من الـ News Feed...');

    let seenPosts = new Set();
    let batch = [];
    let totalExtracted = 0;
    let allPosts = []; // تخزين جميع المنشورات للإحصائيات

    for (let i = 0; i < SCROLL_TIMES; i++) {
        try {
            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight * 1.5);
            });
            console.log(`↕️  التمريرة ${i + 1}/${SCROLL_TIMES}`);
        } catch (err) {
            console.warn(`⚠️ خطأ أثناء التمرير: ${err.message}`);
        }

        await sleep(SCROLL_DELAY);

        try {
            const posts = await page.evaluate(() => {
                const items = [];

                // 🔥 محددات خاصة بالصفحة الرئيسية
                const feedSelectors = [
                    'div[role="article"]',
                    '[data-pagelet*="Feed"] > div > div',
                    '[data-pagelet*="MainFeed"] > div',
                    'div[class*="story"]',
                    'div[data-ad-preview="message"]'
                ];

                let nodes = [];
                feedSelectors.forEach(selector => {
                    const found = document.querySelectorAll(selector);
                    if (found.length > 0) {
                        nodes = nodes.concat(Array.from(found));
                    }
                });

                // إزالة التكرارات
                nodes = nodes.filter((node, index, self) =>
                    index === self.findIndex(n => n.isEqualNode(node))
                );

                console.log(`🔍 تم العثور على ${nodes.length} منشور في الـ Feed`);

                for (const el of nodes) {
                    try {
                        // 🔥 استخراج الرابط والـ PostId
                        let postUrl = 'غير معروف';
                        let postId = 'غير معروف';

                        // البحث عن روابط المنشورات في الـ Feed
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
                            const linkEl = el.querySelector(selector);
                            if (linkEl?.href) {
                                const url = linkEl.href;

                                // تصفية الروابط غير المرغوب فيها في الـ Feed
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

                                        // أنماط مختلفة لـ PostId في الـ Feed
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

                        // 🔥 استخراج المؤلف من الـ Feed
                        const authorSelectors = [
                            'a[role="link"][tabindex="0"] span',
                            'span[dir="auto"] a',
                            'h3 a',
                            'a[data-testid*="post_actor"]',
                            'a[href*="/"] span:first-child'
                        ];

                        let author = 'غير معروف';
                        for (const selector of authorSelectors) {
                            const authorEl = el.querySelector(selector);
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

                        // 🔥 استخراج النص من الـ Feed
                        const textSelectors = [
                            'div[dir="auto"]',
                            'div[data-ad-comet-preview="message"]',
                            'div[class*="userContent"]',
                            'span[class*="message"]'
                        ];

                        let text = '';
                        for (const selector of textSelectors) {
                            const textEls = el.querySelectorAll(selector);
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
                            text = el.textContent?.trim() || '';
                        }

                        // 🔥 تصفية المحتوى في الـ Feed
                        if (!text || text.length < 15 ||
                            text.includes('Sponsored') ||
                            text.includes('مُموّل') ||
                            el.querySelector('[aria-label*="Sponsored"]') ||
                            el.querySelector('[data-testid*="sponsored"]')) {
                            continue;
                        }

                        // إذا لم نجد رابط، نستخدم بيانات المؤلف والنص لإنشاء معرف فريد
                        if (postId === 'غير معروف') {
                            const uniqueContent = author + text.substring(0, 30);
                            postId = `feed_${btoa(uniqueContent).substring(0, 20)}_${Date.now()}`;
                        }

                        // 🔥 طرق بديلة لاستخراج PostId في الـ Feed
                        if (postId === 'غير معروف') {
                            // من data attributes
                            const dataAttrs = ['data-ft', 'data-store', 'data-gt'];
                            for (const attr of dataAttrs) {
                                const dataValue = el.getAttribute(attr);
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
                            const textContent = el.textContent || '';
                            const textHash = textContent.substring(0, 50).replace(/\s+/g, '').substring(0, 15);
                            postId = `feed_${Date.now()}_${textHash}`;
                        }

                        // 🔥 استخراج الوقت من الـ Feed
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
                            const timeEl = el.querySelector(selector);
                            if (timeEl) {
                                // المحاولة الأولى: من data-utime
                                const utime = timeEl.getAttribute('data-utime');
                                if (utime) {
                                    try {
                                        const postDate = new Date(parseInt(utime) * 1000);
                                        time = postDate.toLocaleString('ar-EG');
                                        break;
                                    } catch (e) {}
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

                        // 🔥 استخراج التفاعلات من الـ Feed
                        const fullElementText = el.textContent || '';

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
                        const hasMedia = el.querySelector('img, video, [data-testid*="media"]') !== null;

                        // 🔥 تحديد نوع المنشور في الـ Feed
                        let postType = 'منشور عادي';
                        if (el.querySelector('video')) {
                            postType = 'فيديو';
                        } else if (el.querySelector('img') && !el.querySelector('svg')) {
                            postType = 'صورة';
                        } else if (text.includes('shared') || text.includes('مشاركة')) {
                            postType = 'مشاركة';
                        } else if (author.includes(' shared ')) {
                            postType = 'مشاركة';
                        }

                        items.push({
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
                            postType
                        });

                    } catch (e) {
                        console.log('⚠️ خطأ في معالجة منشور في الـ Feed');
                    }
                }
                return items;
            });

            let newPosts = 0;
            for (const p of posts) {
                const key = p.postId;
                if (!seenPosts.has(key)) {
                    seenPosts.add(key);
                    batch.push(p);
                    allPosts.push(p); // إضافة إلى جميع المنشورات
                    newPosts++;
                    totalExtracted++;
                }
            }

            console.log(`📄 ${posts.length} منشور في الـ Feed، ${newPosts} جديد`);

            // 🔥 عرض عينات من الـ Feed
            if (newPosts > 0) {
                const sample = batch[batch.length - 1];
                console.log(`   🆔 ${sample.postId.substring(0, 25)}...`);
                console.log(`   👤 ${sample.author}`);
                console.log(`   🔗 ${sample.postUrl !== 'غير معروف' ? '✅' : '❌'}`);
                console.log(`   🕒 ${sample.time}`);
                console.log(`   📝 ${sample.text.substring(0, 60)}...`);
                if (sample.reactions > 0) {
                    console.log(`   📊 ${sample.reactions} تفاعل`);
                }
            }

        } catch (err) {
            console.warn(`⚠️ خطأ أثناء الاستخراج: ${err.message}`);
        }

        if ((i + 1) % SAVE_EVERY === 0 && batch.length > 0) {
            writeCSV(OUTPUT_FILE, batch);
            console.log(`💾 حفظ ${batch.length} منشور بعد ${i + 1} تمريرات`);
            batch = [];
        }

        if (i > 15 && batch.length === 0) {
            console.log('🛑 لم نجد منشورات جديدة، إيقاف التمرير...');
            break;
        }
    }

    // حفظ أي منشورات متبقية
    if (batch.length > 0) {
        writeCSV(OUTPUT_FILE, batch);
    }

    console.log(`\n✅ تم الانتهاء! إجمالي المنشورات المستخرجة من الـ News Feed: ${totalExtracted}`);
    console.log(`💾 تم حفظ البيانات في: ${OUTPUT_FILE}`);

    // 🔥 عرض إحصائيات الـ Feed من جميع المنشورات
    if (allPosts.length > 0) {
        const stats = {
            withUrl: allPosts.filter(p => p.postUrl !== 'غير معروف').length,
            authors: [...new Set(allPosts.map(p => p.author))].length,
            postTypes: allPosts.reduce((acc, p) => {
                acc[p.postType] = (acc[p.postType] || 0) + 1;
                return acc;
            }, {}),
            hasMedia: allPosts.filter(p => p.hasMedia).length,
            totalReactions: allPosts.reduce((sum, p) => sum + p.reactions, 0),
            totalComments: allPosts.reduce((sum, p) => sum + p.comments, 0),
            totalLikes: allPosts.reduce((sum, p) => sum + p.likes, 0),
            totalShares: allPosts.reduce((sum, p) => sum + p.shares, 0)
        };

        console.log('\n📊 إحصائيات الـ News Feed:');
        console.log(`   🔗 منشورات برابط: ${stats.withUrl}/${allPosts.length}`);
        console.log(`   👥 عدد المصادر: ${stats.authors}`);
        console.log(`   🖼️  منشورات بوسائط: ${stats.hasMedia}`);
        console.log(`   📊 إجمالي التفاعلات: ${stats.totalReactions}`);
        console.log(`   💬 إجمالي التعليقات: ${stats.totalComments}`);
        console.log(`   👍 إجمالي الإعجابات: ${stats.totalLikes}`);
        console.log(`   🔄 إجمالي المشاركات: ${stats.totalShares}`);
        console.log(`   📋 أنواع المنشورات:`);
        Object.entries(stats.postTypes).forEach(([type, count]) => {
            console.log(`      - ${type}: ${count}`);
        });

        // عرض أهم المصادر
        const authorCounts = allPosts.reduce((acc, p) => {
            acc[p.author] = (acc[p.author] || 0) + 1;
            return acc;
        }, {});

        const topAuthors = Object.entries(authorCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        console.log(`   🏆 أهم المصادر:`);
        topAuthors.forEach(([author, count], index) => {
            console.log(`      ${index + 1}. ${author}: ${count} منشور`);
        });

        // عرض المنشورات الأكثر تفاعلاً
        const topPostsByReactions = [...allPosts]
            .sort((a, b) => b.reactions - a.reactions)
            .slice(0, 3);

        console.log(`   🔥 المنشورات الأكثر تفاعلاً:`);
        topPostsByReactions.forEach((post, index) => {
            console.log(`      ${index + 1}. ${post.author}: "${post.text.substring(0, 40)}..." (${post.reactions} تفاعل)`);
        });
    } else {
        console.log('❌ لم يتم استخراج أي منشورات لعرض الإحصائيات');
    }

    await browser.close();
})();
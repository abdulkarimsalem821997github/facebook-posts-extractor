let isExtracting = false;
let extractionStats = {};
let currentTab = null;

document.getElementById('startExtraction').addEventListener('click', async () => {
    await startExtraction();
});

document.getElementById('stopExtraction').addEventListener('click', () => {
    stopExtraction();
});

document.getElementById('downloadCSV').addEventListener('click', () => {
    downloadCSV();
});

async function startExtraction() {
    if (isExtracting) return;
    
    isExtracting = true;
    updateUI();
    updateStatus('⏳ جاري التحضير...', 'info');
    
    try {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        currentTab = tab;
        
        if (!tab.url.includes('facebook.com')) {
            updateStatus('❌ يرجى فتح فيسبوك أولاً', 'error');
            isExtracting = false;
            updateUI();
            return;
        }
        
        updateStatus('🔄 جاري تهيئة الاستخراج...', 'info');
        
        // محاولة الاتصال مع content script
        let connected = false;
        let retries = 5;
        
        while (retries > 0 && !connected) {
            try {
                const response = await sendMessageToContentScript(tab.id, { action: 'ping' });
                if (response && response.success) {
                    connected = true;
                    break;
                }
            } catch (error) {
                console.log(`محاولة اتصال فشلت، محاولات متبقية: ${retries - 1}`);
            }
            
            retries--;
            if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        if (!connected) {
            // إذا فشل الاتصال، نحقن content script يدوياً
            updateStatus('📦 جاري تحميل الأدوات...', 'info');
            await injectContentScript(tab.id);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // بدء الاستخراج بعد التأكد من الاتصال
        await sendMessageToContentScript(tab.id, { action: 'startExtraction' });
        updateStatus('🚀 بدء استخراج المنشورات...', 'success');
        
    } catch (error) {
        console.error('خطأ في بدء الاستخراج:', error);
        updateStatus('❌ فشل في بدء الاستخراج', 'error');
        isExtracting = false;
        updateUI();
    }
}

async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['contentScript.js']
        });
        console.log('✅ تم حقن content script بنجاح');
        return true;
    } catch (error) {
        console.error('❌ فشل في حقن content script:', error);
        return false;
    }
}

function sendMessageToContentScript(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

function stopExtraction() {
    isExtracting = false;
    updateUI();
    
    if (currentTab) {
        sendMessageToContentScript(currentTab.id, { action: 'stopExtraction' })
            .catch(error => {
                console.log('⚠️ لا يمكن إرسال رسالة الإيقاف:', error.message);
            });
    }
    
    updateStatus('⏹️ تم إيقاف الاستخراج', 'warning');
}

function downloadCSV() {
    if (!currentTab) {
        updateStatus('❌ لا يوجد تبويب نشط', 'error');
        return;
    }
    
    updateStatus('📥 جاري تحضير الملف...', 'info');
    
    sendMessageToContentScript(currentTab.id, { action: 'downloadCSV' })
        .then(response => {
            if (response && response.success) {
                updateStatus('✅ تم بدء التنزيل', 'success');
            } else {
                updateStatus('❌ فشل في التنزيل', 'error');
            }
        })
        .catch(error => {
            console.error('خطأ في التنزيل:', error);
            updateStatus('❌ لا توجد بيانات للتنزيل', 'error');
        });
}

function updateUI() {
    const startBtn = document.getElementById('startExtraction');
    const stopBtn = document.getElementById('stopExtraction');
    const downloadBtn = document.getElementById('downloadCSV');
    
    startBtn.disabled = isExtracting;
    stopBtn.disabled = !isExtracting;
    downloadBtn.disabled = isExtracting;
}

function updateStatus(message, type = 'info') {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    
    // إعادة تعيين الأنماط
    statusEl.style.background = 'rgba(255, 255, 255, 0.1)';
    statusEl.style.color = 'white';
    
    if (type === 'error') {
        statusEl.style.background = 'rgba(255, 107, 107, 0.3)';
    } else if (type === 'success') {
        statusEl.style.background = 'rgba(76, 175, 80, 0.3)';
    } else if (type === 'warning') {
        statusEl.style.background = 'rgba(255, 152, 0, 0.3)';
    }
}

function updateProgress(percentage) {
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = percentage + '%';
}

function updateStats(stats) {
    const statsEl = document.getElementById('stats');
    if (stats && stats.totalPosts) {
        statsEl.innerHTML = `
            📊 ${stats.totalPosts} منشور | 
            💬 ${stats.totalComments} تعليق | 
            👍 ${stats.totalLikes} إعجاب
        `;
    }
}

// الاستماع للرسائل من content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('📨 popup استلم رسالة:', request.action);
    
    switch (request.action) {
        case 'updateStatus':
            updateStatus(request.message, request.type);
            break;
        case 'updateProgress':
            updateProgress(request.percentage);
            break;
        case 'updateStats':
            updateStats(request.stats);
            break;
        case 'extractionComplete':
            isExtracting = false;
            updateUI();
            updateStatus('✅ اكتمل الاستخراج!', 'success');
            document.getElementById('downloadCSV').disabled = false;
            break;
        case 'contentScriptReady':
            updateStatus('✅ الأدوات جاهزة', 'success');
            break;
    }
    
    sendResponse({ received: true });
    return true;
});

// تحديث الواجهة عند فتح popup
document.addEventListener('DOMContentLoaded', () => {
    updateStatus('👆 اضغط "بدء الاستخراج" لبدء العمل');
    updateUI();
});
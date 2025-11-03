// خدمة الخلفية للإضافة
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadFile') {
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            saveAs: false
        });
        sendResponse({ success: true });
    }
    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('✅ Facebook Posts Extractor installed');
});
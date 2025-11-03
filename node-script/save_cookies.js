// save_cookies.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const COOKIE_PATH = path.resolve('./fb_cookies.json');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' // عدّل المسار إذا لزم
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('🔷 فتح المتصفح... سيفتح Facebook الآن — سجّل دخولك يدويًا في النافذة المفتوحة.');
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

  console.log('\n📌 بعد انتهاء التسجيل اليدوي (وأي تحقق)، ارجع إلى الطرفية واضغط Enter لحفظ الكوكيز.');
  await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('اضغط Enter لحفظ الكوكيز... ', () => { rl.close(); resolve(); });
  });

  // حفظ حالة الجلسة (cookies + localStorage)
  await context.storageState({ path: COOKIE_PATH });
  console.log(`✅ تم حفظ الكوكيز وحالة الجلسة في: ${COOKIE_PATH}`);

  await browser.close();
})();

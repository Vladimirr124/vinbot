const puppeteer = require('puppeteer');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const { default: PQueue } = require('p-queue');
const { backupSites, SCREENSHOT_FOLDER } = require('./config');
const { analyzeScreenshotsWithGPT } = require('./openai');
const sharp = require('sharp');

const queue = new PQueue({ concurrency: 3 });

async function searchOnBidCars(query, isLot = false) {
    // Всегда используем русскую версию сайта для стабильности
    const url = isLot 
        ? `https://bid.cars/ru/lot/${query}`
        : `https://bid.cars/ru/search/results?search-type=typing&query=${query}`;
    
    console.log('Загрузка страницы bid.cars...', url);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0');
    
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Проверяем редирект на страницу с ошибкой для лотов
        if (isLot) {
            const currentUrl = page.url();
            if (currentUrl.includes('/error') || currentUrl.includes('/404')) {
                console.log('Лот не найден (редирект на страницу ошибки)');
                await browser.close();
                return { result: null, url, screenshotPaths: [], captchaDetected: false };
            }
        }

        const pageContent = await page.content();
        if (pageContent.includes('Checking your browser') || pageContent.includes('cf-challenge') || pageContent.toLowerCase().includes('captcha')) {
            console.warn('🛑 Обнаружена Cloudflare-капча!');
            await browser.close();
            return { result: null, url, screenshotPaths: [], captchaDetected: true };
        }

        await page.waitForFunction(() => {
            const loader = document.querySelector('.loader');
            return !loader || loader.offsetParent === null;
        }, { timeout: 30000 });
    } catch (e) {
        console.warn('⚠️ Лоадер не исчез — продолжаем.', e.message);
    }

    // --- Новый массив для двух скриншотов ---
    const screenshotPaths = [];
    const fs = require('fs');
    // 1. Скриншот верхней части страницы (top)
    const fullScreenshotFile = `screenshot_${query}_${Date.now()}_full.png`;
    const fullScreenshotPath = path.join(SCREENSHOT_FOLDER, fullScreenshotFile);
    await page.screenshot({ path: fullScreenshotPath, fullPage: true });
    const image = sharp(fullScreenshotPath);
    const metadata = await image.metadata();
    if (metadata.width && metadata.height && metadata.height >= 3) {
        const fortyPercentHeight = Math.floor(metadata.height * 0.36);
        const topFile = `screenshot_${query}_${Date.now()}_top.png`;
        const topPath = path.join(SCREENSHOT_FOLDER, topFile);
        await image.extract({ left: 0, top: 0, width: metadata.width, height: fortyPercentHeight })
            .sharpen(2, 1, 0.5)
            .normalize()
            .modulate({ brightness: 1.1, saturation: 1.1 })
            .toFile(topPath);
        screenshotPaths.push(topPath);
        if (fs.existsSync(fullScreenshotPath)) fs.unlinkSync(fullScreenshotPath);
    } else {
        screenshotPaths.push(fullScreenshotPath);
    }

    // 2. Клик по вкладке 'О машине' и скриншот этой вкладки
    let aboutTabFound = false;
    try {
        await new Promise(res => setTimeout(res, 500));
        aboutTabFound = await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('button, a, [role=tab], .tab'));
            const aboutTexts = ['О машине'];
            for (const tab of tabs) {
                const text = (tab.innerText || tab.textContent || '').trim();
                if (aboutTexts.includes(text)) {
                    tab.click();
                    return true;
                }
            }
            return false;
        });
        if (aboutTabFound) {
            await page.waitForFunction(() => {
                return document.querySelector('.lot-info, .lot-details, .car-info, .lot-params, .lot-params__list');
            }, { timeout: 3000 });
            await new Promise(res => setTimeout(res, 400));
            // Скриншот вкладки 'О машине' (full)
            const aboutFile = `screenshot_${query}_${Date.now()}_about_full.png`;
            const aboutPath = path.join(SCREENSHOT_FOLDER, aboutFile);
            await page.screenshot({ path: aboutPath, fullPage: true });
            // Обрезаем и обрабатываем как top
            const aboutImage = sharp(aboutPath);
            const aboutMeta = await aboutImage.metadata();
            if (aboutMeta.width && aboutMeta.height && aboutMeta.height >= 3) {
                const aboutHeight = Math.floor(aboutMeta.height * 0.36);
                const aboutCropFile = `screenshot_${query}_${Date.now()}_about.png`;
                const aboutCropPath = path.join(SCREENSHOT_FOLDER, aboutCropFile);
                await aboutImage.extract({ left: 0, top: 0, width: aboutMeta.width, height: aboutHeight })
                    .sharpen(2, 1, 0.5)
                    .normalize()
                    .modulate({ brightness: 1.1, saturation: 1.1 })
                    .toFile(aboutCropPath);
                screenshotPaths.push(aboutCropPath);
                if (fs.existsSync(aboutPath)) fs.unlinkSync(aboutPath);
            } else {
                screenshotPaths.push(aboutPath);
            }
        }
    } catch (e) {
        console.warn('Не удалось кликнуть по вкладке О машине или сделать скрин:', e.message);
    }

    // Анализируем только первый скриншот (верх)
    let result = null;
    if (screenshotPaths.length > 0) {
        result = await analyzeScreenshotsWithGPT(screenshotPaths, false);
    }
    const currentUrl = page.url();
    await browser.close();

    return { result, url: currentUrl, screenshotPaths, captchaDetected: false };
}

async function searchOnBackupSites(vin) {
  const results = [];
  const vinRegex = new RegExp(vin, 'i');
  const carKeywords = [
    'make', 'model', 'year', 'mileage', 'odometer', 'price', 'auction', 'vehicle', 'автомобиль', 'марка', 'модель', 'год', 'пробег', 'цена','sales',
    'photo', 'history', 'lot', 'Lot', 'iaai', 'copart', 'report', 'статус', 'продан', 'аукцион', 'лот', 'история', 'фото', 'vin', 'номер', 'engine', 'fuel', 'drive line', 'transmission', 'retail value', 'repairable', 'damage', 'keys', 'automatic', 'front', 'four wheel drive', 'without keys', 'sale', 'salvage', 'qc', 'value', 'open photo', 'technical specs', 'odometer', 'mi', 'other', 'automatic', 'repairable (qc)'
  ];
  const moreKeywords = [
    'photo', 'history', 'lot', 'auction', 'iaai', 'copart', 'vehicle', 'report',
    'статус', 'продан', 'аукцион', 'лот', 'история', 'фото', 'vin', 'номер', 'пробег', 'год', 'марка', 'модель'
  ];

  const tasks = backupSites.map(site => async () => {
    const link = site.includes('carcheck.by') ? `${site}${vin}` : `${site}${vin}`;
    let text = null;
    let fetchFailed = false;
    try {
      console.log(`Проверка сайта: ${link}`);
      const res = await fetch(link, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });
      if (res.status !== 200) {
        console.log(`Сайт ${link} вернул статус ${res.status} (fetch)`);
        fetchFailed = true;
      } else {
        text = await res.text();
      }
    } catch (err) {
      console.log(`Ошибка при fetch сайта ${link}: ${err.message}`);
      fetchFailed = true;
    }

    // Если fetch не сработал — пробуем puppeteer
    if (fetchFailed || !text) {
      try {
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(res => setTimeout(res, 2000)); // Ждём 2 секунды для полной отрисовки
        text = await page.content();
        await browser.close();
      } catch (err) {
        console.log(`Ошибка при puppeteer сайта ${link}: ${err.message}`);
        text = null;
      }
    }

    if (!text) {
      console.log(`Не удалось получить содержимое сайта: ${link}`);
      return;
    }

    console.log('Первые 500 символов текста:', text.slice(0, 500));

    const hasVin = vinRegex.test(text);
    console.log('VIN найден?', hasVin);
    // Страница считается полезной, если:
    // 1) Есть VIN
    // 2) И (хотя бы 2 совпадения из carKeywords ИЛИ хотя бы 2 совпадения из moreKeywords ИЛИ есть <img>)
    const hasEnoughInfo = carKeywords.filter(keyword =>
      text.toLowerCase().includes(keyword)
    ).length >= 1;
    const hasMoreInfo = moreKeywords.filter(keyword =>
      text.toLowerCase().includes(keyword)
    ).length >= 1;
    const hasImg = /<img[^>]+src=/.test(text);
    console.log('Есть <img>?', hasImg);
    const hasTable = /<table[^>]*>/.test(text);

    const error404Patterns = [
      '404', 'страница не найдена', 'not found', 'does not exist', 'could not be found',
      'не существует', 'page not found', 'oops', 'ошибка',
      'подтвердите', 'вы человек', 'captcha', 'please verify', 'i am not a robot', 'are you human',
      'проверяем, человек ли вы', 'необходимо проверить безопасность', 'checking your browser', 'идет проверка', 'security check'
    ];
    const is404 = error404Patterns.some(pattern => text.toLowerCase().includes(pattern));

    // --- Добавляем фильтрацию по негативным паттернам ---
    const negativePatterns = [
      'no data found', 'no information', 'ничего не найдено', 'данных нет', 'no records', 'no results',
      'we could not find', 'no vehicles found', 'no auction history', 'no such vin',
      'not available', 'нет информации', 'нет данных', 'no matching records', 'no matching vehicles',
      'no matching lots', 'no matching cars', 'no matching auction', 'no matching history'
    ];
    const isNegative = negativePatterns.some(pattern => text.toLowerCase().includes(pattern));

    if (is404 || isNegative) {
      const matchedPattern = (is404 ? error404Patterns : negativePatterns).find(pattern => text.toLowerCase().includes(pattern));
      console.log(`❌ Страница содержит признаки ошибки/капчи/404/отсутствия данных: ${link} (паттерн: ${matchedPattern})`);
      return;
    }

    if (
      hasVin &&
      hasTable
    ) {
      console.log(`✅ Найдена информация на сайте: ${link}`);
      console.log('Ключевые слова:', carKeywords.filter(keyword => text.toLowerCase().includes(keyword)));
      console.log('MoreKeywords:', moreKeywords.filter(keyword => text.toLowerCase().includes(keyword)));
      results.push(link);
    } else {
      console.log(`🔍 Информация не найдена или бесполезна: ${link}`);
    }
  });

  await queue.addAll(tasks);
  return results;
}

module.exports = { searchOnBidCars, searchOnBackupSites }; 
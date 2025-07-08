const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { freeLimit, ADMIN_CHAT_ID, SCREENSHOT_FOLDER } = require('./config');
const { userData, userLogs, initUser, isSubscribed, addSubscription, setUserLanguage } = require('./state');
const { formatDate, getUserLanguage, preprocessImage } = require('./utils');
const { recognizeVinWithGoogleVision } = require('./vision');
const { analyzeScreenshotWithGPT, translateTextWithGPT } = require('./openai');
const { searchOnBidCars, searchOnBackupSites } = require('./scrapers');

async function processVIN(ctx, vin, options = {}) {
    const userId = ctx.chat.id;
    const lang = getUserLanguage(ctx);
    const user = userData.get(userId);

    if (user.cancelSearch) {
        user.cancelSearch = false;
        return;
    }

    await ctx.reply(lang === 'en' ? '🔍 Searching...' : '🔍 Ищу...');

    const { result, url, screenshotPaths, captchaDetected } = await searchOnBidCars(vin);

    let gptResults = [];
    for (let i = 0; i < 2; ++i) {
        if (screenshotPaths && screenshotPaths[i] && fs.existsSync(screenshotPaths[i])) {
            let gptResult = await analyzeScreenshotWithGPT(screenshotPaths[i], false, null, 'ru');
            if (lang === 'en' && gptResult) {
                gptResult = await translateTextWithGPT(gptResult, 'en');
            }
            if (lang === 'ru' && gptResult) {
                gptResult = manualTranslateToRussian(gptResult);
            }
            gptResults.push({ path: screenshotPaths[i], result: gptResult });
        }
    }

    let foundOnMainSite = false;
    if (captchaDetected) {
        await ctx.reply(lang === 'en' ? '🤖 Site is protected by captcha.' : '🤖 Сайт защищен капчей.');
    } else if (
        gptResults.length > 0 &&
        gptResults.some(r => r.result && !r.result.toLowerCase().includes('не найдено') && !r.result.toLowerCase().includes('not found') && !r.result.toLowerCase().includes('nothing was found') && !r.result.toLowerCase().includes('nothing'))
    ) {
        foundOnMainSite = true;
        userLogs.get(userId).successful += 1;

        const foundMessage = lang === 'en'  
            ? 'Found sold on sites:'
            : 'Найден проданным на сайтах:';

        let finalUrl = url;
        if (lang === 'en' && typeof finalUrl === 'string' && finalUrl.includes('bid.cars/ru/')) {
            finalUrl = finalUrl.replace('bid.cars/ru/', 'bid.cars/en/');
        }
        const linksMessage = `${foundMessage}\n${finalUrl}`;
        await ctx.reply(linksMessage);

        if (gptResults.length === 2) {
            const mergePrompt =
                'Вот две части информации о лоте с сайта bid.cars. Структурируй и объедини эти данные в один удобный для пользователя блок. Не дублируй одинаковые поля, если они встречаются в обеих частях.\n\n--- Часть 1 (карточка лота) ---\n' +
                (gptResults[0].result || '') + '\n\n--- Часть 2 (О машине) ---\n' +
                (gptResults[1].result || '');
            let mergedText = await analyzeScreenshotWithGPT(null, false, mergePrompt, 'ru');
            if (lang === 'en' && mergedText) {
                mergedText = await translateTextWithGPT(mergedText, 'en');
            }
            if (lang === 'ru' && mergedText) {
                mergedText = manualTranslateToRussian(mergedText);
            }
            const media = [
                {
                    type: 'photo',
                    media: { source: gptResults[0].path },
                    caption: mergedText || '',
                    parse_mode: 'HTML'
                },
                {
                    type: 'photo',
                    media: { source: gptResults[1].path }
                }
            ];
            await ctx.replyWithMediaGroup(media);
        } else {
            for (const { path: imgPath, result: gptText } of gptResults) {
                if (fs.existsSync(imgPath)) {
                    await ctx.replyWithPhoto({ source: imgPath }, {
                        caption: gptText || (lang === 'en' ? 'No result' : 'Нет результата'),
                        parse_mode: 'HTML'
                    });
                }
            }
        }
    } else if (gptResults.length > 0) {
        for (const { result: gptText } of gptResults) {
            if (gptText && !gptText.toLowerCase().includes('не найдено') && !gptText.toLowerCase().includes('not found')) {
                await ctx.reply(gptText, { parse_mode: 'HTML' });
            }
        }
    }

    if (!foundOnMainSite) {
        await ctx.reply(lang === 'en' ? '🔍 No info on bid.cars, searching other sites...' : '🔍 На bid.cars не найдено, ищу на других сайтах...');
        const backupResults = await searchOnBackupSites(vin);
        if (backupResults.length > 0) {
            userLogs.get(userId).successful += 1;
            await ctx.reply(
                (lang === 'en' ? '✅ Found on other sites:\n' : '✅ Найдено на других сайтах:\n') + backupResults.join('\n')
            );
        } else {
            userLogs.get(userId).failed += 1;
            await ctx.reply(lang === 'en' ? '❌ VIN not found anywhere.' : '❌ VIN нигде не найден.');
        }
    }

    if (screenshotPaths && screenshotPaths.length > 0) {
        for (const p of screenshotPaths) {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }
    }
    await ctx.reply(
        lang === 'en'
            ? `Send a photo of the VIN code. Also, VIN or lot number, separately or in a message.`
            : `Отправьте фото вин-кода. Также подойдут VIN или номер лота, отдельно или в сообщении.`
    );
    // userData.set(userId, user);
}

async function processLot(ctx, lotNumber) {
    const userId = ctx.chat.id;
    const lang = getUserLanguage(ctx);
    const user = userData.get(userId);

    if (user.cancelSearch) {
        user.cancelSearch = false;
        return;
    }

    await ctx.reply(`🔍 ${lang === 'en' ? 'Searching...' : 'Ищу...'}`);

    const { result, url, screenshotPaths, captchaDetected } = await searchOnBidCars(lotNumber, true);

    let gptResults = [];
    for (let i = 0; i < 2; ++i) {
        if (screenshotPaths && screenshotPaths[i] && fs.existsSync(screenshotPaths[i])) {
            let gptResult = await analyzeScreenshotWithGPT(screenshotPaths[i], false, null, 'ru');
            if (lang === 'en' && gptResult) {
                gptResult = await translateTextWithGPT(gptResult, 'en');
            }
            if (lang === 'ru' && gptResult) {
                gptResult = manualTranslateToRussian(gptResult);
            }
            gptResults.push({ path: screenshotPaths[i], result: gptResult });
        }
    }

    let foundOnMainSite = false;
    if (captchaDetected) {
        await ctx.reply(lang === 'en' ? '🤖 Site is protected by captcha.' : '🤖 Сайт защищен капчей.');
    } else if (
        gptResults.length > 0 &&
        gptResults.some(r => r.result && !r.result.toLowerCase().includes('не найдено') && !r.result.toLowerCase().includes('not found') && !r.result.toLowerCase().includes('nothing was found'))
    ) {
        foundOnMainSite = true;
        userLogs.get(userId).successful += 1;

        const foundMessage = lang === 'en'
            ? 'Found sold on sites:'
            : 'Найден проданным на сайтах:';

        let finalUrl = url;
        if (lang === 'en' && typeof finalUrl === 'string' && finalUrl.includes('bid.cars/ru/')) {
            finalUrl = finalUrl.replace('bid.cars/ru/', 'bid.cars/en/');
        }
        const linksMessage = `${foundMessage}\n${finalUrl}`;
        await ctx.reply(linksMessage);

        if (gptResults.length === 2) {
            const mergePrompt =
                'Вот две части информации о лоте с сайта bid.cars. Структурируй и объедини эти данные в один удобный для пользователя блок. Не дублируй одинаковые поля, если они встречаются в обеих частях.\n\n--- Часть 1 (карточка лота) ---\n' +
                (gptResults[0].result || '') + '\n\n--- Часть 2 (О машине) ---\n' +
                (gptResults[1].result || '');
            let mergedText = await analyzeScreenshotWithGPT(null, false, mergePrompt, 'ru');
            if (lang === 'en' && mergedText) {
                mergedText = await translateTextWithGPT(mergedText, 'en');
            }
            if (lang === 'ru' && mergedText) {
                mergedText = manualTranslateToRussian(mergedText);
            }
            const media = [
                {
                    type: 'photo',
                    media: { source: gptResults[0].path },
                    caption: mergedText || '',
                    parse_mode: 'HTML'
                },
                {
                    type: 'photo',
                    media: { source: gptResults[1].path }
                }
            ];
            await ctx.replyWithMediaGroup(media);
        } else {
            for (const { path: imgPath, result: gptText } of gptResults) {
                if (fs.existsSync(imgPath)) {
                    await ctx.replyWithPhoto({ source: imgPath }, {
                        caption: gptText || (lang === 'en' ? 'No result' : 'Нет результата'),
                        parse_mode: 'HTML'
                    });
                }
            }
        }
        
    } else {
        userLogs.get(userId).failed += 1;
        await ctx.reply(lang === 'en' ? '❌ Lot not found.' : '❌ Лот не найден.');
    }

    if (screenshotPaths && screenshotPaths.length > 0) {
        for (const p of screenshotPaths) {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }
    }

    await ctx.reply(
        lang === 'en'
            ? `Send a photo of the VIN code. Also, VIN or lot number, separately or in a message.`
            : `Отправьте фото вин-кода. Также подойдут VIN или номер лота, отдельно или в сообщении.`
    );
    // userData.set(userId, user);
}

function registerHandlers(bot) {
    bot.command('admin', async (ctx) => {
        console.log('Вызван обработчик /admin', ctx.chat.id);
        const lang = getUserLanguage(ctx);
        if (ctx.chat.id.toString() !== ADMIN_CHAT_ID) {
            return ctx.reply(lang === 'en' ? '❌ Access denied.' : '❌ Доступ запрещен.');
        }

        await ctx.reply((lang === 'en' ? 'Your chat.id: ' : 'Ваш chat.id: ') + ctx.chat.id);

        const totalUsers = userData.size;
        const totalChecks = [...userData.values()].reduce((sum, u) => sum + u.checks, 0);
        const avgChecks = totalUsers ? (totalChecks / totalUsers).toFixed(2) : 0;
        const totalSubscribers = [...userData.values()].filter(u => isSubscribed(u.subscription)).length;
        
        let stats;
        if (lang === 'en') {
            stats = `📊 **Admin Panel**\n\n`;
            stats += `👥 Users: ${totalUsers}\n`;
            stats += `📈 Average checks: ${avgChecks}\n`;
            stats += `💳 Subscribers: ${totalSubscribers}\n\n`;
            stats += `📋 **User Logs:**\n`;
        } else {
            stats = `📊 **Админка**\n\n`;
            stats += `👥 Пользователей: ${totalUsers}\n`;
            stats += `📈 Среднее кол-во проверок: ${avgChecks}\n`;
            stats += `💳 Подписчиков: ${totalSubscribers}\n\n`;
            stats += `📋 **Логи пользователей:**\n`;
        }

        if (userLogs.size === 0) {
            stats += lang === 'en' ? 'No data.' : 'Нет данных.';
        } else {
            for (const [userId, log] of userLogs.entries()) {
                const user = userData.get(userId);
                const subStatus = isSubscribed(userId)
                    ? (lang === 'en' ? `active until ${formatDate(user.subscription)}` : `активна до ${formatDate(user.subscription)}`)
                    : (lang === 'en' ? 'none' : 'нет');
                stats += `\n**ID:** \`${userId}\`\n`;
                stats += `  - ${lang === 'en' ? 'Successful' : 'Успешно'}: ${log.successful}\n`;
                stats += `  - ${lang === 'en' ? 'Failed' : 'Неуспешно'}: ${log.failed}\n`;
                stats += `  - ${lang === 'en' ? 'Subscription' : 'Подписка'}: ${subStatus}\n`;
            }
        }
        
        await ctx.replyWithHTML(stats);
    });
    
    bot.start(async (ctx) => {
        const userId = ctx.chat.id;
        initUser(userId);
        const user = userData.get(userId);
        user.cancelSearch = false;
        user.canUndo = false;

        // Всегда предлагаем выбрать язык
        return ctx.reply(
            'Пожалуйста, выберите язык / Please select language:',
            Markup.inlineKeyboard([
                [Markup.button.callback('🇷🇺 Русский', 'language_ru'), Markup.button.callback('🇬🇧 English', 'language_en')]
            ])
        );
    });

    // Обработка выбора языка
    bot.action('language_ru', async (ctx) => {
        const userId = ctx.chat.id;
        initUser(userId);
        setUserLanguage(userId, 'ru');
        await ctx.answerCbQuery('Язык выбран: Русский');
        
        await ctx.editMessageText(
            `Привет! Я бот, по фото распознаю VIN-код, и показываю, если автомобиль продавался на страховых аукционах Copart и IAAI.\n\nОбратная связь @bolbat86`
        );
        
        const user = userData.get(userId);
        await ctx.reply(
            `Отправьте фото вин-кода. Также подойдут VIN или номер лота, отдельно или в сообщении.`,
            // Markup.inlineKeyboard([
            //     [Markup.button.callback('🚀 Получить безлимит', 'subscribe')]
            // ]),
            { parse_mode: 'HTML' }
        );
    });

    bot.action('language_en', async (ctx) => {
        const userId = ctx.chat.id;
        initUser(userId);
        setUserLanguage(userId, 'en');
        await ctx.answerCbQuery('Language selected: English');

        await ctx.editMessageText(
            `Hi! I am a bot that recognizes VIN codes from photos and shows if the car was sold at Copart or IAAI auctions.\n\nFeedback: @bolbat86`
        );

        const user = userData.get(userId);
        await ctx.reply(
            `Send a photo, VIN code, or lot number as text.`,
            // Markup.inlineKeyboard([
            //     [Markup.button.callback('🚀 Get Unlimited', 'subscribe')]
            // ]),
            { parse_mode: 'HTML' }
        );
    });

    bot.on('photo', async (ctx) => {
        const userId = ctx.chat.id;
        const lang = getUserLanguage(ctx);
        initUser(userId);
        const user = userData.get(userId);
        user.cancelSearch = false;
        user.canUndo = false;
        // if (!isSubscribed(userId) && user.checks >= freeLimit) {
        //     return ctx.reply(
        //         lang === 'en' ? `You have used ${freeLimit} free checks.` : `Вы использовали ${freeLimit} бесплатных проверок.`,
        //         Markup.inlineKeyboard([
        //             Markup.button.callback(lang === 'en' ? '🚀 Get Unlimited' : '🚀 Получить безлимит', 'subscribe')
        //         ])
        //     );
        // }

        const photo = ctx.message.photo.pop();
        const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
        const filePath = path.join(SCREENSHOT_FOLDER, `vin_photo_${userId}_${Date.now()}.jpg`);
        let processedImagePath;
        let vin = null;
        try {
            const response = await fetch(fileUrl.href);
            const writer = fs.createWriteStream(filePath);
            response.body.pipe(writer);
            await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });

            processedImagePath = await preprocessImage(filePath);
            vin = await recognizeVinWithGoogleVision(processedImagePath);
            if (!vin) {
                console.log('Google Vision не справился, пробую OpenAI...');
                vin = await analyzeScreenshotWithGPT(processedImagePath, true);
            }
            if (vin && vin.toUpperCase().includes('НЕ РАСПОЗНАН')) {
                vin = null;
            }

            if (vin) {
                await ctx.reply(
                    vin.toUpperCase(),
                    Markup.inlineKeyboard([
                        [
                            Markup.button.callback(lang === 'en' ? '✅ Correct' : '✅ Всё верно', `vin_ok_${vin}`),
                            Markup.button.callback(lang === 'en' ? '❌ Incorrect' : '❌ Не распознал верно', `vin_wrong_${vin}`)
                        ]
                    ])
                );
            } else {
                userLogs.get(userId).failed += 1;
                await ctx.reply(getUserLanguage(ctx) === 'en' ? '❌ VIN not recognized.' : '❌ VIN не распознан.');
            }
        } catch (err) {
            console.error('❌ Photo processing error:', err);
            userLogs.get(userId).failed += 1;
            await ctx.reply('❌ Error processing photo.');
        } finally {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            if (processedImagePath && fs.existsSync(processedImagePath)) fs.unlinkSync(processedImagePath);
        }
    });

    bot.on('text', async (ctx) => {
        const originalText = ctx.message.text.trim();
        const upperCaseText = originalText.toUpperCase();
        const lang = getUserLanguage(ctx);

        // Ищем все VIN и все лоты (VIN: 17 символов подряд, лот: 8 цифр подряд или 0-/1- и 8 цифр подряд)
        const vinRegex = /\b[A-Z0-9]{17}\b/g;
        const lotWithDashRegex = /\b[0-1]-\d{8}\b/g;
        const lotDigitsOnlyRegex = /\b\d{8}\b/g;

        const vins = upperCaseText.match(vinRegex) || [];
        const lotsWithDash = upperCaseText.match(lotWithDashRegex) || [];
        const lotsDigitsOnly = upperCaseText.match(lotDigitsOnlyRegex) || [];

        // Исключаем лоты, которые уже попали в lotsWithDash (например, 1-12345678)
        const lotsDigitsOnlyFiltered = lotsDigitsOnly.filter(lot => !lotsWithDash.some(ld => ld.endsWith(lot)));

        let lotVariants = [];
        if (lotsWithDash.length > 0) {
            // Если найден хотя бы один лот с префиксом 0- или 1-, то только он (и VIN если есть)
            lotVariants = [...new Set(lotsWithDash)];
        } else if (lotsDigitsOnlyFiltered.length > 0) {
            // Если только 8 цифр подряд, то два варианта: 0-номер и 1-номер
            for (const lot of lotsDigitsOnlyFiltered) {
                lotVariants.push(`0-${lot}`);
                lotVariants.push(`1-${lot}`);
            }
            lotVariants = [...new Set(lotVariants)];
        }
        // Собираем все уникальные варианты (VIN + варианты лотов)
        const found = [...new Set([...vins, ...lotVariants])];

        if (found.length === 0) {
            await ctx.reply(
                lang === 'en'
                    ? '❌ Please enter either:\n- VIN (17 characters, letters and numbers)\n- Lot number (e.g., 68723752)'
                    : '❌ Пожалуйста, введите:\n- VIN (17 символов, латиница и цифры)\n- Номер лота (например: 68723752)'
            );
            return;
        }

        if (found.length === 1) {
            // Если найден только один вариант — ищем сразу
            const value = found[0];
            await ctx.reply(value);
            initUser(ctx.chat.id);
            if (/^[A-Z0-9]{17}$/.test(value)) {
                await sendVinLinks(ctx, value);
                await processVIN(ctx, value, { fromPhoto: false });
            } else {
                // value всегда вида 0-XXXXXXXX или 1-XXXXXXXX
                let lotNumberToProcess = value;
                let lotNumberForLinks = lotNumberToProcess.replace(/^[0-1]-/, '');
                // Для всех остальных сайтов используем lotNumberForLinks (без X-)
                const statVinUrl = `https://stat.vin/cars/${lotNumberForLinks}`;
                const auctionHistoryUrl = `https://auctionhistory.io/item/${lotNumberForLinks}`;
                const carCheckVinUrl = `https://carcheckvin.com/automobile/${lotNumberForLinks}`;
                const googleLotUrl = `https://www.google.com/search?q=%22${lotNumberForLinks}%22`;
                const bidcarsUrl = `https://bid.cars/`;
                const hideAutoVinUrl = `https://hideautovin.com/`;
                const plcAuctionUrl = `https://plc.auction/`;
                const lotLinksMessage = lang === 'en'
                    ? `🔗 <b>Quick links:</b>\n<a href="${googleLotUrl}">Google</a>\n\n<a href="${statVinUrl}">Stat.vin</a> • <a href="${auctionHistoryUrl}">AuctionHistory</a> • <a href="${carCheckVinUrl}">CarCheckVin</a>\n\n<b>🔗Manual search:</b>\n<a href="${bidcarsUrl}">Bid.cars</a> • <a href="${hideAutoVinUrl}">HideAutoVin</a> • <a href="${plcAuctionUrl}">PLC Auction</a>`
                    : `🔗 <b>Быстрые ссылки:</b>\n<a href="${googleLotUrl}">Google</a>\n\n<a href="${statVinUrl}">Stat.vin</a> • <a href="${auctionHistoryUrl}">AuctionHistory</a> • <a href="${carCheckVinUrl}">CarCheckVin</a>\n\n<b>🔗Для поиска вручную:</b>\n<a href="${bidcarsUrl}">Bid.cars</a> • <a href="${hideAutoVinUrl}">HideAutoVin</a> • <a href="${plcAuctionUrl}">PLC Auction</a>`;
                await ctx.replyWithHTML(lotLinksMessage);
                await processLot(ctx, lotNumberToProcess);
            }
            return;
        }

        // Если найдено несколько вариантов — показываем кнопки
        const buttons = found.map(val => Markup.button.callback(val, `search_choice_${val}`));
        await ctx.reply(
            lang === 'en'
                ? 'Multiple VINs or lot numbers found. Choose what to search:'
                : 'Найдено несколько VIN или номеров лота. Выберите, по какому искать:',
            Markup.inlineKeyboard(buttons, { columns: 1 })
        );
    });

    // Обработчик выбора поиска по кнопке
    bot.action(/search_choice_(.+)/, async (ctx) => {
        const lang = getUserLanguage(ctx);
        const value = ctx.match[1];
        await ctx.answerCbQuery();
        await ctx.reply(value);
        initUser(ctx.chat.id);
        if (/^[A-Z0-9]{17}$/.test(value)) {
            await sendVinLinks(ctx, value);
            await processVIN(ctx, value, { fromPhoto: false });
        } else {
            // value всегда вида 0-XXXXXXXX или 1-XXXXXXXX
            let lotNumberToProcess = value;
            let lotNumberForLinks = lotNumberToProcess.replace(/^[0-1]-/, '');
            const statVinUrl = `https://stat.vin/cars/${lotNumberForLinks}`;
            const auctionHistoryUrl = `https://auctionhistory.io/item/${lotNumberForLinks}`;
            const carCheckVinUrl = `https://carcheckvin.com/automobile/${lotNumberForLinks}`;
            const googleLotUrl = `https://www.google.com/search?q=%22${lotNumberForLinks}%22`;
            const bidcarsUrl = `https://bid.cars/`;
            const hideAutoVinUrl = `https://hideautovin.com/`;
            const plcAuctionUrl = `https://plc.auction/`;
            const lotLinksMessage = lang === 'en'
                ? `🔗 <b>Quick links:</b>\n<a href="${googleLotUrl}">Google</a>\n\n<a href="${statVinUrl}">Stat.vin</a> • <a href="${auctionHistoryUrl}">AuctionHistory</a> • <a href="${carCheckVinUrl}">CarCheckVin</a>\n\n<b>🔗Manual search:</b>\n<a href="${bidcarsUrl}">Bid.cars</a> • <a href="${hideAutoVinUrl}">HideAutoVin</a> • <a href="${plcAuctionUrl}">PLC Auction</a>`
                : `🔗 <b>Быстрые ссылки:</b>\n<a href="${googleLotUrl}">Google</a>\n\n<a href="${statVinUrl}">Stat.vin</a> • <a href="${auctionHistoryUrl}">AuctionHistory</a> • <a href="${carCheckVinUrl}">CarCheckVin</a>\n\n<b>🔗Для поиска вручную:</b>\n<a href="${bidcarsUrl}">Bid.cars</a> • <a href="${hideAutoVinUrl}">HideAutoVin</a> • <a href="${plcAuctionUrl}">PLC Auction</a>`;
            await ctx.replyWithHTML(lotLinksMessage);
            await processLot(ctx, lotNumberToProcess);
        }
    });

    bot.action('subscribe', async (ctx) => {
        try {
            await ctx.answerCbQuery();
        } catch (error) {
            console.log('Ошибка answerCbQuery (устаревший запрос):', error.message);
        }
        const lang = getUserLanguage(ctx);
        await ctx.reply(
            lang === 'en' ? 'Payment methods:' : 'Способы оплаты:',
            Markup.inlineKeyboard([
                [Markup.button.callback(lang === 'en' ? '💸 SBP' : '💸 СБП', 'pay_sbp'), Markup.button.callback(lang === 'en' ? '💳 MIR Card' : '💳 Карта МИР', 'pay_mir')],
                [Markup.button.callback('💳 Visa, Mastercard', 'pay_visa'), Markup.button.callback(lang === 'en' ? '🌐 Other (CloudPayments)' : '🌐 Другие варианты', 'pay_cloud')]
            ])
        );
    });

    bot.action(['pay_sbp', 'pay_mir', 'pay_visa', 'pay_cloud'], async (ctx) => {
        try {
            await ctx.answerCbQuery();
        } catch (error) {
            console.log('Ошибка answerCbQuery (устаревший запрос):', error.message);
        }
        const lang = getUserLanguage(ctx);
        const amount = '1000 RUB';

        await ctx.reply(
            lang === 'en' ? `6-month plan: ${amount}` : `Тариф на 6 месяцев: ${amount}`,
            Markup.inlineKeyboard([
                Markup.button.callback(lang === 'en' ? '💳 Pay' : '💳 Оплатить', 'process_payment')
            ])
        );
    });
    
    bot.action('process_payment', async (ctx) => {
        try {
            await ctx.answerCbQuery();
        } catch (error) {
            console.log('Ошибка answerCbQuery (устаревший запрос):', error.message);
        }
        const userId = ctx.chat.id;
        const lang = getUserLanguage(ctx);

        const paymentSuccess = Math.random() > 0.3;

        if (paymentSuccess) {
            addSubscription(userId);
            await ctx.reply(
                lang === 'en'
                    ? `✅ Success! Plan active until ${formatDate(userData.get(userId).subscription)}`
                    : `✅ Успешно! Тариф активен до ${formatDate(userData.get(userId).subscription)}`
            );
        } else {
            await ctx.reply(
                lang === 'en' ? '❌ Payment failed.' : '❌ Платеж не прошел.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('💸 SBP', 'pay_sbp'), Markup.button.callback('💳 MIR Card', 'pay_mir')],
                    [Markup.button.callback('💳 Visa, Mastercard', 'pay_visa'), Markup.button.callback('🌐 Other (CloudPayments)', 'pay_cloud')]
                ])
            );
        }
    });

    bot.action(/vin_ok_(.+)/, async (ctx) => {
        const lang = getUserLanguage(ctx);
        try {
            await ctx.answerCbQuery(lang === 'en' ? 'VIN confirmed!' : 'VIN подтвержден!');
        } catch (error) {
            console.log('Ошибка answerCbQuery (устаревший запрос):', error.message);
        }
        const userId = ctx.chat.id;
        initUser(userId);
        const user = userData.get(userId);
        const vin = ctx.match[1];
        
        await sendVinLinks(ctx, vin);
        
        await processVIN(ctx, vin, { fromPhoto: true });
    });

    bot.action(/vin_wrong_(.+)/, async (ctx) => {
        const lang = getUserLanguage(ctx);
        try {
            await ctx.answerCbQuery(lang === 'en' ? 'Please try again!' : 'Попробуйте ещё раз!');
        } catch (error) {
            console.log('Ошибка answerCbQuery (устаревший запрос):', error.message);
        }
        const userId = ctx.chat.id;
        initUser(userId);
        const user = userData.get(userId);
        // await ctx.reply(
        //     lang === 'en'
        //         ? `You have used ${user.checks} of ${freeLimit} free recognitions.\n\nSend a photo of the VIN code • I will also find the VIN or lot # in a text message.`
        //         : `Вы использовали ${user.checks} из ${freeLimit} бесплатных распознаваний.\n\nОтправьте фото вин-кода • также найду VIN или # лота в текстовом сообщении.`,
        //     { parse_mode: 'HTML' }
        // );
    });


    bot.command('grant_unlimited', async (ctx) => {
        const lang = getUserLanguage(ctx);
        if (ctx.chat.id.toString() !== ADMIN_CHAT_ID) {
            return ctx.reply(lang === 'en' ? '❌ Access denied.' : '❌ Доступ запрещен.');
        }

        const targetUserId = ctx.message.text.split(' ')[1];
        if (!targetUserId) {
            return ctx.reply(lang === 'en' ? '❌ Specify user ID: /grant_unlimited <user_id>' : '❌ Укажите ID пользователя: /grant_unlimited <user_id>');
        }

        initUser(targetUserId);
        addSubscription(targetUserId);

        const user = userData.get(targetUserId);
        await ctx.reply(lang === 'en' ? `✅ Unlimited access granted to user \`${targetUserId}\` until ${formatDate(user.subscription)}` : `✅ Пользователю \`${targetUserId}\` предоставлен безлимит до ${formatDate(user.subscription)}`);
    });

    bot.on('message', async (ctx) => {
        const lang = getUserLanguage(ctx);
        await ctx.reply((lang === 'en' ? 'Message received! Type: ' : 'Любое сообщение принято! Тип: ') + ctx.updateType);
    });

    bot.catch((err, ctx) => {
        console.error(`❌ Error for ${ctx.updateType}:`, err);
    });
}

async function sendVinLinks(ctx, vin) {
    const lang = getUserLanguage(ctx);
    const googleUrl = `https://www.google.com/search?q=%22${vin}%22`;
    const statVinUrl = `https://stat.vin/cars/${vin}`;
    const auctionHistoryUrl = `https://auctionhistory.io/item/${vin}`;
    const carCheckVinUrl = `https://carcheckvin.com/automobile/${vin}`;
    const bidcarsUrl = `https://bid.cars/`;
    const hideAutoVinUrl = `https://hideautovin.com/`;
    const plcAuctionUrl = `https://plc.auction/`;
    
    let linksMessage;
    if (lang === 'en') {
        linksMessage =
            `🔗 <b>Quick Links:</b>\n` +
            `<a href="${googleUrl}">Google</a>\n\n` +
            `<a href="${statVinUrl}">Stat.vin</a> • <a href="${auctionHistoryUrl}">AuctionHistory</a> • <a href="${carCheckVinUrl}">CarCheckVin</a>\n\n` +
            `🔗 <b>Copy and search manually:</b>\n` +
            `<a href="${bidcarsUrl}">Bid.cars</a> • <a href="${hideAutoVinUrl}">HideAutoVin</a> • <a href="${plcAuctionUrl}">PLC Auction</a>`;
    } else {
        linksMessage =
            `🔗 <b>Быстрые ссылки:</b>\n` +
            `<a href="${googleUrl}">Google</a>\n\n` +
            `<a href="${statVinUrl}">Stat.vin</a> • <a href="${auctionHistoryUrl}">AuctionHistory</a> • <a href="${carCheckVinUrl}">CarCheckVin</a>\n\n` +
            `🔗 <b>Для поиска вручную:</b>\n` +
            `<a href="${bidcarsUrl}">Bid.cars</a> • <a href="${hideAutoVinUrl}">HideAutoVin</a> • <a href="${plcAuctionUrl}">PLC Auction</a>`;
    }
    await ctx.reply(linksMessage, { parse_mode: 'HTML' });
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function manualTranslateToRussian(text) {
    if (!text) return text;
    const dict = {
        'Final known bid': 'Финальная ставка',
        'Auction Fees': 'Аукционные сборы',
        'Copart, sold on': 'Copart, продан',
        'Copart, sold': 'Copart, продан',
        'IAAI, sold on': 'IAAI, продан',
        'IAAI, sold': 'IAAI, продан',
        'Seller': 'Продавец',
        'Sale doc': 'Тайтл',
        'Loss': 'Тип потери',
        'Primary damage': 'Первичное повреждение',
        'Secondary damage': 'Вторичное повреждение',
        'Mileage': 'Пробег',
        'Start code': 'Запуск',
        'Key': 'Ключ',
        'Present': 'Присутствующий',
        'ACV': 'ACV',
        'ERC': 'ERC',
        'Engine': 'Двигатель',
        'Location': 'Местоположение',
        'Shipping from': 'Отправка из',
        'Clear (Michigan)': 'Чистый (Мичиган)',
        'Run and Drive': 'На ходу',
        'not found': 'не найдено',
        'Bid:': 'Ставка:',
        'Title:': 'Тайтл:',
        'Port:': 'Порт:',
        'Sale history': 'История продаж',
        'Title': 'Тайтл',
        'sold June': 'продан',
        'sold on': 'продан',
        'Fees': 'Сборы',
        'lot': 'лот',
        'Lot:': 'Лот:',
        'mi (': 'миль (',
        'km)': 'км)',
        'Insurance Company': 'Страховая компания',
        'Cert of title slvg rebuildable (FL)': 'Сертификат о праве собственности, восстановленный (Флорида)',
        'Clear': 'Чистый',
        'Collision': 'Столкновение',
        'Front end': 'Передняя часть',
        'Left side': 'Левая часть',
        'unknown': 'неизвестно',
        'no data': 'нет данных',
    };
    let result = text;
    for (const [en, ru] of Object.entries(dict)) {
        result = result.replace(new RegExp(escapeRegExp(en), 'gi'), ru);
    }
    return result;
}

module.exports = { registerHandlers };
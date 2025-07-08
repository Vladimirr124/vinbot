const { OpenAI } = require('openai');
const fs = require('fs');
const mime = require('mime-types');
const { OPENAI_API_KEY } = require('./config');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 120000 });

async function analyzeScreenshotsWithGPT(imagePaths, isVin = false, lang = 'ru') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.log('Прерывание запроса к OpenAI по таймауту...');
        controller.abort();
    }, 120000); // Увеличим таймаут для нескольких изображений

    try {
        if (!imagePaths || imagePaths.length === 0) {
            console.log('Нет изображений для анализа.');
            return null;
        }

        console.log(`Чтение ${imagePaths.length} изображений для GPT...`);
        const userContent = [];

        for (const imagePath of imagePaths) {
            try {
                const buffer = fs.readFileSync(imagePath);
                const base64Image = buffer.toString('base64');
                const mimeType = mime.lookup(imagePath);
                userContent.push({
                    type: 'image_url',
                    image_url: { url: `data:${mimeType};base64,${base64Image}` },
                });
            } catch (readError) {
                console.error(`Не удалось прочитать или закодировать изображение ${imagePath}:`, readError.message);
                // Пропускаем это изображение и продолжаем с остальными
            }
        }
        
        if (userContent.length === 0) {
            console.log('Не удалось обработать ни одного изображения.');
            return null;
        }
        
        const systemPrompt = isVin
            ? (lang === 'en'
                ? 'You are an OCR interpreter. The image may contain a VIN code. Try to recognize the VIN code, even if it is partially readable or contains errors. If you cannot see the VIN, write "VIN not recognized". If you managed to find the VIN, reply with only the VIN code. If you could not recognize it, reply: "error".'
                : 'Ты OCR-интерпретатор. На фото может быть изображён VIN-код. Попробуй распознать VIN-код, даже если он частично читаем или содержит ошибки. Если VIN не видно, напиши "VIN не распознан". Если тебе удалось найти вин, отправляй в ответ только сам vin код. Если тебе не удались распознать, пиши в ответ : "error" ')
            : (lang === 'en'
                ? 'You are an OCR interpreter. The image should contain a car auction card from bid.cars (but if it is not there, or you see inscriptions like "not found" or "nothing was found", just reply: "not found"). Extract the lot data (mileage, bid amounts, make, model, year, VIN, lot number, final bid, auction fees, auction, sale date, seller, sale doc, loss, primary and secondary damage, start code, key, ACV, ERC, engine, location, port, sales history) and return in the following format (if some data is missing, that is fine, just write all available data, and for missing fields put a dash):\n2023 PORSCHE MACAN, S\nWP1AG2A55PLB35553\nFinal Bid: $21,000, Fees: $1550\n\n🚙\nMileage: 27 587 mi (44 397 km)\n2.9L, 6 cyl., 375HP, AT\nGasoline, All wheel drive\nPrimary damage: Front end\nSecondary damage: –\nStart code: Run and Drive\nKey: Present\nACV $67,661 / ERC $51,853\n\n📄\n1-55955125\nCopart, sold on 3 June, 2025\nSeller: State Farm Insurance\nSales History: 1\nSale doc: Salvage certificate (IL)\nLocation: Long Island (NY)  \nPort: Newark (NJ)  \nLoss: –'
                : 'Ты OCR-интерпретатор. На изображении — должна быть карточка автомобиля с аукциона bid.cars (но если ее там нет, или ты видишь надписи по типу "не найдено" или "nothing was found" то так и пиши - "не найдено"). Извлеки данные лота (пробег, суммы торгов, марка, модель, год, VIN, номер лота, финальная ставка, аукционные сборы, аукцион, дата продажи, продавец, тайтл, тип потери, первичное и вторичное повреждение, запуск, ключ, ACV, ERC, двигатель, местоположение, порт, история продаж) и верни в формате (если каких-то данных не было — это нормально, просто напиши, что вот все доступные мне данные, те, которых не было просто поставь прочерк):\n2023 PORSCHE MACAN, S\nWP1AG2A55PLB35553\nСтавка $21,000, сборы $1550\n\n🚙\nПробег: 27 587 миль (44 397 км)\n2.9L, 6 cyl., 375HP, AT\nБензиновый, Полный привод\nПовреждение: Передняя часть\nДоп. повреждение: –\nЗапуск: На ходу\nКлюч: Присутствующий\nACV $67,661 / ERC $51,853\n\n📄\n1-55955125\nCopart, продан 3 июня, 2025\nПродавец: State Farm Insurance\nИстория продаж: 1 \nТайтл: Salvage certificate (IL)\nЛокация: Long Island (NY)  \nПорт: Newark (NJ)  \nТип списания: –');

        console.log('Отправка изображений в OpenAI...');
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            max_tokens: 1024,
        }, { signal: controller.signal });

        const content = response.choices[0].message.content.trim();
        if (content.toLowerCase() === 'error' || content.toLowerCase().includes('не найдено')) {
            console.log('OpenAI вернул "error" или "не найдено".');
            return null;
        }
        return content;

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('❌ Ошибка GPT: Запрос отменен по таймауту.');
        } else {
            console.error('❌ Ошибка GPT:', error.message);
        }
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function analyzeScreenshotWithGPT(imagePath, isVin = false, textPrompt = null, lang = 'ru') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
      console.log('Прерывание запроса к OpenAI по таймауту...');
      controller.abort();
  }, 90000);

  try {
    if (imagePath === null && textPrompt) {
      // Только текстовый промпт
      const systemPrompt = isVin
        ? (lang === 'en'
            ? 'You are an OCR interpreter. The image may contain a VIN code. Try to recognize the VIN code, even if it is partially readable or contains errors. If you cannot see the VIN, write "VIN not recognized". If you managed to find the VIN, reply with only the VIN code. If you could not recognize it, reply: "error".'
            : 'Ты OCR-интерпретатор. На фото может быть изображён VIN-код. Попробуй распознать VIN-код, даже если он частично читаем или содержит ошибки. Если VIN не видно, напиши "VIN не распознан". Если тебе удалось найти вин, отправляй в ответ только сам vin код. Если тебе не удались распознать, пиши в ответ : "error" ')
        : (lang === 'en'
            ? 'You are an OCR interpreter. The image should contain a car auction card from bid.cars (but if it is not there, or you see inscriptions like "not found" or "nothing was found", just reply: "not found"). Extract the lot data (mileage, bid amounts, make, model, year, VIN, lot number, final bid, auction fees, auction, sale date, seller, sale doc, loss, primary and secondary damage, start code, key, ACV, ERC, engine, location, port, sales history) and return in the following format (if some data is missing, that is fine, just write all available data, and for missing fields put a dash):\n2023 PORSCHE MACAN, S\nWP1AG2A55PLB35553\nFinal Bid: $21,000, Fees: $1550\n\n🚙\nMileage: 27 587 mi (44 397 km)\n2.9L, 6 cyl., 375HP, AT\nGasoline, All wheel drive\nPrimary damage: Front end\nSecondary damage: –\nStart code: Run and Drive\nKey: Present\nACV $67,661 / ERC $51,853\n\n📄\n1-55955125\nCopart, sold on 3 June, 2025\nSeller: State Farm Insurance\nSales History: 1\nSale doc: Salvage certificate (IL)\nLocation: Long Island (NY)  \nPort: Newark (NJ)  \nLoss: –'
            : 'Ты OCR-интерпретатор. На изображении — должна быть карточка автомобиля с аукциона bid.cars (но если ее там нет, или ты видишь надписи по типу "не найдено" или "nothing was found" то так и пиши - "не найдено"). Извлеки данные лота (пробег, суммы торгов, марка, модель, год, VIN, номер лота, финальная ставка, аукционные сборы, аукцион, дата продажи, продавец, тайтл, тип потери, первичное и вторичное повреждение, запуск, ключ, ACV, ERC, двигатель, местоположение, порт, история продаж) и верни в формате (если каких-то данных не было — это нормально, просто напиши, что вот все доступные мне данные, те, которых не было просто поставь прочерк):\n2023 PORSCHE MACAN, S\nWP1AG2A55PLB35553\nСтавка $21,000, сборы $1550\n\n🚙\nПробег: 27 587 миль (44 397 км)\n2.9L, 6 cyl., 375HP, AT\nБензиновый, Полный привод\nПовреждение: Передняя часть\nДоп. повреждение: –\nЗапуск: На ходу\nКлюч: Присутствующий\nACV $67,661 / ERC $51,853\n\n📄\n1-55955125\nCopart, продан 3 июня, 2025\nПродавец: State Farm Insurance\nИстория продаж: 1 \nТайтл: Salvage certificate (IL)\nЛокация: Long Island (NY)  \nПорт: Newark (NJ)  \nТип списания: –');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: textPrompt }
        ],
        max_tokens: isVin ? 200 : 800
      }, { signal: controller.signal });
      const content = response.choices[0].message.content.trim();
      if (content.toLowerCase() === 'error') {
          console.log('OpenAI вернул "error". Считаем, что VIN не распознан.');
          return null;
      }
      return content;
    }
    console.log('Чтение изображения для GPT...');
    const buffer = fs.readFileSync(imagePath);
    const base64Image = buffer.toString('base64');
    const mimeType = mime.lookup(imagePath);

    console.log('Отправка изображения в OpenAI...');
    const systemPrompt = isVin
        ? (lang === 'en'
            ? 'You are an OCR interpreter. The image may contain a VIN code. Try to recognize the VIN code, even if it is partially readable or contains errors. If you cannot see the VIN, write "VIN not recognized". If you managed to find the VIN, reply with only the VIN code. If you could not recognize it, reply: "error".'
            : 'Ты OCR-интерпретатор. На фото может быть изображён VIN-код. Попробуй распознать VIN-код, даже если он частично читаем или содержит ошибки. Если VIN не видно, напиши "VIN не распознан". Если тебе удалось найти вин, отправляй в ответ только сам vin код. Если тебе не удались распознать, пиши в ответ : "error" ')
        : (lang === 'en'
            ? 'You are an OCR interpreter. The image should contain a car auction card from bid.cars (but if it is not there, or you see inscriptions like "not found" or "nothing was found", just reply: "not found"). Extract the lot data (mileage, bid amounts, make, model, year, VIN, lot number, final bid, auction fees, auction, sale date, seller, sale doc, loss, primary and secondary damage, start code, key, ACV, ERC, engine, location, port, sales history) and return in the following format (if some data is missing, that is fine, just write all available data, and for missing fields put a dash):\n2023 PORSCHE MACAN, S\nWP1AG2A55PLB35553\nFinal Bid: $21,000, Fees: $1550\n\n🚙\nMileage: 27 587 mi (44 397 km)\n2.9L, 6 cyl., 375HP, AT\nGasoline, All wheel drive\nPrimary damage: Front end\nSecondary damage: –\nStart code: Run and Drive\nKey: Present\nACV $67,661 / ERC $51,853\n\n📄\n1-55955125\nCopart, sold on 3 June, 2025\nSeller: State Farm Insurance\nSales History: 1\nSale doc: Salvage certificate (IL)\nLocation: Long Island (NY)  \nPort: Newark (NJ)  \nLoss: –'
            : 'Ты OCR-интерпретатор. На изображении — должна быть карточка автомобиля с аукциона bid.cars (но если ее там нет, или ты видишь надписи по типу "не найдено" или "nothing was found" то так и пиши - "не найдено"). Извлеки данные лота (пробег, суммы торгов, марка, модель, год, VIN, номер лота, финальная ставка, аукционные сборы, аукцион, дата продажи, продавец, тайтл, тип потери, первичное и вторичное повреждение, запуск, ключ, ACV, ERC, двигатель, местоположение, порт, история продаж) и верни в формате (если каких-то данных не было — это нормально, просто напиши, что вот все доступные мне данные, те, которых не было просто поставь прочерк):\n2023 PORSCHE MACAN, S\nWP1AG2A55PLB35553\nСтавка $21,000, сборы $1550\n\n🚙\nПробег: 27 587 миль (44 397 км)\n2.9L, 6 cyl., 375HP, AT\nБензиновый, Полный привод\nПовреждение: Передняя часть\nДоп. повреждение: –\nЗапуск: На ходу\nКлюч: Присутствующий\nACV $67,661 / ERC $51,853\n\n📄\n1-55955125\nCopart, продан 3 июня, 2025\nПродавец: State Farm Insurance\nИстория продаж: 1 \nТайтл: Salvage certificate (IL)\nЛокация: Long Island (NY)  \nПорт: Newark (NJ)  \nТип списания: –');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` }
            }
          ]
        }
      ],
      max_tokens: isVin ? 200 : 800
    }, { signal: controller.signal });

    const content = response.choices[0].message.content.trim();
    if (content.toLowerCase() === 'error') {
        console.log('OpenAI вернул "error". Считаем, что VIN не распознан.');
        return null;
    }
    return content;
  } catch (error) {
    if (error.name === 'AbortError') {
        console.error('❌ Ошибка GPT: Запрос отменен по таймауту.');
    } else {
        console.error('❌ Ошибка GPT:', error.message);
    }
    return null;
  } finally {
      clearTimeout(timeoutId);
  }
}

async function translateTextWithGPT(text, targetLang = 'en') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
        const prompt = targetLang === 'en'
            ? 'Translate the following text to English. Only return the translation, without any comments or explanations.'
            : 'Переведи следующий текст на русский. Только перевод, без комментариев.';
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: text }
            ],
            max_tokens: 1024
        }, { signal: controller.signal });
        return response.choices[0].message.content.trim();
    } catch (error) {
        return text;
    } finally {
        clearTimeout(timeoutId);
    }
}

module.exports = { analyzeScreenshotWithGPT, analyzeScreenshotsWithGPT, translateTextWithGPT }; 
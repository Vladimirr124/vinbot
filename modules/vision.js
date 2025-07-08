const { ImageAnnotatorClient } = require('@google-cloud/vision');

const visionClient = new ImageAnnotatorClient({ keyFilename: process.env.GOOGLE_VISION_KEY_PATH });

async function recognizeVinWithGoogleVision(imagePath) {
    try {
      console.log('Распознавание VIN с помощью Google Vision...');
      const [result] = await visionClient.textDetection(imagePath);
      const detections = result.textAnnotations;
      if (detections && detections.length > 0) {
        const text = detections[0].description;
        // Просто ищем первый попавшийся 17-значный код
        const vinRegex = /[A-Z0-9]{17}/i;
        const match = text.match(vinRegex);
        if (match) {
            const vin = match[0].toUpperCase();
            console.log(`✅ Google Vision нашел VIN: ${vin}`);
            return vin;
        }
      }
      console.log('🔍 Google Vision не нашел 17-значный код.');
      return null;
    } catch (error) {
      console.error('❌ Ошибка Google Vision:', error.message);
      return null;
    }
}

module.exports = { recognizeVinWithGoogleVision }; 
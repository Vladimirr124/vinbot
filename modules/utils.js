const sharp = require('sharp');
const { userData } = require('./state');

function formatDate(date) {
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function getUserLanguage(ctx) {
  const user = userData.get(ctx.chat?.id);
  if (user && user.lang) return user.lang;
  return ctx.from?.language_code?.startsWith('en') ? 'en' : 'ru';
}

async function preprocessImage(inputPath) {
    const outputPath = `${inputPath}-processed.png`;
    await sharp(inputPath)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .sharpen()
      .normalize()
      .toFile(outputPath);
    return outputPath;
}

module.exports = {
    formatDate,
    getUserLanguage,
    preprocessImage
}; 
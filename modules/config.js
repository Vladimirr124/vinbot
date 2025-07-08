require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const SCREENSHOT_FOLDER = path.resolve(__dirname, '../screenshots');
if (!fs.existsSync(SCREENSHOT_FOLDER)) {
    fs.mkdirSync(SCREENSHOT_FOLDER, { recursive: true });
}

// const freeLimit = 20;

const backupSites = [
  'https://carcheckvin.com/automobile/',
  'https://epicvin.com/ru/check-vin-number-and-get-the-vehicle-history-report/checkout/',
  'https://auctionhistory.io/item/',
  'https://atlanticexpress.com.ua/search/?q=',
  'https://autoauctionhistory.com/',
  'https://auctionauto.kg/auction/',
  'https://auctionauto.org/',
  'https://auctionauto.com.ua/',
  'https://www.automobileauctioneers.com/ru/',
  'https://en.autoconsultant.com.ua/',
  'https://autobidcar.com/',
  'https://en.bidhistory.org/',
  'https://bidspace.info/pl',
  'https://www.carbidarchive.com/',
  'https://carpastlife.com/',
  'https://carfast.express/',
  'https://carcheck.by/',
  'https://checkcar.vin/es/en',
  'https://en.bidfax.info/',
  'https://hideautovin.com/',
  'https://import-motor.com/',
  'https://plc.auction/',
  'https://stat.vin/',
  'https://ucars.pro/ru',
  'https://usa-auto-online.com/',
  'https://vincheck.by/',
  'https://vinreport.pro/',
  'https://vin.rip/',
  'https://vinfax.ru/en'
];

module.exports = {
    BOT_TOKEN,
    OPENAI_API_KEY,
    ADMIN_CHAT_ID,
    SCREENSHOT_FOLDER,
    // freeLimit,
    backupSites,
    PAYMENT_PROVIDER_TOKEN: process.env.PAYMENT_PROVIDER_TOKEN
}; 
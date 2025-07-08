const { Telegraf } = require('telegraf');
const { BOT_TOKEN } = require('./modules/config');
const { registerHandlers } = require('./modules/handlers');

const bot = new Telegraf(BOT_TOKEN, { telegram: { apiTimeout: 120000 } });

registerHandlers(bot);

bot.launch().then(() => {
    console.log('🤖 @bolbatvinbot запущен!');
}).catch(err => {
    console.error('❌ Не удалось запустить бота:', err);
});
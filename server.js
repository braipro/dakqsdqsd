const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

// تكوين السيرفر
const config = {
  rtmpServer: 'rtmps://dc4-1.rtmp.t.me/s/',
  streamKey: '2731950212:Io2iCI22_YBU-uXdmRdReQ',
  telegramToken: '8177861125:AAEwyzuzOkkZqxwnzSGU8YKpy_OO0_A1GgQ',
  adminId: 7345253225,
  tempDir: './temp'
};

// إنشاء مجلد مؤقت إذا لم يكن موجودًا
if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir);
}

const app = express();
const port = process.env.PORT || 3000;
const bot = new TelegramBot(config.telegramToken, {polling: true});

// حالة البث الحالي
let currentStream = null;
let currentVideoUrl = null;

// أوامر التليجرام
bot.onText(/\/start/, (msg) => {
  if (msg.chat.id != config.adminId) return;
  
  bot.sendMessage(msg.chat.id, `
🎥 نظام التحكم في البث المباشر
  
الأوامر المتاحة:
/startlive - بدء البث المباشر
/setvid [رابط] - تعيين رابط الفيديو
/stoplive - إيقاف البث الحالي
/status - عرض حالة البث
  `);
});

bot.onText(/\/startlive/, async (msg) => {
  if (msg.chat.id != config.adminId) return;
  
  if (!currentVideoUrl) {
    return bot.sendMessage(msg.chat.id, '⚠️ لم يتم تعيين رابط فيديو! استخدم /setvid أولاً');
  }
  
  if (currentStream) {
    return bot.sendMessage(msg.chat.id, '⚠️ يوجد بث نشط بالفعل! استخدم /stoplive أولاً');
  }
  
  try {
    bot.sendMessage(msg.chat.id, '⏳ جاري بدء البث...');
    
    const rtmpUrl = `${config.rtmpServer}${config.streamKey}`;
    
    currentStream = ffmpeg(currentVideoUrl)
      .inputOptions([
        '-re',
        '-stream_loop -1'
      ])
      .videoCodec('libx264')
      .audioCodec('aac')
      .format('flv')
      .output(rtmpUrl)
      .on('start', (cmd) => {
        console.log('بدأ البث: ' + cmd);
        bot.sendMessage(msg.chat.id, `✅ بدأ البث بنجاح!\nرابط الفيديو: ${currentVideoUrl}`);
      })
      .on('error', (err) => {
        console.error('خطأ في البث:', err);
        bot.sendMessage(msg.chat.id, `❌ خطأ في البث: ${err.message}`);
        currentStream = null;
      })
      .on('end', () => {
        bot.sendMessage(msg.chat.id, '⏹️ توقف البث');
        currentStream = null;
      })
      .run();
      
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ فشل بدء البث: ${err.message}`);
    currentStream = null;
  }
});

bot.onText(/\/setvid (.+)/, (msg, match) => {
  if (msg.chat.id != config.adminId) return;
  
  currentVideoUrl = match[1];
  bot.sendMessage(msg.chat.id, `✅ تم تعيين رابط الفيديو:\n${currentVideoUrl}`);
});

bot.onText(/\/stoplive/, (msg) => {
  if (msg.chat.id != config.adminId) return;
  
  if (!currentStream) {
    return bot.sendMessage(msg.chat.id, '⚠️ لا يوجد بث نشط حالياً');
  }
  
  currentStream.kill('SIGINT');
  currentStream = null;
  bot.sendMessage(msg.chat.id, '✅ تم إيقاف البث بنجاح');
});

bot.onText(/\/status/, (msg) => {
  if (msg.chat.id != config.adminId) return;
  
  const status = currentStream 
    ? `🟢 بث نشط\nرابط الفيديو: ${currentVideoUrl}`
    : '🔴 لا يوجد بث نشط';
  
  bot.sendMessage(msg.chat.id, status);
});

// نقطة نهاية للتحقق من صحة السيرفر
app.get('/', (req, res) => {
  res.json({
    status: 'يعمل',
    streaming: currentStream ? true : false,
    video: currentVideoUrl || 'لم يتم التعيين'
  });
});

app.listen(port, () => {
  console.log(`✅ السيرفر يعمل على المنفذ ${port}`);
});

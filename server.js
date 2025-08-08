// live-stream-bot.js
const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');

const TOKEN = '8177861125:AAEwyzuzOkkZqxwnzSGU8YKpy_OO0_A1GgQ';
const AUTHORIZED_USER_ID = 7345253225;

const RTMP_URL = 'rtmps://dc4-1.rtmp.t.me/s/';
const STREAM_KEY = '2731950212:Io2iCI22_YBU-uXdmRdReQ';

let videoUrl = null;
let ffmpegProcess = null;

const bot = new TelegramBot(TOKEN, { polling: true });

// Check authorization
function isAuthorized(msg) {
  return msg.from && msg.from.id === AUTHORIZED_USER_ID;
}

// Handlers
bot.onText(/\/setvid (.+)/, (msg, match) => {
  if (!isAuthorized(msg)) return;
  videoUrl = match[1];
  bot.sendMessage(msg.chat.id, `✅ تم تعيين رابط الفيديو:\n${videoUrl}`);
});

bot.onText(/\/startlive/, (msg) => {
  if (!isAuthorized(msg)) return;
  if (!videoUrl) return bot.sendMessage(msg.chat.id, `❌ لم يتم تعيين رابط الفيديو. استخدم /setvid أولا.`);

  if (ffmpegProcess) return bot.sendMessage(msg.chat.id, '⚠️ البث جارٍ بالفعل.');

  const fullRtmp = `${RTMP_URL}${STREAM_KEY}`;

  const ffmpegArgs = [
    '-re',
    '-i', videoUrl,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-max_muxing_queue_size', '1024',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'flv',
    fullRtmp,
  ];

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  ffmpegProcess.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code}`);
    ffmpegProcess = null;
  });

  bot.sendMessage(msg.chat.id, `✅ بدأ البث المباشر إلى تيليغرام`);
});

bot.onText(/\/stoplive/, (msg) => {
  if (!isAuthorized(msg)) return;

  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGINT');
    ffmpegProcess = null;
    bot.sendMessage(msg.chat.id, `🛑 تم إيقاف البث.`);
  } else {
    bot.sendMessage(msg.chat.id, `⚠️ لا يوجد بث مباشر نشط.`);
  }
});

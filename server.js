const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  rtmpEndpoint: 'rtmps://dc4-1.rtmp.t.me/s/2731950212:Io2iCI22_YBU-uXdmRdReQ',
  telegramToken: '8177861125:AAEwyzuzOkkZqxwnzSGU8YKpy_OO0_A1GgQ',
  adminId: 7345253225,
  tempDir: './temp'
};

// Create temp directory if it doesn't exist
if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir);
}

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Initialize Telegram Bot
const bot = new TelegramBot(config.telegramToken, {polling: true});

// State management
let currentStream = null;
let currentVideoUrl = null;

// Telegram bot commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId != config.adminId) {
    return bot.sendMessage(chatId, 'Unauthorized access.');
  }
  
  bot.sendMessage(chatId, 'Welcome to the RTMP Streamer Bot!\n\nAvailable commands:\n/startlive - Start the live stream\n/setvid [url] - Set the video URL\n/stoplive - Stop the current stream\n/status - Check current stream status');
});

bot.onText(/\/startlive/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId != config.adminId) {
    return bot.sendMessage(chatId, 'Unauthorized access.');
  }
  
  if (!currentVideoUrl) {
    return bot.sendMessage(chatId, 'No video URL set. Please use /setvid first.');
  }
  
  if (currentStream) {
    return bot.sendMessage(chatId, 'A stream is already running. Use /stoplive first.');
  }
  
  startStream(chatId);
});

bot.onText(/\/setvid (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (chatId != config.adminId) {
    return bot.sendMessage(chatId, 'Unauthorized access.');
  }
  
  const videoUrl = match[1];
  currentVideoUrl = videoUrl;
  bot.sendMessage(chatId, `Video URL set to: ${videoUrl}`);
});

bot.onText(/\/stoplive/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId != config.adminId) {
    return bot.sendMessage(chatId, 'Unauthorized access.');
  }
  
  if (!currentStream) {
    return bot.sendMessage(chatId, 'No active stream to stop.');
  }
  
  stopStream(chatId);
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId != config.adminId) {
    return bot.sendMessage(chatId, 'Unauthorized access.');
  }
  
  const status = currentStream 
    ? `Stream is active\nVideo: ${currentVideoUrl}` 
    : 'No active stream';
  
  bot.sendMessage(chatId, status);
});

// Stream management functions
function startStream(chatId) {
  bot.sendMessage(chatId, 'Starting stream...');
  
  try {
    currentStream = ffmpeg(currentVideoUrl)
      .inputFormat('mp4')
      .videoCodec('libx264')
      .audioCodec('aac')
      .format('flv')
      .output(config.rtmpEndpoint)
      .on('start', (commandLine) => {
        console.log('Spawned FFmpeg with command: ' + commandLine);
        bot.sendMessage(chatId, `Stream started with video: ${currentVideoUrl}`);
      })
      .on('error', (err, stdout, stderr) => {
        console.error('Error:', err);
        console.error('FFmpeg stderr:', stderr);
        bot.sendMessage(chatId, `Stream error: ${err.message}`);
        currentStream = null;
      })
      .on('end', () => {
        console.log('Stream finished');
        bot.sendMessage(chatId, 'Stream finished');
        currentStream = null;
      })
      .run();
  } catch (err) {
    console.error('Stream setup error:', err);
    bot.sendMessage(chatId, `Failed to start stream: ${err.message}`);
    currentStream = null;
  }
}

function stopStream(chatId) {
  if (currentStream) {
    currentStream.kill('SIGINT');
    currentStream = null;
    bot.sendMessage(chatId, 'Stream stopped successfully.');
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    streaming: currentStream !== null,
    video: currentVideoUrl
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  if (currentStream) {
    currentStream.kill('SIGINT');
  }
  process.exit();
});

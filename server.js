const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const fileUpload = require('express-fileupload');

const app = express();
app.use(express.json());
app.use(fileUpload());

// Telegram Bot Configuration
const TELEGRAM_TOKEN = '8177861125:AAEwyzuzOkkZqxwnzSGU8YKpy_OO0_A1GgQ';
const AUTHORIZED_TG_ID = '7345253225';
const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});

// DHD Credentials
const DHD_EMAIL = 'Ghirsubs@gmail.com';
const DHD_PASSWORD = 'Ghirsubs@gmail.com';

const PORT = process.env.PORT || 3000;

// Create downloads directory if it doesn't exist
if (!fs.existsSync('./downloads')) {
    fs.mkdirSync('./downloads');
}

// Telegram Bot Command Handler
bot.onText(/\/GETFILE/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check if user is authorized
    if (String(msg.from.id) !== AUTHORIZED_TG_ID) {
        return bot.sendMessage(chatId, '⛔ Unauthorized access. Your ID: ' + msg.from.id);
    }

    try {
        bot.sendMessage(chatId, '⏳ Starting file download from DHD platform...');
        
        const filePath = await downloadDhdFile();
        
        if (!filePath) {
            return bot.sendMessage(chatId, '❌ Failed to download file from DHD platform');
        }

        // Send the file via Telegram
        await bot.sendDocument(chatId, filePath, {}, {
            filename: 'DHD_Export_' + new Date().toISOString().split('T')[0] + '.xlsx'
        });

        bot.sendMessage(chatId, '✅ File successfully downloaded and sent');
        
        // Clean up
        fs.unlinkSync(filePath);

    } catch (error) {
        console.error('Telegram bot error:', error);
        bot.sendMessage(chatId, '❌ Error: ' + error.message);
    }
});

// Function to download file from DHD platform
async function downloadDhdFile() {
    let browser;
    try {
        // Launch Puppeteer browser
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // Set user agent to mimic a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36');

        // Navigate to login page
        await page.goto('https://platform.dhd-dz.com/login', { waitUntil: 'networkidle2' });

        // Fill in login form
        await page.type('#email', DHD_EMAIL);
        await page.type('#password', DHD_PASSWORD);
        await page.click('#submit-button');

        // Wait for navigation to home page
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // Navigate to export page
        await page.goto('https://platform.dhd-dz.com/export', { waitUntil: 'networkidle2' });

        // Set the current state to "Expédiés" (value 3)
        await page.select('#current_state', '3');

        // Get current date in YYYY-MM-DD format
        const today = new Date();
        const currentDate = today.toISOString().split('T')[0];
        
        // Set start date to January 1st of current year
        const startDate = `${today.getFullYear()}-01-01`;
        
        // Set date range
        await page.evaluate((startDate, currentDate) => {
            document.getElementById('date_start').value = startDate;
            document.getElementById('date_end').value = currentDate;
        }, startDate, currentDate);

        // Set operation to "Livraison" (value 1)
        await page.select('#operation', '1');

        // Wait for a moment to ensure all selections are processed
        await page.waitForTimeout(1000);

        // Set up file download
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: path.resolve('./downloads')
        });

        // Click download button
        await page.click('#submit');

        // Wait for download to complete
        const downloadedFile = await waitForDownload('./downloads');

        return downloadedFile;

    } catch (error) {
        console.error('Error during DHD automation:', error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Helper function to wait for download
function waitForDownload(downloadPath) {
    return new Promise((resolve, reject) => {
        const maxWaitTime = 30000; // 30 seconds
        const interval = 500; // check every 500ms
        let elapsed = 0;

        const checkForFile = () => {
            const files = fs.readdirSync(downloadPath);
            const excelFile = files.find(file => 
                file.endsWith('.xlsx') || file.endsWith('.xls') || file.endsWith('.csv')
            );

            if (excelFile) {
                resolve(path.join(downloadPath, excelFile));
            } else if (elapsed >= maxWaitTime) {
                reject(new Error('Download timeout'));
            } else {
                elapsed += interval;
                setTimeout(checkForFile, interval);
            }
        };

        checkForFile();
    });
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Telegram bot is listening for /GETFILE command`);
});

#!/usr/bin/env node

import express from 'express';
import session from 'express-session';
import multer from 'multer';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// تكوين الجلسات
app.use(session({
    secret: 'AnaDom3301-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 ساعة
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// تخزين المستخدمين النشطين
const activeUsers = new Map();
const MAX_USERS = 10;
const PASSWORD = 'AnaDom3301';

// فئة مدقق الواتساب
class WhatsAppChecker {
    constructor(options = {}) {
        this.options = {
            delay: parseInt(options.delay) || 1000,
            maxRetries: parseInt(options.retries) || 3,
            ...options
        };
        
        this.numbers = [];
        this.proxies = [];
        this.currentProxyIndex = 0;
        this.results = [];
        this.stats = {
            checked: 0,
            withWhatsApp: 0,
            withoutWhatsApp: 0,
            errors: 0
        };
        this.isRunning = false;
    }

    cleanPhoneNumber(number) {
        // إزالة جميع المسافات، +، -، والأحرف غير رقمية
        return number.replace(/[\s+\-()]/g, '');
    }

    setNumbers(numbers) {
        this.numbers = numbers
            .map(line => this.cleanPhoneNumber(line.trim()))
            .filter(line => line && !line.startsWith('#'))
            .filter(line => /^\d+$/.test(line));
    }

    setProxies(proxies) {
        this.proxies = proxies
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .filter(line => line.includes(':') || line.startsWith('http'));
    }

    getNextProxy() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        return proxy;
    }

    createAxiosInstance(proxy) {
        const config = {
            timeout: 30000,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'Priority': 'u=1, i',
                'Referer': 'https://umnico.com/tools/whatsapp-checker/',
                'Sec-Ch-Ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
            }
        };

        if (proxy) {
            try {
                let proxyUrl = proxy;
                if (!proxy.startsWith('http')) {
                    proxyUrl = `http://${proxy}`;
                }
                config.httpsAgent = new HttpsProxyAgent(proxyUrl);
                config.proxy = false;
            } catch (error) {
                console.log(`⚠ Invalid proxy format: ${proxy}`);
            }
        }

        return axios.create(config);
    }

    async checkNumber(phoneNumber, retryCount = 0) {
        const proxy = this.getNextProxy();
        
        try {
            const axiosInstance = this.createAxiosInstance(proxy);
            const url = `https://umnico.com/api/tools/checker?phone=${phoneNumber}`;
            
            const response = await axiosInstance.get(url);
            
            if (response.data && typeof response.data.exists === 'boolean') {
                return {
                    success: true,
                    phone: phoneNumber,
                    exists: response.data.exists,
                    proxy: proxy || 'direct'
                };
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            if (retryCount < this.options.maxRetries) {
                await this.delay(500);
                return this.checkNumber(phoneNumber, retryCount + 1);
            }
            
            return {
                success: false,
                phone: phoneNumber,
                error: error.message,
                proxy: proxy || 'direct'
            };
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async startChecking(onProgress, onComplete) {
        this.isRunning = true;
        this.stats = { checked: 0, withWhatsApp: 0, withoutWhatsApp: 0, errors: 0 };
        
        for (const number of this.numbers) {
            if (!this.isRunning) break;

            const result = await this.checkNumber(number);
            this.results.push(result);
            
            if (result.success) {
                if (result.exists) {
                    this.stats.withWhatsApp++;
                } else {
                    this.stats.withoutWhatsApp++;
                }
            } else {
                this.stats.errors++;
            }

            this.stats.checked++;
            
            if (onProgress) {
                onProgress({
                    ...this.stats,
                    currentNumber: number,
                    progress: (this.stats.checked / this.numbers.length) * 100
                });
            }
            
            if (this.stats.checked < this.numbers.length) {
                await this.delay(this.options.delay);
            }
        }

        this.isRunning = false;
        if (onComplete) {
            onComplete(this.results);
        }
    }

    stopChecking() {
        this.isRunning = false;
    }

    getResultsCSV() {
        const lines = this.results.map(result => {
            if (result.success) {
                return `${result.phone},${result.exists ? 'YES' : 'NO'}`;
            } else {
                return `${result.phone},ERROR,${result.error}`;
            }
        });
        return 'Phone Number,WhatsApp Status,Error\n' + lines.join('\n');
    }
}

// Middleware للتحقق من المصادقة
function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        // تحديث وقت النشاط
        if (activeUsers.has(req.session.userId)) {
            activeUsers.get(req.session.userId).lastActive = Date.now();
        }
        next();
    } else {
        res.redirect('/login');
    }
}

// تنظيف المستخدمين غير النشطين
function cleanInactiveUsers() {
    const now = Date.now();
    const inactiveTime = 5 * 60 * 1000; // 5 دقائق
    
    for (const [userId, userData] of activeUsers.entries()) {
        if (now - userData.lastActive > inactiveTime) {
            activeUsers.delete(userId);
        }
    }
}

// المسارات
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    if (req.session.authenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    
    cleanInactiveUsers();
    
    if (password === PASSWORD) {
        if (activeUsers.size >= MAX_USERS) {
            return res.json({ 
                success: false, 
                message: 'الخادم ممتلئ حالياً (10 مستخدمين). يرجى المحاولة لاحقاً أو شراء النسخة المدفوعة' 
            });
        }
        
        const userId = Date.now().toString();
        req.session.authenticated = true;
        req.session.userId = userId;
        
        activeUsers.set(userId, {
            lastActive: Date.now(),
            userAgent: req.get('User-Agent')
        });
        
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }
});

app.post('/logout', requireAuth, (req, res) => {
    if (activeUsers.has(req.session.userId)) {
        activeUsers.delete(req.session.userId);
    }
    req.session.destroy();
    res.json({ success: true });
});

app.get('/status', requireAuth, (req, res) => {
    cleanInactiveUsers();
    res.json({
        activeUsers: activeUsers.size,
        maxUsers: MAX_USERS
    });
});

app.post('/check', requireAuth, async (req, res) => {
    const { numbers, proxies, delay, retries } = req.body;
    
    if (!req.session.checker) {
        req.session.checker = new WhatsAppChecker({ delay, retries });
    }
    
    const checker = req.session.checker;
    
    try {
        checker.setNumbers(numbers.split('\n'));
        checker.setProxies(proxies.split('\n'));
        
        if (checker.numbers.length === 0) {
            return res.json({ success: false, message: 'لم يتم العثور على أرقام صالحة' });
        }
        
        res.json({ 
            success: true, 
            message: `بدأ التحقق من ${checker.numbers.length} رقم` 
        });
        
        // بدء التحقق في الخلفية
        checker.startChecking(
            (progress) => {
                // إرسال التحديثات عبر SSE أو WebSocket (سيتم تنفيذها لاحقاً)
            },
            (results) => {
                // حفظ النتائج في الجلسة
                req.session.results = results;
            }
        );
        
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

app.get('/results', requireAuth, (req, res) => {
    if (!req.session.checker || !req.session.checker.results) {
        return res.status(404).json({ error: 'لا توجد نتائج متاحة' });
    }
    
    const csv = req.session.checker.getResultsCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=results.csv');
    res.send(csv);
});

app.get('/progress', requireAuth, (req, res) => {
    if (!req.session.checker) {
        return res.json({ running: false });
    }
    
    const checker = req.session.checker;
    res.json({
        running: checker.isRunning,
        stats: checker.stats,
        total: checker.numbers.length
    });
});

app.post('/stop', requireAuth, (req, res) => {
    if (req.session.checker) {
        req.session.checker.stopChecking();
    }
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🚀 WaChecker By Anadom V 0.1 running on port ${PORT}`);
    console.log(`🔐 Password: ${PASSWORD}`);
    console.log(`👥 Max users: ${MAX_USERS}`);
    console.log(`💝 Support: TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y (USDT TRC20)`);
});

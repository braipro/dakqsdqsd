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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// تكوين الجلسات
app.use(session({
    secret: 'AnaDom3301-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// تكوين multer لرفع الملفات
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const userDir = path.join(__dirname, 'uploads', req.session.userId || 'temp');
        cb(null, userDir);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// تخزين المستخدمين النشطين ومدققات الواتساب
const activeUsers = new Map();
const userCheckers = new Map();
const MAX_USERS = 10;
const PASSWORD = 'AnaDom3301';

// فئة مدقق الواتساب (مبنية على السكريبت الأصلي)
class WhatsAppChecker {
    constructor(userId, options = {}) {
        this.userId = userId;
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
        return number.replace(/[\s+\-()]/g, '');
    }

    async loadFiles(numbersFile, proxiesFile) {
        try {
            // تحميل الأرقام
            const numbersContent = await fs.readFile(numbersFile, 'utf8');
            this.numbers = numbersContent
                .split('\n')
                .map(line => this.cleanPhoneNumber(line.trim()))
                .filter(line => line && !line.startsWith('#'))
                .filter(line => /^\d+$/.test(line));

            console.log(`Loaded ${this.numbers.length} phone numbers`);

            // تحميل البروكسيات
            const proxiesContent = await fs.readFile(proxiesFile, 'utf8');
            this.proxies = proxiesContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .filter(line => line.includes(':') || line.startsWith('http'));

            console.log(`Loaded ${this.proxies.length} proxies`);

            return true;
        } catch (error) {
            console.error('Error loading files:', error.message);
            return false;
        }
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
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
            }
        };

        if (proxy) {
            try {
                // استخدام الوكيل بشكل مبسط
                let proxyUrl = proxy;
                if (!proxy.startsWith('http')) {
                    proxyUrl = `http://${proxy}`;
                }
                const [host, port] = proxyUrl.replace('http://', '').split(':');
                config.proxy = {
                    protocol: 'http',
                    host: host,
                    port: parseInt(port) || 8080
                };
            } catch (error) {
                console.log(`Invalid proxy format: ${proxy}`);
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

    async startChecking() {
        this.isRunning = true;
        this.stats = { checked: 0, withWhatsApp: 0, withoutWhatsApp: 0, errors: 0 };
        this.results = [];
        
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
            
            // حفظ النتائج بعد كل رقم
            await this.saveResults();
            
            if (this.stats.checked < this.numbers.length) {
                await this.delay(this.options.delay);
            }
        }

        this.isRunning = false;
        return this.results;
    }

    async saveResults() {
        try {
            const output = this.results.map(result => {
                if (result.success) {
                    return `${result.phone},${result.exists ? 'YES' : 'NO'}`;
                } else {
                    return `${result.phone},ERROR,${result.error}`;
                }
            }).join('\n');
            
            const header = 'Phone Number,WhatsApp Status,Error\n';
            const outputFile = path.join(__dirname, 'uploads', this.userId, 'results.csv');
            await fs.writeFile(outputFile, header + output);
        } catch (error) {
            console.error('Error saving results:', error.message);
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
    if (req.session.authenticated && activeUsers.has(req.session.userId)) {
        // تحديث وقت النشاط
        activeUsers.get(req.session.userId).lastActive = Date.now();
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
            userCheckers.delete(userId);
            // تنظيف ملفات المستخدم
            const userDir = path.join(__dirname, 'uploads', userId);
            fs.rm(userDir, { recursive: true, force: true }).catch(() => {});
        }
    }
}

// إنشاء مجلد التحميلات
async function ensureUploadsDir() {
    try {
        await fs.access(path.join(__dirname, 'uploads'));
    } catch {
        await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
    }
}

// المسارات
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    if (req.session.authenticated && activeUsers.has(req.session.userId)) {
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

        // إنشاء مجلد للمستخدم
        ensureUploadsDir().then(() => {
            const userDir = path.join(__dirname, 'uploads', userId);
            return fs.mkdir(userDir, { recursive: true });
        }).catch(console.error);
        
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }
});

app.post('/logout', requireAuth, (req, res) => {
    const userId = req.session.userId;
    if (activeUsers.has(userId)) {
        activeUsers.delete(userId);
    }
    if (userCheckers.has(userId)) {
        userCheckers.delete(userId);
    }
    // تنظيف ملفات المستخدم
    const userDir = path.join(__dirname, 'uploads', userId);
    fs.rm(userDir, { recursive: true, force: true }).catch(() => {});
    
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

// رفع ملف الأرقام
app.post('/upload-numbers', requireAuth, upload.single('numbersFile'), (req, res) => {
    if (!req.file) {
        return res.json({ success: false, message: 'لم يتم اختيار ملف' });
    }
    req.session.numbersFile = req.file.path;
    res.json({ success: true, message: 'تم رفع ملف الأرقام بنجاح' });
});

// رفع ملف البروكسيات
app.post('/upload-proxies', requireAuth, upload.single('proxiesFile'), (req, res) => {
    if (!req.file) {
        return res.json({ success: false, message: 'لم يتم اختيار ملف' });
    }
    req.session.proxiesFile = req.file.path;
    res.json({ success: true, message: 'تم رفع ملف البروكسيات بنجاح' });
});

app.post('/check', requireAuth, async (req, res) => {
    const { delay, retries } = req.body;
    const userId = req.session.userId;
    
    if (!req.session.numbersFile || !req.session.proxiesFile) {
        return res.json({ success: false, message: 'يرجى رفع ملف الأرقام وملف البروكسيات أولاً' });
    }

    try {
        const checker = new WhatsAppChecker(userId, { delay, retries });
        userCheckers.set(userId, checker);

        const filesLoaded = await checker.loadFiles(req.session.numbersFile, req.session.proxiesFile);
        if (!filesLoaded) {
            return res.json({ success: false, message: 'خطأ في تحميل الملفات' });
        }

        if (checker.numbers.length === 0) {
            return res.json({ success: false, message: 'لم يتم العثور على أرقام صالحة' });
        }

        res.json({ 
            success: true, 
            message: `بدأ التحقق من ${checker.numbers.length} رقم` 
        });
        
        // بدء التحقق في الخلفية
        checker.startChecking().then(() => {
            console.log(`User ${userId} completed checking`);
        }).catch(error => {
            console.error(`User ${userId} error:`, error);
        });
        
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

app.get('/results', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userCheckers.get(userId);
    
    if (!checker || !checker.results || checker.results.length === 0) {
        return res.status(404).json({ error: 'لا توجد نتائج متاحة' });
    }
    
    const csv = checker.getResultsCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=results.csv');
    res.send(csv);
});

app.get('/progress', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userCheckers.get(userId);
    
    if (!checker) {
        return res.json({ running: false });
    }
    
    res.json({
        running: checker.isRunning,
        stats: checker.stats,
        total: checker.numbers.length
    });
});

app.post('/stop', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userCheckers.get(userId);
    
    if (checker) {
        checker.stopChecking();
        res.json({ success: true, message: 'تم إيقاف عملية التحقق' });
    } else {
        res.json({ success: false, message: 'لا توجد عملية تحقق قيد التشغيل' });
    }
});

// مسار الصحة للخادم
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// التأكد من وجود المجلدات الضرورية
ensureUploadsDir().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 WaChecker By Anadom V 0.1 running on port ${PORT}`);
        console.log(`🔐 Password: ${PASSWORD}`);
        console.log(`👥 Max users: ${MAX_USERS}`);
        console.log(`💝 Support: TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y (USDT TRC20)`);
    });
}).catch(console.error);

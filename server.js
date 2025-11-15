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

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// Session configuration - 1 hour only
app.use(session({
    secret: 'AnaDom3301-secret-key-' + Math.random().toString(36),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 60 * 60 * 1000, // 1 hour only
        httpOnly: true
    }
}));

// Storage configuration
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        const userDir = path.join(__dirname, 'uploads', req.session.userId || 'temp');
        await fs.mkdir(userDir, { recursive: true });
        cb(null, userDir);
    },
    filename: function (req, file, cb) {
        const timestamp = Date.now();
        cb(null, `${timestamp}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
            cb(null, true);
        } else {
            cb(new Error('Only .txt files are allowed'), false);
        }
    }
});

// Authentication & User Management
const activeUsers = new Map();
const MAX_USERS = 10;
const PASSWORD = 'AnaDom3301';
const WHATSAPP_CONTACT = 'https://wa.me/19177281677';
const TELEGRAM_CONTACT = 'https://t.me/MrAnadom';

// WhatsApp Checker Class (Enhanced with better proxy handling)
class WhatsAppChecker {
    constructor(userId, options = {}) {
        this.userId = userId;
        this.options = {
            delay: parseInt(options.delay) || 2000,
            maxRetries: parseInt(options.retries) || 3,
            ...options
        };
        
        this.numbers = [];
        this.proxies = [];
        this.currentProxyIndex = 0;
        this.results = [];
        this.whatsappNumbers = [];
        this.stats = {
            checked: 0,
            withWhatsApp: 0,
            withoutWhatsApp: 0,
            errors: 0
        };
        this.isRunning = false;
        
        // User Agents list without external dependency
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0'
        ];
    }

    cleanPhoneNumber(number) {
        return number.replace(/[\s+\-()]/g, '');
    }

    async loadFiles(numbersFilePath, proxiesFilePath) {
        try {
            // Load numbers
            const numbersContent = await fs.readFile(numbersFilePath, 'utf8');
            this.numbers = numbersContent
                .split('\n')
                .map(line => this.cleanPhoneNumber(line.trim()))
                .filter(line => line && !line.startsWith('#'))
                .filter(line => /^\d+$/.test(line));

            console.log(`User ${this.userId}: Loaded ${this.numbers.length} phone numbers`);

            // Load proxies
            if (proxiesFilePath && await fs.access(proxiesFilePath).then(() => true).catch(() => false)) {
                const proxiesContent = await fs.readFile(proxiesFilePath, 'utf8');
                this.proxies = proxiesContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'))
                    .filter(line => {
                        // Validate proxy format
                        if (line.startsWith('http')) return true;
                        const parts = line.split(':');
                        return parts.length >= 2 && !isNaN(parts[1]);
                    });

                console.log(`User ${this.userId}: Loaded ${this.proxies.length} proxies`);
            } else {
                console.log(`User ${this.userId}: No proxies file, using direct connection`);
                this.proxies = [];
            }

            return this.numbers.length > 0;
        } catch (error) {
            console.error(`User ${this.userId}: Error loading files -`, error.message);
            return false;
        }
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    getNextProxy() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        return proxy;
    }

    createAxiosInstance(proxy) {
        const config = {
            timeout: 15000,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'User-Agent': this.getRandomUserAgent(),
                'Referer': 'https://web.whatsapp.com/',
                'Origin': 'https://web.whatsapp.com',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            },
            validateStatus: function (status) {
                return status < 500;
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
                console.log(`Invalid proxy format: ${proxy} - ${error.message}`);
            }
        }

        return axios.create(config);
    }

    async checkNumber(phoneNumber, retryCount = 0) {
        const proxy = this.getNextProxy();
        
        try {
            const axiosInstance = this.createAxiosInstance(proxy);
            
            // Try multiple WhatsApp checking methods
            const checkMethods = [
                {
                    url: `https://web.whatsapp.com/check?phone=${phoneNumber}`,
                    validator: (data) => data && (data.exists === true || data.valid === true)
                },
                {
                    url: `https://api.whatsapp.com/send?phone=${phoneNumber}`,
                    validator: (data, response) => response.status === 200
                },
                {
                    url: `https://wa.me/${phoneNumber}`,
                    validator: (data, response) => response.status === 200
                }
            ];

            for (const method of checkMethods) {
                try {
                    const response = await axiosInstance.get(method.url);
                    
                    if (method.validator(response.data, response)) {
                        return {
                            success: true,
                            phone: phoneNumber,
                            exists: true,
                            proxy: proxy || 'direct',
                            method: method.url
                        };
                    }
                } catch (error) {
                    continue;
                }
            }

            // If all methods fail, consider number as not having WhatsApp
            return {
                success: true,
                phone: phoneNumber,
                exists: false,
                proxy: proxy || 'direct'
            };

        } catch (error) {
            if (retryCount < this.options.maxRetries) {
                console.log(`Retry ${retryCount + 1} for ${phoneNumber}`);
                await this.delay(1000);
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
        this.whatsappNumbers = [];
        
        console.log(`User ${this.userId}: Starting check for ${this.numbers.length} numbers`);
        
        for (const number of this.numbers) {
            if (!this.isRunning) {
                console.log(`User ${this.userId}: Checking stopped by user`);
                break;
            }

            try {
                const result = await this.checkNumber(number);
                this.results.push(result);
                
                if (result.success) {
                    if (result.exists) {
                        this.stats.withWhatsApp++;
                        this.whatsappNumbers.push(number);
                        console.log(`User ${this.userId}: ${number} - HAS WhatsApp ✓`);
                    } else {
                        this.stats.withoutWhatsApp++;
                        console.log(`User ${this.userId}: ${number} - NO WhatsApp ✗`);
                    }
                } else {
                    this.stats.errors++;
                    console.log(`User ${this.userId}: ${number} - ERROR: ${result.error}`);
                }

                this.stats.checked++;
                
                // Save results every 5 numbers
                if (this.stats.checked % 5 === 0) {
                    await this.saveResults();
                }
                
                // Delay between requests
                if (this.stats.checked < this.numbers.length) {
                    await this.delay(this.options.delay);
                }
            } catch (error) {
                this.stats.errors++;
                this.results.push({
                    success: false,
                    phone: number,
                    error: error.message
                });
                this.stats.checked++;
                console.log(`User ${this.userId}: ${number} - EXCEPTION: ${error.message}`);
            }
        }

        // Save final results
        await this.saveResults();
        this.isRunning = false;
        
        console.log(`User ${this.userId}: Checking completed - ${this.stats.withWhatsApp} numbers with WhatsApp`);
        return this.results;
    }

    async saveResults() {
        try {
            const userDir = path.join(__dirname, 'uploads', this.userId);
            await fs.mkdir(userDir, { recursive: true });

            // Save WhatsApp numbers only (TXT file)
            const whatsappContent = this.whatsappNumbers.join('\n');
            await fs.writeFile(path.join(userDir, 'whatsapp_numbers.txt'), whatsappContent);

            // Save full results CSV
            const csvContent = this.results.map(result => {
                if (result.success) {
                    return `${result.phone},${result.exists ? 'YES' : 'NO'}`;
                } else {
                    return `${result.phone},ERROR,${result.error}`;
                }
            }).join('\n');
            
            const csvHeader = 'Phone Number,WhatsApp Status,Error\n';
            await fs.writeFile(path.join(userDir, 'full_results.csv'), csvHeader + csvContent);

        } catch (error) {
            console.error('Error saving results:', error.message);
        }
    }

    stopChecking() {
        this.isRunning = false;
    }

    getWhatsAppNumbersTXT() {
        return this.whatsappNumbers.join('\n');
    }

    getFullResultsCSV() {
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

// Authentication Middleware
function requireAuth(req, res, next) {
    if (req.session.authenticated && activeUsers.has(req.session.userId)) {
        activeUsers.get(req.session.userId).lastActive = Date.now();
        next();
    } else {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required. Please login again.' 
            });
        } else {
            return res.redirect('/login');
        }
    }
}

// Clean inactive users
function cleanInactiveUsers() {
    const now = Date.now();
    const inactiveTime = 60 * 60 * 1000; // 1 hour
    
    for (const [userId, userData] of activeUsers.entries()) {
        if (now - userData.lastActive > inactiveTime) {
            activeUsers.delete(userId);
            const userDir = path.join(__dirname, 'uploads', userId);
            fs.rm(userDir, { recursive: true, force: true }).catch(() => {});
            console.log(`Cleaned inactive user: ${userId}`);
        }
    }
}

// Ensure uploads directory exists
async function ensureUploadsDir() {
    try {
        await fs.access(path.join(__dirname, 'uploads'));
    } catch {
        await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
    }
}

// User session management
const userSessions = new Map();

// Routes
app.get('/', (req, res) => {
    if (req.session.authenticated && activeUsers.has(req.session.userId)) {
        return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    } else {
        return res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    if (req.session.authenticated && activeUsers.has(req.session.userId)) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API Routes
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    
    cleanInactiveUsers();
    
    if (password === PASSWORD) {
        if (activeUsers.size >= MAX_USERS) {
            return res.status(429).json({ 
                success: false, 
                message: `Server is at full capacity (${MAX_USERS} users). Please try again later or contact us on WhatsApp to purchase your private version: ${WHATSAPP_CONTACT}` 
            });
        }
        
        const userId = Date.now().toString();
        req.session.authenticated = true;
        req.session.userId = userId;
        
        activeUsers.set(userId, {
            lastActive: Date.now(),
            userAgent: req.get('User-Agent'),
            ip: req.ip
        });
        
        console.log(`New user logged in: ${userId}, Total: ${activeUsers.size}`);
        
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.post('/api/logout', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    if (activeUsers.has(userId)) {
        activeUsers.delete(userId);
    }
    if (userSessions.has(userId)) {
        userSessions.delete(userId);
    }
    
    const userDir = path.join(__dirname, 'uploads', userId);
    fs.rm(userDir, { recursive: true, force: true }).catch(() => {});
    
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/status', requireAuth, (req, res) => {
    cleanInactiveUsers();
    res.json({
        activeUsers: activeUsers.size,
        maxUsers: MAX_USERS,
        userStatus: 'active',
        sessionTimeout: 60 // minutes
    });
});

// File upload endpoints
app.post('/api/upload/numbers', requireAuth, upload.single('numbersFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file selected' });
        }

        req.session.numbersFile = req.file.path;
        
        const content = await fs.readFile(req.file.path, 'utf8');
        const numbers = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .filter(line => /^\d+$/.test(line.replace(/[\s+\-()]/g, '')));

        res.json({ 
            success: true, 
            message: 'Numbers file uploaded successfully',
            filename: req.file.originalname,
            count: numbers.length
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: 'Upload failed: ' + error.message });
    }
});

app.post('/api/upload/proxies', requireAuth, upload.single('proxiesFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file selected' });
        }

        req.session.proxiesFile = req.file.path;
        
        const content = await fs.readFile(req.file.path, 'utf8');
        const proxies = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        res.json({ 
            success: true, 
            message: 'Proxies file uploaded successfully',
            filename: req.file.originalname,
            count: proxies.length
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, message: 'Upload failed: ' + error.message });
    }
});

// Check endpoints
app.post('/api/check/start', requireAuth, async (req, res) => {
    const { delay, retries } = req.body;
    const userId = req.session.userId;
    
    if (!req.session.numbersFile) {
        return res.status(400).json({ success: false, message: 'Please upload numbers file first' });
    }

    try {
        const checker = new WhatsAppChecker(userId, { delay, retries });
        userSessions.set(userId, checker);

        const filesLoaded = await checker.loadFiles(
            req.session.numbersFile, 
            req.session.proxiesFile
        );

        if (!filesLoaded || checker.numbers.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid numbers found in the file' });
        }

        res.json({ 
            success: true, 
            message: `Started checking ${checker.numbers.length} numbers`,
            totalNumbers: checker.numbers.length
        });
        
        // Start checking in background
        checker.startChecking().then((results) => {
            console.log(`User ${userId} completed checking`);
            // Set completion flag for Telegram redirect
            req.session.checkingCompleted = true;
        }).catch(error => {
            console.error(`User ${userId} checking error:`, error);
        });
        
    } catch (error) {
        console.error('Check start error:', error);
        res.status(500).json({ success: false, message: 'Failed to start checking: ' + error.message });
    }
});

app.get('/api/check/progress', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userSessions.get(userId);
    
    if (!checker) {
        return res.json({ 
            running: false,
            stats: { checked: 0, withWhatsApp: 0, withoutWhatsApp: 0, errors: 0 },
            total: 0,
            progress: 0
        });
    }
    
    const response = {
        running: checker.isRunning,
        stats: checker.stats,
        total: checker.numbers.length,
        progress: checker.numbers.length > 0 ? (checker.stats.checked / checker.numbers.length) * 100 : 0
    };

    // If checking just completed, include Telegram link
    if (!checker.isRunning && checker.stats.checked > 0 && checker.stats.checked === checker.numbers.length) {
        response.completed = true;
        response.telegramLink = TELEGRAM_CONTACT;
        response.supportReminder = "Please consider supporting the development!";
    }
    
    res.json(response);
});

app.post('/api/check/stop', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userSessions.get(userId);
    
    if (checker) {
        checker.stopChecking();
        res.json({ success: true, message: 'Checking stopped' });
    } else {
        res.status(404).json({ success: false, message: 'No active checking session found' });
    }
});

// Download endpoints with support reminder
app.get('/api/download/whatsapp-numbers', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userSessions.get(userId);
    
    if (!checker || !checker.results || checker.results.length === 0) {
        return res.status(404).json({ error: 'No results available' });
    }
    
    const txtContent = checker.getWhatsAppNumbersTXT();
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=whatsapp_numbers.txt');
    
    // Add support reminder as header comment
    const contentWithReminder = `# WhatsApp Numbers Checked by WaChecker Pro\n# Please consider supporting the developer!\n# Support USDT TRC20: TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y\n# Contact: ${TELEGRAM_CONTACT}\n\n${txtContent}`;
    
    res.send(contentWithReminder);
});

app.get('/api/download/full-results', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userSessions.get(userId);
    
    if (!checker || !checker.results || checker.results.length === 0) {
        return res.status(404).json({ error: 'No results available' });
    }
    
    const csvContent = checker.getFullResultsCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=full_results.csv');
    
    // Add support reminder as header comment
    const contentWithReminder = `# Full Results - WhatsApp Checker Pro\n# Please consider supporting the developer!\n# Support USDT TRC20: TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y\n# Contact: ${TELEGRAM_CONTACT}\n\n${csvContent}`;
    
    res.send(contentWithReminder);
});

// Support information endpoint
app.get('/api/support', (req, res) => {
    res.json({
        whatsapp: WHATSAPP_CONTACT,
        telegram: TELEGRAM_CONTACT,
        usdt: 'TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y',
        message: 'Thank you for considering supporting our development!'
    });
});

// Health check
app.get('/api/health', (req, res) => {
    cleanInactiveUsers();
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeUsers: activeUsers.size,
        maxUsers: MAX_USERS,
        sessionTimeout: '1 hour'
    });
});

// Handle all other routes
app.get('*', (req, res) => {
    if (req.session.authenticated && activeUsers.has(req.session.userId)) {
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    } else {
        res.redirect('/login');
    }
});

// Initialize server
ensureUploadsDir().then(() => {
    // Clean inactive users every 30 minutes
    setInterval(cleanInactiveUsers, 30 * 60 * 1000);
    
    app.listen(PORT, () => {
        console.log('🚀 WhatsApp Checker Professional Edition - Enhanced');
        console.log(`📍 Server running on port ${PORT}`);
        console.log(`🔐 Access Password: ${PASSWORD}`);
        console.log(`👥 Max Concurrent Users: ${MAX_USERS}`);
        console.log(`⏰ Session Timeout: 1 hour`);
        console.log(`📞 WhatsApp Contact: ${WHATSAPP_CONTACT}`);
        console.log(`📱 Telegram Contact: ${TELEGRAM_CONTACT}`);
        console.log('💝 Support USDT TRC20: TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y');
        console.log('✅ Server is ready with enhanced proxy support!');
    });
}).catch(console.error);

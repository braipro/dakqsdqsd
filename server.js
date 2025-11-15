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

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: 'AnaDom3301-secret-key-' + Math.random().toString(36),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000,
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
        fileSize: 10 * 1024 * 1024 // 10MB limit
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

// WhatsApp Checker Class (Enhanced)
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
        this.whatsappNumbers = [];
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
            const proxiesContent = await fs.readFile(proxiesFilePath, 'utf8');
            this.proxies = proxiesContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .filter(line => line.includes(':') || line.startsWith('http'));

            console.log(`User ${this.userId}: Loaded ${this.proxies.length} proxies`);

            return this.numbers.length > 0;
        } catch (error) {
            console.error(`User ${this.userId}: Error loading files -`, error.message);
            return false;
        }
    }

    getNextProxy() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        return proxy;
    }

    createAxiosConfig(proxy) {
        const config = {
            timeout: 30000,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://web.whatsapp.com/',
                'Origin': 'https://web.whatsapp.com'
            }
        };

        if (proxy) {
            try {
                let proxyUrl = proxy;
                if (!proxy.startsWith('http')) {
                    proxyUrl = `http://${proxy}`;
                }
                config.proxy = proxyUrl;
            } catch (error) {
                console.log(`Invalid proxy format: ${proxy}`);
            }
        }

        return config;
    }

    async checkNumber(phoneNumber, retryCount = 0) {
        const proxy = this.getNextProxy();
        
        try {
            const config = this.createAxiosConfig(proxy);
            // Using multiple endpoints for better accuracy
            const endpoints = [
                `https://web.whatsapp.com/check?phone=${phoneNumber}`,
                `https://api.whatsapp.com/send?phone=${phoneNumber}`,
                `https://umnico.com/api/tools/checker?phone=${phoneNumber}`
            ];

            for (const endpoint of endpoints) {
                try {
                    const response = await axios.get(endpoint, config);
                    
                    // Check various response patterns that indicate WhatsApp presence
                    if (response.status === 200) {
                        const responseData = response.data;
                        const responseText = JSON.stringify(responseData).toLowerCase();
                        
                        const whatsappIndicators = [
                            'whatsapp', 'wa.me', 'exists', 'true', 'valid',
                            'success', 'ok', 'found', 'active'
                        ];
                        
                        const hasWhatsApp = whatsappIndicators.some(indicator => 
                            responseText.includes(indicator)
                        );

                        if (hasWhatsApp) {
                            return {
                                success: true,
                                phone: phoneNumber,
                                exists: true,
                                proxy: proxy || 'direct',
                                endpoint: endpoint
                            };
                        }
                    }
                } catch (error) {
                    continue; // Try next endpoint
                }
            }

            // If all endpoints fail, consider it as not having WhatsApp
            return {
                success: true,
                phone: phoneNumber,
                exists: false,
                proxy: proxy || 'direct'
            };

        } catch (error) {
            if (retryCount < this.options.maxRetries) {
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
        
        for (const number of this.numbers) {
            if (!this.isRunning) break;

            try {
                const result = await this.checkNumber(number);
                this.results.push(result);
                
                if (result.success) {
                    if (result.exists) {
                        this.stats.withWhatsApp++;
                        this.whatsappNumbers.push(number);
                    } else {
                        this.stats.withoutWhatsApp++;
                    }
                } else {
                    this.stats.errors++;
                }

                this.stats.checked++;
                
                // Save results after each check
                await this.saveResults();
                
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
            }
        }

        this.isRunning = false;
        return this.results;
    }

    async saveResults() {
        try {
            const userDir = path.join(__dirname, 'uploads', this.userId);
            await fs.mkdir(userDir, { recursive: true });

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

            // Save WhatsApp numbers only (TXT file)
            const whatsappContent = this.whatsappNumbers.join('\n');
            await fs.writeFile(path.join(userDir, 'whatsapp_numbers.txt'), whatsappContent);

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
        // Update last activity
        activeUsers.get(req.session.userId).lastActive = Date.now();
        next();
    } else {
        res.redirect('/login');
    }
}

// Clean inactive users
function cleanInactiveUsers() {
    const now = Date.now();
    const inactiveTime = 10 * 60 * 1000; // 10 minutes
    
    for (const [userId, userData] of activeUsers.entries()) {
        if (now - userData.lastActive > inactiveTime) {
            activeUsers.delete(userId);
            // Clean user files
            const userDir = path.join(__dirname, 'uploads', userId);
            fs.rm(userDir, { recursive: true, force: true }).catch(() => {});
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
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/login', (req, res) => {
    if (req.session.authenticated && activeUsers.has(req.session.userId)) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    
    cleanInactiveUsers();
    
    if (password === PASSWORD) {
        if (activeUsers.size >= MAX_USERS) {
            return res.status(429).json({ 
                success: false, 
                message: 'Server is currently at full capacity (10 users). Please try again later or consider upgrading.' 
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
    
    // Clean user files
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
        userStatus: 'active'
    });
});

// File upload endpoints
app.post('/api/upload/numbers', requireAuth, upload.single('numbersFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        req.session.numbersFile = req.file.path;
        res.json({ 
            success: true, 
            message: 'Numbers file uploaded successfully',
            filename: req.file.originalname,
            count: await getLineCount(req.file.path)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/upload/proxies', requireAuth, upload.single('proxiesFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        req.session.proxiesFile = req.file.path;
        res.json({ 
            success: true, 
            message: 'Proxies file uploaded successfully',
            filename: req.file.originalname,
            count: await getLineCount(req.file.path)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

async function getLineCount(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return content.split('\n').filter(line => line.trim()).length;
    } catch {
        return 0;
    }
}

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
            req.session.proxiesFile || path.join(__dirname, 'uploads', 'empty_proxies.txt')
        );

        if (!filesLoaded) {
            return res.status(400).json({ success: false, message: 'Failed to load files or no valid numbers found' });
        }

        res.json({ 
            success: true, 
            message: `Started checking ${checker.numbers.length} numbers`,
            totalNumbers: checker.numbers.length
        });
        
        // Start checking in background
        checker.startChecking().then(() => {
            console.log(`User ${userId} completed checking`);
        }).catch(error => {
            console.error(`User ${userId} checking error:`, error);
        });
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/check/progress', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userSessions.get(userId);
    
    if (!checker) {
        return res.json({ 
            running: false,
            stats: { checked: 0, withWhatsApp: 0, withoutWhatsApp: 0, errors: 0 },
            total: 0
        });
    }
    
    res.json({
        running: checker.isRunning,
        stats: checker.stats,
        total: checker.numbers.length,
        progress: checker.numbers.length > 0 ? (checker.stats.checked / checker.numbers.length) * 100 : 0
    });
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

// Download endpoints
app.get('/api/download/whatsapp-numbers', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userSessions.get(userId);
    
    if (!checker || !checker.results || checker.results.length === 0) {
        return res.status(404).json({ error: 'No results available' });
    }
    
    const txtContent = checker.getWhatsAppNumbersTXT();
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=whatsapp_numbers.txt');
    res.send(txtContent);
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
    res.send(csvContent);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeUsers: activeUsers.size
    });
});

// Initialize server
ensureUploadsDir().then(() => {
    // Create empty proxies file if needed
    const emptyProxiesPath = path.join(__dirname, 'uploads', 'empty_proxies.txt');
    fs.writeFile(emptyProxiesPath, '').catch(() => {});
    
    app.listen(PORT, () => {
        console.log('🚀 WhatsApp Checker Professional Edition');
        console.log(`📍 Server running on port ${PORT}`);
        console.log(`🔐 Access Password: ${PASSWORD}`);
        console.log(`👥 Max Concurrent Users: ${MAX_USERS}`);
        console.log('💝 Support USDT TRC20: TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y');
        console.log('✨ Built with modern UX/UI design');
    });
}).catch(console.error);

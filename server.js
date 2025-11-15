#!/usr/bin/env node

import express from 'express';
import session from 'express-session';
import multer from 'multer';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================
const CONFIG = {
    PASSWORD: 'AnaDom3301',
    MAX_USERS: 10,
    SESSION_TIMEOUT: 60 * 60 * 1000, // 1 hour
    CHECK_DELAY: 1000, // Fixed 1000ms delay
    MAX_RETRIES: 1, // Fixed 1 retry
    WHATSAPP_CONTACT: 'https://wa.me/19177281677',
    TELEGRAM_CONTACT: 'https://t.me/MrAnadom',
    USDT_ADDRESS: 'TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y',
    UPLOAD_LIMITS: {
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 2
    }
};

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    }
}));
app.use(compression());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static('public', {
    maxAge: '1d',
    etag: false
}));

// ==================== SESSION CONFIGURATION ====================
app.use(session({
    name: 'wachecker.session',
    secret: process.env.SESSION_SECRET || 'AnaDom3301-pro-secure-key-' + uuidv4(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: CONFIG.SESSION_TIMEOUT,
        sameSite: 'lax'
    }
}));

// ==================== FILE UPLOAD CONFIGURATION ====================
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const userDir = path.join(__dirname, 'uploads', req.session.userId || 'temp');
        await fs.mkdir(userDir, { recursive: true });
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['text/plain'];
    const allowedExtensions = ['.txt'];
    
    const isTextFile = allowedTypes.includes(file.mimetype);
    const hasTxtExtension = allowedExtensions.some(ext => 
        file.originalname.toLowerCase().endsWith(ext)
    );
    
    if (isTextFile || hasTxtExtension) {
        cb(null, true);
    } else {
        cb(new Error('Only .txt files are allowed'), false);
    }
};

const upload = multer({
    storage,
    limits: CONFIG.UPLOAD_LIMITS,
    fileFilter
});

// ==================== USER & SESSION MANAGEMENT ====================
class UserManager {
    constructor() {
        this.activeUsers = new Map();
        this.userSessions = new Map();
        this.cleanupInterval = setInterval(() => this.cleanInactiveUsers(), 5 * 60 * 1000);
    }

    addUser(userId, userData) {
        this.activeUsers.set(userId, {
            ...userData,
            createdAt: Date.now(),
            lastActive: Date.now()
        });
    }

    removeUser(userId) {
        this.activeUsers.delete(userId);
        this.userSessions.delete(userId);
    }

    getUser(userId) {
        return this.activeUsers.get(userId);
    }

    updateActivity(userId) {
        const user = this.activeUsers.get(userId);
        if (user) {
            user.lastActive = Date.now();
        }
    }

    cleanInactiveUsers() {
        const now = Date.now();
        for (const [userId, userData] of this.activeUsers.entries()) {
            if (now - userData.lastActive > CONFIG.SESSION_TIMEOUT) {
                this.removeUser(userId);
                this.cleanUserFiles(userId);
                console.log(`🧹 Cleaned inactive user: ${userId}`);
            }
        }
    }

    async cleanUserFiles(userId) {
        try {
            const userDir = path.join(__dirname, 'uploads', userId);
            await fs.rm(userDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Error cleaning files for user ${userId}:`, error.message);
        }
    }

    getActiveUserCount() {
        return this.activeUsers.size;
    }

    canAcceptNewUser() {
        return this.activeUsers.size < CONFIG.MAX_USERS;
    }
}

const userManager = new UserManager();

// ==================== WHATSAPP CHECKER ENGINE ====================
class WhatsAppCheckerPro {
    constructor(userId) {
        this.userId = userId;
        this.numbers = [];
        this.proxies = [];
        this.currentProxyIndex = 0;
        this.results = [];
        this.whatsappNumbers = [];
        this.stats = {
            checked: 0,
            withWhatsApp: 0,
            withoutWhatsApp: 0,
            errors: 0,
            startTime: null,
            endTime: null
        };
        this.isRunning = false;
        
        // Advanced User Agents Rotation
        this.userAgents = this.generateUserAgents();
        this.currentAgentIndex = 0;
    }

    generateUserAgents() {
        const chromeVersions = ['120.0.0.0', '119.0.0.0', '118.0.0.0', '117.0.0.0'];
        const firefoxVersions = ['121.0', '120.0', '119.0', '118.0'];
        
        const agents = [];
        
        // Chrome agents
        chromeVersions.forEach(version => {
            agents.push(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`);
            agents.push(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`);
            agents.push(`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`);
        });
        
        // Firefox agents
        firefoxVersions.forEach(version => {
            agents.push(`Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${version}) Gecko/20100101 Firefox/${version}`);
            agents.push(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${version}) Gecko/20100101 Firefox/${version}`);
            agents.push(`Mozilla/5.0 (X11; Linux x86_64; rv:${version}) Gecko/20100101 Firefox/${version}`);
        });
        
        return agents;
    }

    getNextUserAgent() {
        const agent = this.userAgents[this.currentAgentIndex];
        this.currentAgentIndex = (this.currentAgentIndex + 1) % this.userAgents.length;
        return agent;
    }

    cleanPhoneNumber(number) {
        if (!number) return '';
        return number.toString().replace(/[\s+\-()\.]/g, '');
    }

    validatePhoneNumber(number) {
        const cleanNumber = this.cleanPhoneNumber(number);
        return /^\d{8,15}$/.test(cleanNumber);
    }

    async loadFiles(numbersFilePath, proxiesFilePath) {
        try {
            // Load and validate numbers
            const numbersContent = await fs.readFile(numbersFilePath, 'utf8');
            this.numbers = numbersContent
                .split('\n')
                .map(line => this.cleanPhoneNumber(line.trim()))
                .filter(line => line && !line.startsWith('#') && this.validatePhoneNumber(line))
                .slice(0, 10000); // Limit to 10,000 numbers

            console.log(`👤 User ${this.userId}: Loaded ${this.numbers.length} valid phone numbers`);

            // Load proxies
            if (proxiesFilePath && await this.fileExists(proxiesFilePath)) {
                const proxiesContent = await fs.readFile(proxiesFilePath, 'utf8');
                this.proxies = proxiesContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'))
                    .filter(line => this.validateProxy(line))
                    .slice(0, 1000); // Limit to 1,000 proxies

                console.log(`👤 User ${this.userId}: Loaded ${this.proxies.length} valid proxies`);
            } else {
                console.log(`👤 User ${this.userId}: No proxies file, using direct connection`);
                this.proxies = [];
            }

            return this.numbers.length > 0;
        } catch (error) {
            console.error(`❌ User ${this.userId}: Error loading files -`, error.message);
            return false;
        }
    }

    validateProxy(proxy) {
        try {
            if (proxy.startsWith('http')) {
                new URL(proxy);
                return true;
            }
            
            const parts = proxy.split(':');
            if (parts.length >= 2) {
                const port = parseInt(parts[1]);
                return !isNaN(port) && port > 0 && port <= 65535;
            }
            return false;
        } catch {
            return false;
        }
    }

    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
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
            timeout: 15000,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
                'User-Agent': this.getNextUserAgent(),
                'Referer': 'https://web.whatsapp.com/',
                'Origin': 'https://web.whatsapp.com',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'DNT': '1',
                'Upgrade-Insecure-Requests': '1'
            },
            validateStatus: (status) => status < 500
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
                console.log(`⚠️ Invalid proxy format: ${proxy}`);
            }
        }

        return axios.create(config);
    }

    async checkNumber(phoneNumber) {
        const proxy = this.getNextProxy();
        
        try {
            const axiosInstance = this.createAxiosInstance(proxy);
            
            // Enhanced checking with multiple endpoints
            const endpoints = [
                {
                    url: `https://web.whatsapp.com/check?phone=${phoneNumber}`,
                    validator: (data) => data && (data.exists === true || data.valid === true)
                },
                {
                    url: `https://api.whatsapp.com/send?phone=${phoneNumber}`,
                    validator: (data, response) => response.status === 200
                }
            ];

            for (const endpoint of endpoints) {
                try {
                    const response = await axiosInstance.get(endpoint.url);
                    
                    if (endpoint.validator(response.data, response)) {
                        return {
                            success: true,
                            phone: phoneNumber,
                            exists: true,
                            proxy: proxy || 'direct',
                            endpoint: endpoint.url,
                            timestamp: new Date().toISOString()
                        };
                    }
                } catch (error) {
                    continue;
                }
            }

            return {
                success: true,
                phone: phoneNumber,
                exists: false,
                proxy: proxy || 'direct',
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                success: false,
                phone: phoneNumber,
                error: error.message,
                proxy: proxy || 'direct',
                timestamp: new Date().toISOString()
            };
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async startChecking(onProgress, onComplete) {
        this.isRunning = true;
        this.stats = { 
            checked: 0, 
            withWhatsApp: 0, 
            withoutWhatsApp: 0, 
            errors: 0,
            startTime: new Date().toISOString(),
            endTime: null
        };
        this.results = [];
        this.whatsappNumbers = [];
        
        console.log(`🚀 User ${this.userId}: Starting check for ${this.numbers.length} numbers`);
        
        for (let i = 0; i < this.numbers.length; i++) {
            if (!this.isRunning) {
                console.log(`⏹️ User ${this.userId}: Checking stopped by user`);
                break;
            }

            const number = this.numbers[i];
            
            try {
                const result = await this.checkNumber(number);
                this.results.push(result);
                
                if (result.success) {
                    if (result.exists) {
                        this.stats.withWhatsApp++;
                        this.whatsappNumbers.push(number);
                        console.log(`✅ User ${this.userId}: ${number} - HAS WhatsApp`);
                    } else {
                        this.stats.withoutWhatsApp++;
                        console.log(`❌ User ${this.userId}: ${number} - NO WhatsApp`);
                    }
                } else {
                    this.stats.errors++;
                    console.log(`⚠️ User ${this.userId}: ${number} - ERROR: ${result.error}`);
                }

                this.stats.checked++;
                
                // Progress callback
                if (onProgress) {
                    onProgress({
                        current: this.stats.checked,
                        total: this.numbers.length,
                        percentage: ((this.stats.checked / this.numbers.length) * 100).toFixed(1),
                        stats: { ...this.stats },
                        currentNumber: number,
                        recentResult: result
                    });
                }
                
                // Save checkpoint every 10 numbers
                if (this.stats.checked % 10 === 0) {
                    await this.saveCheckpoint();
                }
                
                // Fixed delay of 1000ms
                if (this.stats.checked < this.numbers.length) {
                    await this.delay(CONFIG.CHECK_DELAY);
                }
            } catch (error) {
                this.stats.errors++;
                this.results.push({
                    success: false,
                    phone: number,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                this.stats.checked++;
                console.log(`💥 User ${this.userId}: ${number} - EXCEPTION: ${error.message}`);
            }
        }

        // Final save
        this.stats.endTime = new Date().toISOString();
        await this.saveResults();
        this.isRunning = false;
        
        console.log(`🎉 User ${this.userId}: Checking completed - ${this.stats.withWhatsApp} numbers with WhatsApp`);
        
        if (onComplete) {
            onComplete(this.results, this.stats);
        }
        
        return this.results;
    }

    async saveCheckpoint() {
        try {
            await this.saveResults();
        } catch (error) {
            console.error(`💾 User ${this.userId}: Checkpoint save error:`, error.message);
        }
    }

    async saveResults() {
        try {
            const userDir = path.join(__dirname, 'uploads', this.userId);
            await fs.mkdir(userDir, { recursive: true });

            // Save WhatsApp numbers only
            const whatsappContent = this.whatsappNumbers.join('\n');
            await fs.writeFile(path.join(userDir, 'whatsapp_numbers.txt'), whatsappContent);

            // Save full results with enhanced details
            const csvContent = this.results.map(result => {
                if (result.success) {
                    return `${result.phone},${result.exists ? 'YES' : 'NO'},${result.proxy},${result.timestamp}`;
                } else {
                    return `${result.phone},ERROR,${result.error},${result.timestamp}`;
                }
            }).join('\n');
            
            const csvHeader = 'Phone Number,Status,Proxy,Timestamp\n';
            await fs.writeFile(path.join(userDir, 'full_results.csv'), csvHeader + csvContent);

            // Save statistics
            const statsContent = JSON.stringify(this.stats, null, 2);
            await fs.writeFile(path.join(userDir, 'statistics.json'), statsContent);

        } catch (error) {
            console.error('💾 Error saving results:', error.message);
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
                return `${result.phone},${result.exists ? 'YES' : 'NO'},${result.proxy},${result.timestamp}`;
            } else {
                return `${result.phone},ERROR,${result.error},${result.timestamp}`;
            }
        });
        return 'Phone Number,WhatsApp Status,Proxy,Timestamp\n' + lines.join('\n');
    }

    getStatistics() {
        return this.stats;
    }
}

// ==================== AUTHENTICATION MIDDLEWARE ====================
function requireAuth(req, res, next) {
    if (req.session.authenticated && userManager.getUser(req.session.userId)) {
        userManager.updateActivity(req.session.userId);
        next();
    } else {
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ 
                success: false, 
                message: 'Session expired. Please login again.',
                code: 'SESSION_EXPIRED'
            });
        } else {
            res.redirect('/login');
        }
    }
}

// ==================== ROUTES ====================

// Serve main application
app.get('/', (req, res) => {
    if (req.session.authenticated && userManager.getUser(req.session.userId)) {
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    } else {
        res.redirect('/login');
    }
});

// Serve login page
app.get('/login', (req, res) => {
    if (req.session.authenticated && userManager.getUser(req.session.userId)) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// API Routes
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    
    if (password === CONFIG.PASSWORD) {
        if (!userManager.canAcceptNewUser()) {
            return res.status(429).json({ 
                success: false, 
                message: `Server at maximum capacity (${CONFIG.MAX_USERS} users). Please try again later or contact us for premium version.`,
                contact: CONFIG.WHATSAPP_CONTACT,
                code: 'MAX_USERS_EXCEEDED'
            });
        }
        
        const userId = uuidv4();
        req.session.authenticated = true;
        req.session.userId = userId;
        
        userManager.addUser(userId, {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            loginTime: new Date().toISOString()
        });
        
        console.log(`🔐 New login: ${userId} from ${req.ip}`);
        
        res.json({ 
            success: true, 
            message: 'Login successful',
            user: { id: userId },
            sessionTimeout: CONFIG.SESSION_TIMEOUT
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Invalid password',
            code: 'INVALID_PASSWORD'
        });
    }
});

app.post('/api/logout', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    userManager.removeUser(userId);
    userManager.cleanUserFiles(userId);
    
    req.session.destroy();
    
    res.json({ 
        success: true, 
        message: 'Logged out successfully'
    });
});

app.get('/api/session/status', requireAuth, (req, res) => {
    const user = userManager.getUser(req.session.userId);
    const sessionAge = Date.now() - new Date(user.lastActive);
    
    res.json({
        success: true,
        user: {
            id: req.session.userId,
            loginTime: user.loginTime,
            sessionAge: sessionAge,
            timeRemaining: CONFIG.SESSION_TIMEOUT - sessionAge
        },
        server: {
            activeUsers: userManager.getActiveUserCount(),
            maxUsers: CONFIG.MAX_USERS,
            uptime: process.uptime()
        }
    });
});

// File upload endpoints
app.post('/api/upload/numbers', requireAuth, upload.single('numbersFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'No file uploaded',
                code: 'NO_FILE'
            });
        }

        req.session.numbersFile = req.file.path;
        
        // Quick validation of numbers file
        const content = await fs.readFile(req.file.path, 'utf8');
        const numbers = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .filter(line => /^\d+$/.test(line.replace(/[\s+\-()]/g, '')));

        res.json({ 
            success: true, 
            message: 'Numbers file uploaded and validated successfully',
            data: {
                filename: req.file.originalname,
                numbersCount: numbers.length,
                fileSize: req.file.size,
                uploadTime: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('📤 Upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Upload failed: ' + error.message,
            code: 'UPLOAD_ERROR'
        });
    }
});

app.post('/api/upload/proxies', requireAuth, upload.single('proxiesFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'No file uploaded',
                code: 'NO_FILE'
            });
        }

        req.session.proxiesFile = req.file.path;
        
        const content = await fs.readFile(req.file.path, 'utf8');
        const proxies = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        res.json({ 
            success: true, 
            message: 'Proxies file uploaded successfully',
            data: {
                filename: req.file.originalname,
                proxiesCount: proxies.length,
                fileSize: req.file.size,
                uploadTime: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('📤 Upload error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Upload failed: ' + error.message,
            code: 'UPLOAD_ERROR'
        });
    }
});

// Check management endpoints
app.post('/api/check/start', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    
    if (!req.session.numbersFile) {
        return res.status(400).json({ 
            success: false, 
            message: 'Please upload numbers file first',
            code: 'NO_NUMBERS_FILE'
        });
    }

    try {
        const checker = new WhatsAppCheckerPro(userId);
        userManager.userSessions.set(userId, checker);

        const filesLoaded = await checker.loadFiles(
            req.session.numbersFile, 
            req.session.proxiesFile
        );

        if (!filesLoaded || checker.numbers.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No valid phone numbers found in the file',
                code: 'NO_VALID_NUMBERS'
            });
        }

        res.json({ 
            success: true, 
            message: `Checking initialized for ${checker.numbers.length} numbers`,
            data: {
                totalNumbers: checker.numbers.length,
                totalProxies: checker.proxies.length,
                estimatedTime: Math.ceil((checker.numbers.length * CONFIG.CHECK_DELAY) / 1000 / 60) + ' minutes',
                startTime: new Date().toISOString()
            }
        });
        
        // Start checking in background
        checker.startChecking(
            (progress) => {
                // Progress updates handled via separate endpoint
            },
            (results, stats) => {
                console.log(`🎊 User ${userId} completed checking with ${stats.withWhatsApp} WhatsApp numbers`);
                // Set completion flag
                req.session.lastCheckCompleted = true;
                req.session.lastCheckStats = stats;
            }
        ).catch(error => {
            console.error(`💥 User ${userId} checking error:`, error);
        });
        
    } catch (error) {
        console.error('🚀 Check start error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to start checking: ' + error.message,
            code: 'CHECK_START_ERROR'
        });
    }
});

app.get('/api/check/progress', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userManager.userSessions.get(userId);
    
    if (!checker) {
        return res.json({ 
            success: true,
            data: {
                running: false,
                stats: { checked: 0, withWhatsApp: 0, withoutWhatsApp: 0, errors: 0 },
                total: 0,
                progress: 0,
                currentNumber: null
            }
        });
    }
    
    const stats = checker.getStatistics();
    const progress = checker.numbers.length > 0 ? (stats.checked / checker.numbers.length) * 100 : 0;
    
    const response = {
        success: true,
        data: {
            running: checker.isRunning,
            stats: stats,
            total: checker.numbers.length,
            progress: progress,
            currentNumber: checker.numbers[stats.checked] || null,
            estimatedRemaining: checker.isRunning ? 
                Math.ceil(((checker.numbers.length - stats.checked) * CONFIG.CHECK_DELAY) / 1000 / 60) + ' minutes' : '0 minutes'
        }
    };

    // Add completion info if just finished
    if (!checker.isRunning && stats.checked > 0 && stats.checked === checker.numbers.length) {
        response.data.completed = true;
        response.data.completionTime = stats.endTime;
        response.data.telegramPrompt = true;
    }
    
    res.json(response);
});

app.post('/api/check/stop', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userManager.userSessions.get(userId);
    
    if (checker) {
        checker.stopChecking();
        res.json({ 
            success: true, 
            message: 'Checking stopped successfully',
            data: {
                stoppedAt: new Date().toISOString(),
                progress: ((checker.stats.checked / checker.numbers.length) * 100).toFixed(1) + '%'
            }
        });
    } else {
        res.status(404).json({ 
            success: false, 
            message: 'No active checking session found',
            code: 'NO_ACTIVE_SESSION'
        });
    }
});

// Download endpoints
app.get('/api/download/whatsapp-numbers', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userManager.userSessions.get(userId);
    
    if (!checker || !checker.results || checker.results.length === 0) {
        return res.status(404).json({ 
            success: false,
            message: 'No results available for download',
            code: 'NO_RESULTS'
        });
    }
    
    const txtContent = checker.getWhatsAppNumbersTXT();
    const filename = `whatsapp_numbers_${userId}_${Date.now()}.txt`;
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Support-Address', CONFIG.USDT_ADDRESS);
    res.setHeader('X-Support-Message', 'Consider supporting our development!');
    
    const contentWithHeader = `# WhatsApp Numbers Checked by WaChecker Pro\n# Check completed: ${new Date().toISOString()}\n# Total numbers: ${checker.results.length}\n# With WhatsApp: ${checker.stats.withWhatsApp}\n# Support USDT TRC20: ${CONFIG.USDT_ADDRESS}\n# Contact: ${CONFIG.TELEGRAM_CONTACT}\n\n${txtContent}`;
    
    res.send(contentWithHeader);
});

app.get('/api/download/full-results', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const checker = userManager.userSessions.get(userId);
    
    if (!checker || !checker.results || checker.results.length === 0) {
        return res.status(404).json({ 
            success: false,
            message: 'No results available for download',
            code: 'NO_RESULTS'
        });
    }
    
    const csvContent = checker.getFullResultsCSV();
    const filename = `full_results_${userId}_${Date.now()}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Support-Address', CONFIG.USDT_ADDRESS);
    res.setHeader('X-Support-Message', 'Thank you for supporting our development!');
    
    const contentWithHeader = `# Full Results - WhatsApp Checker Pro\n# Check completed: ${new Date().toISOString()}\n# Total numbers: ${checker.results.length}\n# With WhatsApp: ${checker.stats.withWhatsApp}\n# Without WhatsApp: ${checker.stats.withoutWhatsApp}\n# Errors: ${checker.stats.errors}\n# Support USDT TRC20: ${CONFIG.USDT_ADDRESS}\n# Contact: ${CONFIG.TELEGRAM_CONTACT}\n\n${csvContent}`;
    
    res.send(contentWithHeader);
});

// Support information
app.get('/api/support/info', (req, res) => {
    res.json({
        success: true,
        data: {
            whatsapp: CONFIG.WHATSAPP_CONTACT,
            telegram: CONFIG.TELEGRAM_CONTACT,
            usdt: CONFIG.USDT_ADDRESS,
            message: 'Your support helps us continue development and maintenance!',
            features: [
                'Advanced WhatsApp number checking',
                'Proxy support and rotation',
                'Real-time progress tracking',
                'Session management',
                'Bulk processing capabilities'
            ]
        }
    });
});

// Health check and statistics
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'operational',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            activeUsers: userManager.getActiveUserCount(),
            maxUsers: CONFIG.MAX_USERS,
            version: '2.0.0',
            environment: process.env.NODE_ENV || 'development'
        }
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        code: 'ENDPOINT_NOT_FOUND'
    });
});

// Serve static files for all other routes
app.get('*', (req, res) => {
    if (req.session.authenticated && userManager.getUser(req.session.userId)) {
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    } else {
        res.redirect('/login');
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('💥 Server error:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Maximum size is 50MB.',
                code: 'FILE_TOO_LARGE'
            });
        }
    }
    
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
    });
});

// ==================== SERVER INITIALIZATION ====================
async function initializeServer() {
    try {
        // Ensure uploads directory exists
        await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });
        
        // Start server
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(60));
            console.log('🚀 WA CHECKER PRO - ULTIMATE EDITION');
            console.log('='.repeat(60));
            console.log(`📍 Server running on port ${PORT}`);
            console.log(`🔐 Access Password: ${CONFIG.PASSWORD}`);
            console.log(`👥 Max Concurrent Users: ${CONFIG.MAX_USERS}`);
            console.log(`⏰ Session Timeout: 1 hour`);
            console.log(`⚡ Check Delay: ${CONFIG.CHECK_DELAY}ms`);
            console.log(`🔄 Max Retries: ${CONFIG.MAX_RETRIES}`);
            console.log(`📞 WhatsApp Contact: ${CONFIG.WHATSAPP_CONTACT}`);
            console.log(`📱 Telegram Contact: ${CONFIG.TELEGRAM_CONTACT}`);
            console.log(`💝 Support USDT TRC20: ${CONFIG.USDT_ADDRESS}`);
            console.log('='.repeat(60));
            console.log('✅ Server initialized and ready for connections!');
            console.log('='.repeat(60) + '\n');
        });
        
    } catch (error) {
        console.error('❌ Failed to initialize server:', error);
        process.exit(1);
    }
}

// Start the server
initializeServer().catch(console.error);

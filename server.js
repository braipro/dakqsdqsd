const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const LOGIN_PASSWORD = "AnaDom3301";
const MAX_USERS = 10;
const SESSION_DURATION = 60 * 60 * 1000; // 1 hour

// In-memory storage
const activeSessions = new Map();
const activeUsers = new Set();
const userCheckers = new Map();

app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// Session middleware
function requireAuth(req, res, next) {
    const token = req.headers.authorization;
    if (!token || !activeSessions.has(token)) {
        return res.status(401).json({ error: "انتهت الجلسة الخاصة بك" });
    }
    req.session = activeSessions.get(token);
    next();
}

// Routes
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    
    if (password !== LOGIN_PASSWORD) {
        return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
    }
    
    if (activeUsers.size >= MAX_USERS) {
        return res.status(403).json({ 
            error: "السيرفر مكتمل الآن. يرجى الانتظار ساعة، أو شراء نسخة خاصة بك.",
            contact: "https://wa.me/19177281677"
        });
    }
    
    const token = Math.random().toString(36).substring(2);
    const session = {
        token,
        userId: token,
        expires: Date.now() + SESSION_DURATION
    };
    
    activeSessions.set(token, session);
    activeUsers.add(token);
    
    // Cleanup session after duration
    setTimeout(() => {
        activeSessions.delete(token);
        activeUsers.delete(token);
        if (userCheckers.has(token)) {
            userCheckers.delete(token);
        }
    }, SESSION_DURATION);
    
    res.json({ token, expires: session.expires });
});

app.post('/api/upload', requireAuth, async (req, res) => {
    try {
        const { numbers, proxies } = req.body;
        
        if (!numbers) {
            return res.status(400).json({ error: "يرجى تقديم ملف الأرقام" });
        }
        
        const numbersArray = numbers.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .filter(line => /^\d+$/.test(line));
            
        let proxiesArray = [];
        if (proxies) {
            proxiesArray = proxies.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .filter(line => line.includes(':') || line.startsWith('http'));
        }
        
        userCheckers.set(req.session.token, {
            numbers: numbersArray,
            proxies: proxiesArray,
            progress: 0,
            stats: { checked: 0, withWhatsApp: 0, withoutWhatsApp: 0, errors: 0 },
            results: []
        });
        
        res.json({ 
            numbers: numbersArray.length, 
            proxies: proxiesArray.length,
            message: `تم تحميل ${numbersArray.length} رقم و ${proxiesArray.length} بروكسي`
        });
        
    } catch (error) {
        res.status(500).json({ error: "خطأ في تحميل الملفات" });
    }
});

app.post('/api/start', requireAuth, async (req, res) => {
    const session = req.session;
    const checker = userCheckers.get(session.token);
    
    if (!checker || checker.numbers.length === 0) {
        return res.status(400).json({ error: "يرجى تحميل ملف الأرقام أولاً" });
    }
    
    // Start checking in background
    startWhatsAppCheck(session.token, checker);
    
    res.json({ message: "بدأ عملية الفحص", total: checker.numbers.length });
});

app.get('/api/status', requireAuth, (req, res) => {
    const checker = userCheckers.get(req.session.token);
    if (!checker) {
        return res.json({ status: 'not_started' });
    }
    
    res.json({
        progress: checker.progress,
        stats: checker.stats,
        total: checker.numbers.length
    });
});

// WebSocket handling
wss.on('connection', (ws, req) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'auth') {
                ws.token = data.token;
            }
        } catch (error) {
            console.log('WebSocket message error:', error);
        }
    });
});

// WhatsApp Checker Class (Modified from CLI)
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
        this.onProgress = () => {};
        this.onFinish = () => {};
    }

    setNumbers(numbers) {
        this.numbers = numbers;
    }

    setProxies(proxies) {
        this.proxies = proxies;
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
                console.log('Invalid proxy format:', proxy);
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
        for (const number of this.numbers) {
            try {
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
                
                // Calculate progress percentage
                const progress = (this.stats.checked / this.numbers.length) * 100;
                
                // Send progress update
                this.onProgress({
                    progress: Math.round(progress),
                    stats: { ...this.stats },
                    currentNumber: number,
                    result: result
                });
                
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

        this.onFinish(this.results);
    }
}

// Background checking function
async function startWhatsAppCheck(userToken, userData) {
    const checker = new WhatsAppChecker({ delay: 1000, retries: 3 });
    checker.setNumbers(userData.numbers);
    checker.setProxies(userData.proxies);
    
    checker.onProgress = (data) => {
        // Update user data
        userData.progress = data.progress;
        userData.stats = data.stats;
        userData.results.push(data.result);
        
        // Send via WebSocket
        wss.clients.forEach(client => {
            if (client.token === userToken && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'progress_update',
                    data: data
                }));
            }
        });
    };
    
    checker.onFinish = (results) => {
        userData.progress = 100;
        userData.results = results;
        
        // Send finish event
        wss.clients.forEach(client => {
            if (client.token === userToken && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'finish',
                    data: {
                        stats: userData.stats,
                        results: results
                    }
                }));
            }
        });
    };
    
    await checker.startChecking();
}

// Cleanup expired sessions every minute
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        if (now > session.expires) {
            activeSessions.delete(token);
            activeUsers.delete(token);
            userCheckers.delete(token);
        }
    }
}, 60000);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

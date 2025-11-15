import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Fix for https-proxy-agent ESM import
import HttpsProxyAgentPkg from 'https-proxy-agent';
const { HttpsProxyAgent } = HttpsProxyAgentPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'anadom-secure-session-key-3301',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 1000 // 1 hour
  }
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Configuration
const CONFIG = {
  PASSWORD: process.env.PASSWORD || 'AnaDom3301',
  MAX_SESSIONS: parseInt(process.env.MAX_SESSIONS) || 10,
  SESSION_TIME: 60 * 60 * 1000, // 1 hour
  ACTIVE_SESSIONS: new Map()
};

// WhatsApp Checker Class (Enhanced)
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
    this.isRunning = false;
    this.stats = {
      checked: 0,
      withWhatsApp: 0,
      withoutWhatsApp: 0,
      errors: 0,
      total: 0
    };
  }

  async loadFiles(numbersFile, proxiesFile) {
    try {
      // Load phone numbers
      const numbersContent = await fs.readFile(numbersFile, 'utf8');
      this.numbers = numbersContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .filter(line => /^\d+$/.test(line));
      
      // Load proxies
      const proxiesContent = await fs.readFile(proxiesFile, 'utf8');
      this.proxies = proxiesContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .filter(line => line.includes(':') || line.startsWith('http'));

      this.stats.total = this.numbers.length;
      return true;
    } catch (error) {
      throw new Error(`Error loading files: ${error.message}`);
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
      }
    };

    if (proxy) {
      try {
        let proxyUrl = proxy.startsWith('http') ? proxy : `http://${proxy}`;
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
          proxy: proxy || 'direct',
          timestamp: new Date().toISOString()
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
          result: result,
          progress: (this.stats.checked / this.stats.total) * 100
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

  getResults() {
    return {
      stats: this.stats,
      results: this.results,
      isRunning: this.isRunning
    };
  }
}

// File upload configuration
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.authenticated) {
    const sessionData = CONFIG.ACTIVE_SESSIONS.get(req.session.id);
    if (sessionData && (Date.now() - sessionData.loginTime) < CONFIG.SESSION_TIME) {
      return next();
    } else {
      req.session.authenticated = false;
      CONFIG.ACTIVE_SESSIONS.delete(req.session.id);
    }
  }
  res.redirect('/');
};

// Session management
const manageSessions = (req) => {
  // Clean expired sessions
  const now = Date.now();
  for (const [sessionId, data] of CONFIG.ACTIVE_SESSIONS.entries()) {
    if (now - data.loginTime > CONFIG.SESSION_TIME) {
      CONFIG.ACTIVE_SESSIONS.delete(sessionId);
    }
  }

  // Check if server is full
  if (CONFIG.ACTIVE_SESSIONS.size >= CONFIG.MAX_SESSIONS && !CONFIG.ACTIVE_SESSIONS.has(req.session.id)) {
    throw new Error('SERVER_FULL');
  }
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  try {
    manageSessions(req);
    
    const { password } = req.body;
    
    if (password === CONFIG.PASSWORD) {
      req.session.authenticated = true;
      req.session.loginTime = Date.now();
      
      CONFIG.ACTIVE_SESSIONS.set(req.session.id, {
        loginTime: req.session.loginTime,
        userAgent: req.get('User-Agent')
      });
      
      res.json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid password' });
    }
  } catch (error) {
    if (error.message === 'SERVER_FULL') {
      res.status(429).json({ 
        success: false, 
        message: 'السرفر مكتمل حاليًا. الرجاء الانتظار ساعة أو شراء نسخة خاصة.',
        contact: 'https://wa.me/19177281677'
      });
    } else {
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/api/upload/numbers', requireAuth, upload.single('numbers'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    const content = await fs.readFile(req.file.path, 'utf8');
    await fs.writeFile('NumberList.TXT', content);
    await fs.unlink(req.file.path);
    
    res.json({ success: true, message: 'Numbers file uploaded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/upload/proxies', requireAuth, upload.single('proxies'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    const content = await fs.readFile(req.file.path, 'utf8');
    await fs.writeFile('Proxy.txt', content);
    await fs.unlink(req.file.path);
    
    res.json({ success: true, message: 'Proxies file uploaded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/check/start', requireAuth, async (req, res) => {
  try {
    const checker = new WhatsAppChecker(req.body);
    
    // Check if files exist
    try {
      await fs.access('NumberList.TXT');
      await fs.access('Proxy.txt');
    } catch (error) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please upload both numbers and proxies files first' 
      });
    }
    
    await checker.loadFiles('NumberList.TXT', 'Proxy.txt');
    
    if (checker.numbers.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No valid phone numbers found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Check started',
      total: checker.stats.total 
    });
    
    // Store checker instance in session
    req.session.checker = {
      stats: checker.stats,
      isRunning: true,
      startTime: new Date().toISOString()
    };
    
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/check/stop', requireAuth, (req, res) => {
  try {
    req.session.checker = {
      ...req.session.checker,
      isRunning: false
    };
    res.json({ success: true, message: 'Check stopped' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/session-info', requireAuth, (req, res) => {
  const sessionData = CONFIG.ACTIVE_SESSIONS.get(req.session.id);
  const remainingTime = sessionData ? 
    CONFIG.SESSION_TIME - (Date.now() - sessionData.loginTime) : 0;
  
  res.json({
    activeSessions: CONFIG.ACTIVE_SESSIONS.size,
    maxSessions: CONFIG.MAX_SESSIONS,
    remainingTime: Math.max(0, remainingTime),
    loginTime: sessionData?.loginTime
  });
});

app.get('/api/check/progress', requireAuth, (req, res) => {
  const progress = req.session.checker || {
    stats: {
      checked: 0,
      withWhatsApp: 0,
      withoutWhatsApp: 0,
      errors: 0,
      total: 0
    },
    isRunning: false
  };
  
  res.json(progress);
});

app.get('/api/export/txt', requireAuth, (req, res) => {
  const exportData = `
حساب الواتساب الرسمي: https://wa.me/19177281677
رابط التلغرام: https://t.me/MrAnadom
عنوان USDT TRC20: TNpHDf3Pg52UryZC154r3rFYRTVCx1N25y

طريقة طلب كلمة السر:
للحصول على كلمة السر:
أرسل كلمة "PassWord" إلى:
https://wa.me/19177281677

روابط الدعم:
WhatsApp: https://wa.me/19177281677
Telegram: https://t.me/MrAnadom
  `.trim();
  
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="AnaDom-INFO.txt"');
  res.send(exportData);
});

app.post('/api/logout', requireAuth, (req, res) => {
  CONFIG.ACTIVE_SESSIONS.delete(req.session.id);
  req.session.destroy();
  res.json({ success: true, message: 'Logged out successfully' });
});

// Create uploads directory if it doesn't exist
const init = async () => {
  try {
    await fs.mkdir('uploads', { recursive: true });
    console.log('Uploads directory created');
  } catch (error) {
    console.log('Uploads directory already exists');
  }
};

app.listen(PORT, () => {
  init();
  console.log(`🚀 AnaDom WhatsApp Checker UI running on port ${PORT}`);
  console.log(`🔗 Access the application at: http://localhost:${PORT}`);
});

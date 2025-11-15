import express from 'express';
import multer from 'multer';
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
app.use(express.static('public'));
app.use(express.json());

// Multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// WhatsApp Checker Class (from your working script)
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
        return number.replace(/[\s+\-()]/g, '');
    }

    async loadFiles(numbersFile, proxiesFile) {
        try {
            // Load phone numbers
            const numbersContent = await fs.readFile(numbersFile, 'utf8');
            this.numbers = numbersContent
                .split('\n')
                .map(line => this.cleanPhoneNumber(line.trim()))
                .filter(line => line && !line.startsWith('#'))
                .filter(line => /^\d+$/.test(line));

            console.log(`✓ Loaded ${this.numbers.length} phone numbers`);

            // Load proxies
            const proxiesContent = await fs.readFile(proxiesFile, 'utf8');
            this.proxies = proxiesContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .filter(line => {
                    return line.includes(':') || line.startsWith('http');
                });
            
            if (this.proxies.length === 0) {
                console.log('⚠ No proxies found, using direct connection');
            } else {
                console.log(`✓ Loaded ${this.proxies.length} proxies`);
            }

            return true;
        } catch (error) {
            console.error(`✗ Error loading files: ${error.message}`);
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

    async startChecking(onProgress) {
        this.isRunning = true;
        this.stats = { checked: 0, withWhatsApp: 0, withoutWhatsApp: 0, errors: 0 };
        this.results = [];
        
        for (const number of this.numbers) {
            if (!this.isRunning) break;

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
                
                // Send progress update
                if (onProgress) {
                    onProgress({
                        checked: this.stats.checked,
                        total: this.numbers.length,
                        withWhatsApp: this.stats.withWhatsApp,
                        withoutWhatsApp: this.stats.withoutWhatsApp,
                        errors: this.stats.errors,
                        currentNumber: number,
                        exists: result.success ? result.exists : null
                    });
                }
                
                // Save results incrementally
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
            const output = this.results.map(result => {
                if (result.success) {
                    return `${result.phone},${result.exists ? 'YES' : 'NO'}`;
                } else {
                    return `${result.phone},ERROR,${result.error}`;
                }
            }).join('\n');
            
            const header = 'Phone Number,WhatsApp Status,Error\n';
            await fs.writeFile('results.csv', header + output);
            
            // Save WhatsApp numbers only
            const whatsappNumbers = this.results
                .filter(r => r.success && r.exists)
                .map(r => r.phone)
                .join('\n');
            await fs.writeFile('whatsapp_numbers.txt', whatsappNumbers);
                
        } catch (error) {
            console.error(`Error saving results: ${error.message}`);
        }
    }

    stopChecking() {
        this.isRunning = false;
    }
}

// Global checker instance
let checker = null;

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload files
app.post('/upload', upload.fields([
    { name: 'numbersFile', maxCount: 1 },
    { name: 'proxiesFile', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files.numbersFile) {
            return res.json({ success: false, message: 'Please upload numbers file' });
        }

        const numbersFile = req.files.numbersFile[0].path;
        const proxiesFile = req.files.proxiesFile ? req.files.proxiesFile[0].path : 'Proxy.txt';

        // Create empty proxies file if not provided
        if (!req.files.proxiesFile) {
            await fs.writeFile('Proxy.txt', '');
        }

        checker = new WhatsAppChecker({
            delay: req.body.delay || 1000,
            retries: req.body.retries || 3
        });

        const filesLoaded = await checker.loadFiles(numbersFile, proxiesFile);
        
        if (!filesLoaded) {
            return res.json({ success: false, message: 'Error loading files' });
        }

        if (checker.numbers.length === 0) {
            return res.json({ success: false, message: 'No valid phone numbers found' });
        }

        res.json({ 
            success: true, 
            message: `Ready to check ${checker.numbers.length} numbers`,
            totalNumbers: checker.numbers.length
        });

    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// Start checking
app.post('/start', async (req, res) => {
    if (!checker) {
        return res.json({ success: false, message: 'Please upload files first' });
    }

    res.json({ success: true, message: 'Checking started' });

    // Start checking in background
    checker.startChecking((progress) => {
        // Progress will be handled via polling
    }).then(() => {
        console.log('Checking completed');
    });
});

// Get progress
app.get('/progress', (req, res) => {
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
        total: checker.numbers.length
    });
});

// Stop checking
app.post('/stop', (req, res) => {
    if (checker) {
        checker.stopChecking();
    }
    res.json({ success: true, message: 'Checking stopped' });
});

// Download results
app.get('/download/:type', (req, res) => {
    const type = req.params.type;
    
    if (type === 'whatsapp') {
        res.download('whatsapp_numbers.txt');
    } else if (type === 'full') {
        res.download('results.csv');
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Support info
app.get('/support', (req, res) => {
    res.json({
        whatsapp: 'https://wa.me/19177281677',
        telegram: 'https://t.me/MrAnadom',
        usdt: 'TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Checker Web running on port ${PORT}`);
    console.log(`📞 WhatsApp: https://wa.me/19177281677`);
    console.log(`📱 Telegram: https://t.me/MrAnadom`);
    console.log(`💝 Support: TNpHDf3Pg52UryZC154r3rFYRTvCx1N25y`);
});

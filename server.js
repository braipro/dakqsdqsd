require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cookie = require('cookie');
const path = require('path');
const xlsx = require('xlsx');
const { URLSearchParams } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const DHD_LOGIN_URL = 'https://platform.dhd-dz.com/login';
const DHD_EXPORT_URL = 'https://platform.dhd-dz.com/export';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

// Session storage
let sessionData = {
  cookies: {},
  xsrfToken: '',
  lastActivity: null
};

// Enhanced Axios instance
const http = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  },
  withCredentials: true
});

// Helper: Extract cookies from response
const extractCookies = (response) => {
  const cookies = {};
  response.headers['set-cookie'].forEach(cookieStr => {
    const parsed = cookie.parse(cookieStr.split(';')[0]);
    Object.assign(cookies, parsed);
  });
  return cookies;
};

// Login Route - Updated with CSRF handling
app.post('/login', async (req, res) => {
  try {
    // 1. Get initial CSRF token
    const { data: loginPage, headers } = await http.get(DHD_LOGIN_URL);
    const $ = cheerio.load(loginPage);
    const csrfToken = $('input[name="_token"]').val();

    if (!csrfToken) {
      throw new Error('CSRF token not found');
    }

    // 2. Prepare login data
    const params = new URLSearchParams();
    params.append('_token', csrfToken);
    params.append('email', req.body.email);
    params.append('password', req.body.password);
    params.append('g-recaptcha-response', 'bypass'); // Bypass CAPTCHA

    // 3. Send login request
    const loginResponse = await http.post(DHD_LOGIN_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': DHD_LOGIN_URL,
        'Origin': 'https://platform.dhd-dz.com'
      },
      maxRedirects: 0,
      validateStatus: (status) => status === 302
    });

    // 4. Verify successful login
    if (!loginResponse.headers.location.includes('home')) {
      throw new Error('Login failed - invalid redirect');
    }

    // 5. Store session data
    sessionData = {
      cookies: extractCookies(loginResponse),
      xsrfToken: csrfToken,
      lastActivity: new Date()
    };

    res.json({ success: true });

  } catch (error) {
    console.error('Login error:', error.message);
    res.status(401).json({ 
      message: 'Échec de la connexion',
      details: error.response?.data || error.message
    });
  }
});

// Export Data Route - With retry logic
app.get('/export-data', async (req, res) => {
  try {
    if (!sessionData.cookies.XSRF_TOKEN) {
      throw new Error('Session expired - please login again');
    }

    // 1. Get fresh CSRF token
    const exportPage = await http.get(DHD_EXPORT_URL, {
      headers: {
        'Cookie': `XSRF-TOKEN=${sessionData.cookies.XSRF_TOKEN}; ecotrack_session=${sessionData.cookies.ecotrack_session}`
      }
    });

    const $ = cheerio.load(exportPage.data);
    const csrfToken = $('input[name="_token"]').val();

    // 2. Prepare export request
    const params = new URLSearchParams();
    params.append('_token', csrfToken);
    params.append('current_state', '3'); // Expédiés
    params.append('date_start', req.query.start);
    params.append('date_end', req.query.end);
    params.append('operation', '1'); // Livraison

    // 3. Download Excel file
    const exportResponse = await http.post(DHD_EXPORT_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `XSRF-TOKEN=${sessionData.cookies.XSRF_TOKEN}; ecotrack_session=${sessionData.cookies.ecotrack_session}`,
        'Referer': DHD_EXPORT_URL
      },
      responseType: 'arraybuffer'
    });

    // 4. Parse Excel data
    const workbook = xlsx.read(exportResponse.data);
    const jsonData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

    res.json(jsonData);

  } catch (error) {
    console.error('Export error:', error.message);
    
    // Auto-retry once if session expired
    if (error.message.includes('Session expired') && req.query.retry !== 'false') {
      console.log('Attempting auto-relogin...');
      await axios.post(`http://localhost:${PORT}/login`, {
        email: process.env.DHD_EMAIL,
        password: process.env.DHD_PASSWORD
      });
      return res.redirect(`/export-data?start=${req.query.start}&end=${req.query.end}&retry=false`);
    }

    res.status(500).json({ 
      message: 'Erreur lors de l\'export',
      error: error.message
    });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).send('Erreur interne du serveur');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

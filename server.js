const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cookie = require('cookie');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Global variables to store session data
let sessionCookies = {};
let xsrfToken = '';

// Login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // First request to get CSRF token
        const loginPage = await axios.get('https://platform.dhd-dz.com/login');
        const $ = cheerio.load(loginPage.data);
        const token = $('input[name="_token"]').val();

        // Prepare login data
        const loginData = new URLSearchParams();
        loginData.append('_token', token);
        loginData.append('email', email);
        loginData.append('password', password);
        loginData.append('g-recaptcha-response', 'bypassed');

        // Perform login
        const loginResponse = await axios.post('https://platform.dhd-dz.com/login', loginData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://platform.dhd-dz.com/login'
            },
            maxRedirects: 0,
            validateStatus: (status) => status === 302
        });

        // Extract cookies from response
        const setCookieHeaders = loginResponse.headers['set-cookie'];
        if (!setCookieHeaders) {
            return res.status(401).json({ message: 'Échec de la connexion - cookies non reçus' });
        }

        // Parse cookies
        const cookies = {};
        setCookieHeaders.forEach(cookieStr => {
            const parsed = cookie.parse(cookieStr.split(';')[0]);
            Object.assign(cookies, parsed);
        });

        // Store cookies for future requests
        sessionCookies = cookies;
        xsrfToken = cookies['XSRF-TOKEN'];

        res.json({ success: true });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Erreur de connexion' });
    }
});

// Export data route
app.get('/export-data', async (req, res) => {
    const { start, end } = req.query;

    try {
        // First, get the export page to get a new CSRF token
        const exportPage = await axios.get('https://platform.dhd-dz.com/export', {
            headers: {
                'Cookie': `XSRF-TOKEN=${xsrfToken}; ecotrack_session=${sessionCookies['ecotrack_session']}`
            }
        });

        const $ = cheerio.load(exportPage.data);
        const token = $('input[name="_token"]').val();

        // Prepare export data
        const exportData = new URLSearchParams();
        exportData.append('_token', token);
        exportData.append('current_state', '3'); // Expédiés
        exportData.append('date_start', start);
        exportData.append('date_end', end);
        exportData.append('operation', '1'); // Livraison

        // Request the export
        const exportResponse = await axios.post('https://platform.dhd-dz.com/export', exportData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': `XSRF-TOKEN=${xsrfToken}; ecotrack_session=${sessionCookies['ecotrack_session']}`,
                'Referer': 'https://platform.dhd-dz.com/export'
            },
            responseType: 'arraybuffer'
        });

        // Parse the Excel file
        const workbook = xlsx.read(exportResponse.data, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = xlsx.utils.sheet_to_json(firstSheet, { header: 1 });

        res.json(jsonData);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ message: 'Erreur lors de l\'export des données' });
    }
});

// Serve the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
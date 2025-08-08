const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to handle export
app.post('/export-data', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await automateExport(email, password);
        
        if (result.success) {
            res.json({ 
                success: true,
                fileUrl: `/downloads/${result.filename}`,
                message: 'Export completed successfully'
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: result.error 
            });
        }
    } catch (error) {
        console.error('Error during export:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during export' 
        });
    }
});

// Serve downloaded files
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Browser automation function
async function automateExport(email, password) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Set user agent to mimic a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate to login page
        await page.goto('https://platform.dhd-dz.com/login', { waitUntil: 'networkidle2' });
        
        // Fill login form
        await page.type('#email', email);
        await page.type('#password', password);
        await page.click('#submit-button');
        
        // Wait for navigation to home page
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        
        // Navigate to export page
        await page.goto('https://platform.dhd-dz.com/export', { waitUntil: 'networkidle2' });
        
        // Set export options
        await page.select('#current_state', '3'); // Expédiés
        
        // Set date range (from January 1 of current year to today)
        const today = new Date();
        const currentYear = today.getFullYear();
        const startDate = `${currentYear}-01-01`;
        const endDate = today.toISOString().split('T')[0];
        
        await page.evaluate((startDate, endDate) => {
            document.getElementById('date_start').value = startDate;
            document.getElementById('date_end').value = endDate;
        }, startDate, endDate);
        
        // Select operation type
        await page.select('#operation', '1'); // Livraison
        
        // Wait for a bit to ensure all selections are processed
        await page.waitForTimeout(1000);
        
        // Set up file download
        const downloadPath = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath);
        }
        
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath
        });
        
        // Click download button
        await page.click('#submit');
        
        // Wait for download to complete
        const filename = await waitForDownload(downloadPath);
        
        if (!filename) {
            throw new Error('File download failed or timed out');
        }
        
        return { 
            success: true, 
            filename: filename,
            message: 'File downloaded successfully' 
        };
    } finally {
        await browser.close();
    }
}

// Helper function to wait for download
function waitForDownload(downloadPath, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const interval = setInterval(() => {
            const files = fs.readdirSync(downloadPath);
            const xlsxFiles = files.filter(file => file.endsWith('.xlsx'));
            
            if (xlsxFiles.length > 0) {
                clearInterval(interval);
                resolve(xlsxFiles[0]);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                resolve(null);
            }
        }, 500);
    });
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Ready to export data from DHD platform');
});

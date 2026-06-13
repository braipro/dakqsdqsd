const express = require('express');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const HttpsProxyAgent = require('https-proxy-agent');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// الرابط الذي يوفر قائمة بروكسيات جزائرية
const PROXY_API_URL = 'https://proxyfreeonly.com/api/free-proxy-list?limit=20&page=1&country=DZ&sortBy=lastChecked&sortType=desc';

// قائمة بروكسيات احتياطية (في حال فشل جلب القائمة)
const FALLBACK_PROXIES = [
    "http://154.247.56.229:3128",
    "socks5://41.111.188.40:80",
    "socks4://41.111.198.108:443"
];

let currentProxyList = [];

// جلب قائمة البروكسيات من الـ API
async function fetchProxyList() {
    try {
        const response = await axios.get(PROXY_API_URL);
        const proxies = response.data;
        const formatted = proxies.map(p => {
            const protocol = p.protocols[0]; // 'socks4', 'socks5', 'http'
            return `${protocol}://${p.ip}:${p.port}`;
        });
        currentProxyList = formatted.length ? formatted : FALLBACK_PROXIES;
        console.log(`Loaded ${currentProxyList.length} proxies`);
    } catch (err) {
        console.error('Failed to fetch proxy list, using fallback', err.message);
        currentProxyList = FALLBACK_PROXIES;
    }
}

// إنشاء وكيل (agent) بناءً على البروتوكول
function getAgent(proxyUrl) {
    if (proxyUrl.startsWith('socks4://') || proxyUrl.startsWith('socks5://')) {
        return new SocksProxyAgent(proxyUrl);
    } else if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
        return new HttpsProxyAgent(proxyUrl);
    } else {
        // افتراض http
        return new HttpsProxyAgent(`http://${proxyUrl}`);
    }
}

// محاولة الطلب عبر بروكسي مع إعادة المحاولة
async function fetchWithProxy(url, headers, retries = 3) {
    for (let i = 0; i < retries; i++) {
        const proxyUrl = currentProxyList[Math.floor(Math.random() * currentProxyList.length)];
        console.log(`Attempt ${i+1} using proxy: ${proxyUrl}`);
        try {
            const agent = getAgent(proxyUrl);
            const response = await axios({
                method: 'get',
                url: url,
                headers: headers,
                httpAgent: agent,
                httpsAgent: agent,
                timeout: 15000
            });
            return response;
        } catch (err) {
            console.error(`Proxy ${proxyUrl} failed: ${err.message}`);
            // إذا فشل، جرب بروكسي آخر
            continue;
        }
    }
    throw new Error('All proxies failed');
}

// نقطة النهاية الرئيسية
app.post('/fetch-orders', async (req, res) => {
    const targetUrl = 'https://app.noest-dz.com/search/fetch';
    const params = new URLSearchParams(req.body).toString();
    const fullUrl = `${targetUrl}?${params}`;
    console.log(`Requesting: ${fullUrl.substring(0, 200)}...`);

    // الهيدرز المطلوبة (نفسها من المتصفح)
    const headers = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Cookie': 'remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6IjNhNElUcDZsV25kZE90OVREbURhaUE9PSIsInZhbHVlIjoiTDNSUDZ6VzhuaTZ5UUFiTC8rRTl0dFN6amE1eVhIN3NsZGlQcGdBVGQ5NUExSGxGR1Q5WCs5QkZmZ1J2WHpZS1ZQdklnU3lRTWNRWHhVNWpOR282ZDAwamd4dFd5aGV5S1A3RkphQkg1MXFjRG41ZDhxTWVIWU1qUnhYRTF2aGdvQ3JNVFpoaTFrYis1RW5RSE5lMFo1d1FLc1VQWHJHOXpkcExVcnFJUVdxSmkzZVd2aEwycjhKSEcwaTh2a3dIalBBRWFKOFhZR0J1MHNsNGZwQk0xNXlXQTQwK1dicmwrUjAwWTJNa1lKWT0iLCJtYWMiOiJkYmY1OGI5NTkwNTk2NmJjNzE3ZThmYWIxZmMyM2M2Y2JiYzI3YWNkMmYxODQyYmU0OTNmZjIyMDRiNzYyZDBjIiwidGFnIjoiIn0%3D; lang=eyJpdiI6ImM2NStHVUFoTFhMTkwrZ29JYUl5Q3c9PSIsInZhbHVlIjoiZXBZTWJOOGtTTlcrNGNkSzAyRElJUWpVZy80cExFWkEyTWtvYTJQRWs2R01xcVJ0c0NqM2JKdkZmbEVIeCtDZCIsIm1hYyI6ImIyMGZjZWE5MGIxYjk1ZmMyZGQ4M2RlZDZmYmM4NzUxMGIzN2EyYmM5MTllY2U1MmNkZDU3NDhjOTAwYTBkZGQiLCJ0YWciOiIifQ%3D%3D; XSRF-TOKEN=eyJpdiI6IitVR0pWN1BjeUxVbFRmV0pvbCtKMUE9PSIsInZhbHVlIjoiS1FIY2pxU0M2cGZEclNvbkZYdUtBMlJNbzUvUEFmQy9xdm5nUFZxY0ltUi8xSmsyY2RGM2JsODM3UEtjOWsxVGFOTW5tV1Q0R1U2c0dlZkUvODc1bjZITThJN052RHNsUVJvUHg0N3RzRE9oT2k1S0kyWUJEMUtvbm5Ic3lQYmUiLCJtYWMiOiJhNWFmMzI4ODNmNzU2NTgxM2QxYTMwMjZlNzI3YzZkMGM0Y2UxMzI1OTcyMjQyMGQwZGQ5ZjBlYzlhYmE0MWRlIiwidGFnIjoiIn0%3D; noest_express_session=eyJpdiI6InNjaXdQd0FKTmM4aFlmWHA0UktHTnc9PSIsInZhbHVlIjoiYVFhY3JaRFBHak1vWFh0VllVVFJVT2VTZGUyNC9udER0NWNmNWtFbDcvcldDcDFrZWJyV2N0ZGpseklMbFhUV0lQQ0JCbkZsdHo1UzNra09NY002YTcrZVRwQ1I2eUlTMmtOUlN4RUh3ckJUdmFkNkJscDA5c2Q2bCtLaDQvUWsiLCJtYWMiOiJiYzg3NzMyYWQ4OTFiYTRhODA2NTA5ZjhmNGI1NjJkMDliYjc5OTBjMzJkZGQ2MTljZGRjOTliZWQ1NzU5MmZmIiwidGFnIjoiIn0%3D',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://app.noest-dz.com/search'
    };

    try {
        const response = await fetchWithProxy(fullUrl, headers);
        res.status(200).json(response.data);
    } catch (error) {
        console.error('Relay error:', error.message);
        res.status(500).json({ error: 'Failed to fetch data via proxy', details: error.message });
    }
});

// تحديث قائمة البروكسيات كل ساعة
setInterval(fetchProxyList, 60 * 60 * 1000);
fetchProxyList(); // جلب أولي

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Relay running on port ${PORT}`));

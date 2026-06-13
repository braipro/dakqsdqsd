// server.js
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// قائمة البروكسيات الجزائرية التي وفرتها
// يمكنك إضافة المزيد من القائمة التي يتم جلبها تلقائياً
const PROXY_LIST = [
    "http://154.247.56.229:3128", // قد يحتاج لتعديل المنفذ حسب البروتوكول
    "socks5://41.111.188.40:80",
    "socks4://41.111.198.108:443"
    // أضف المزيد من القائمة التي توفرها الـ API
];

// دالة لاختيار بروكسي عشوائي من القائمة
function getRandomProxy() {
    return PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
}

// نقطة النهاية الرئيسية التي سيتصل بها Apps Script
app.post('/fetch-orders', async (req, res) => {
    const targetUrl = 'https://app.noest-dz.com/search/fetch';
    // البايلود الذي سيرسله Apps Script
    const params = new URLSearchParams(req.body).toString();
    const fullUrl = `${targetUrl}?${params}`;

    // اختيار بروكسي للطلب
    const proxyToUse = getRandomProxy();
    console.log(`Using proxy: ${proxyToUse}`);

    // الهيدرز التي نسختها من متصفحك
    const config = {
        method: 'get',
        url: fullUrl,
        headers: {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Cookie': 'remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6IjNhNElUcDZsV25kZE90OVREbURhaUE9PSIsInZhbHVlIjoiTDNSUDZ6VzhuaTZ5UUFiTC8rRTl0dFN6amE1eVhIN3NsZGlQcGdBVGQ5NUExSGxGR1Q5WCs5QkZmZ1J2WHpZS1ZQdklnU3lRTWNRWHhVNWpOR282ZDAwamd4dFd5aGV5S1A3RkphQkg1MXFjRG41ZDhxTWVIWU1qUnhYRTF2aGdvQ3JNVFpoaTFrYis1RW5RSE5lMFo1d1FLc1VQWHJHOXpkcExVcnFJUVdxSmkzZVd2aEwycjhKSEcwaTh2a3dIalBBRWFKOFhZR0J1MHNsNGZwQk0xNXlXQTQwK1dicmwrUjAwWTJNa1lKWT0iLCJtYWMiOiJkYmY1OGI5NTkwNTk2NmJjNzE3ZThmYWIxZmMyM2M2Y2JiYzI3YWNkMmYxODQyYmU0OTNmZjIyMDRiNzYyZDBjIiwidGFnIjoiIn0%3D; lang=eyJpdiI6ImM2NStHVUFoTFhMTkwrZ29JYUl5Q3c9PSIsInZhbHVlIjoiZXBZTWJOOGtTTlcrNGNkSzAyRElJUWpVZy80cExFWkEyTWtvYTJQRWs2R01xcVJ0c0NqM2JKdkZmbEVIeCtDZCIsIm1hYyI6ImIyMGZjZWE5MGIxYjk1ZmMyZGQ4M2RlZDZmYmM4NzUxMGIzN2EyYmM5MTllY2U1MmNkZDU3NDhjOTAwYTBkZGQiLCJ0YWciOiIifQ%3D%3D; XSRF-TOKEN=eyJpdiI6IitVR0pWN1BjeUxVbFRmV0pvbCtKMUE9PSIsInZhbHVlIjoiS1FIY2pxU0M2cGZEclNvbkZYdUtBMlJNbzUvUEFmQy9xdm5nUFZxY0ltUi8xSmsyY2RGM2JsODM3UEtjOWsxVGFOTW5tV1Q0R1U2c0dlZkUvODc1bjZITThJN052RHNsUVJvUHg0N3RzRE9oT2k1S0kyWUJEMUtvbm5Ic3lQYmUiLCJtYWMiOiJhNWFmMzI4ODNmNzU2NTgxM2QxYTMwMjZlNzI3YzZkMGM0Y2UxMzI1OTcyMjQyMGQwZGQ5ZjBlYzlhYmE0MWRlIiwidGFnIjoiIn0%3D; noest_express_session=eyJpdiI6InNjaXdQd0FKTmM4aFlmWHA0UktHTnc9PSIsInZhbHVlIjoiYVFhY3JaRFBHak1vWFh0VllVVFJVT2VTZGUyNC9udER0NWNmNWtFbDcvcldDcDFrZWJyV2N0ZGpseklMbFhUV0lQQ0JCbkZsdHo1UzNra09NY002YTcrZVRwQ1I2eUlTMmtOUlN4RUh3ckJUdmFkNkJscDA5c2Q2bCtLaDQvUWsiLCJtYWMiOiJiYzg3NzMyYWQ4OTFiYTRhODA2NTA5ZjhmNGI1NjJkMDliYjc5OTBjMzJkZGQ2MTljZGRjOTliZWQ1NzU5MmZmIiwidGFnIjoiIn0%3D',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest'
        },
        // تكوين البروكسي لمكتبة axios
        proxy: {
            protocol: proxyToUse.split(':')[0],
            host: proxyToUse.split(':')[1].replace(/\/\//, ''),
            port: parseInt(proxyToUse.split(':')[2])
        }
    };

    try {
        const response = await axios(config);
        res.json(response.data);
    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch data via proxy' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Relay server running on port ${PORT}`);
});

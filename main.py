from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
import playwright.sync_api as playwright
import os
from datetime import datetime

app = FastAPI()

# دالة لتنزيل الملف من DHD
def download_dhd_file(email: str, password: str):
    with playwright.sync_playwright() as p:
        # تشغيل متصفح Headless
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. تسجيل الدخول
        page.goto("https://platform.dhd-dz.com/login")
        page.fill("#email", email)
        page.fill("#password", password)
        page.click("#submit-button")
        page.wait_for_url("https://platform.dhd-dz.com/home")

        # 2. الذهاب لصفحة التصدير
        page.goto("https://platform.dhd-dz.com/export")
        
        # 3. تعبئة الخيارات
        page.select_option("#current_state", "3")  # Expédiés
        page.select_option("#operation", "1")     # Livraison
        
        # تحديد التاريخ (من أول السنة إلى اليوم)
        today = datetime.now().strftime("%Y-%m-%d")
        page.fill("#date_start", "2025-01-01")
        page.fill("#date_end", today)

        # 4. تنزيل الملف
        with page.expect_download() as download_info:
            page.click("#submit")
        download = download_info.value

        # حفظ الملف في مجلد "downloads"
        if not os.path.exists("downloads"):
            os.mkdir("downloads")
        
        file_path = f"downloads/{download.suggested_filename}"
        download.save_as(file_path)

        browser.close()
        return file_path

# نقطة نهاية API
@app.post("/export")
async def export_data(email: str, password: str):
    try:
        file_path = download_dhd_file(email, password)
        return FileResponse(file_path, filename="dhd_export.xlsx")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

# تشغيل السيرفر (للتجربة المحلية)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)

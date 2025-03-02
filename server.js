const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { chromium } = require("playwright");

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ✅ Redis Setup
const REDIS_URL = process.env.REDIS_URL || "redis://default:AXzeAAIjcDEzMzNlODE2YjViNWU0ZWU2OGYzYTc5YzVmYzNhY2Q2ZHAxMA@modest-corgi-31966.upstash.io:6379";

const redisClient = redis.createClient({
    url: REDIS_URL,
    socket: { tls: true }
});

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));

redisClient.connect()
    .then(() => console.log("✅ Redis Connected"))
    .catch(err => console.error("❌ Redis Connection Failed:", err));

app.get("/proxy/fetch", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`Fetching URL: ${url}`);

        // ✅ Check Redis Cache  
        const cachedData = await redisClient.get(url);
        if (cachedData) {
            console.log("✅ Cache hit");
            return res.json(JSON.parse(cachedData));
        }

        console.log("🚀 Cache miss, scraping...");

        // ✅ Use Playwright to Load Website with Resources  
        const browser = await chromium.launch({  
            headless: true,
            executablePath: '/opt/render/project/src/node_modules/playwright-core/.local-browsers/chromium-1155/chrome-linux/chrome'
        });

        const page = await browser.newPage();  

        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

        // ✅ Get All Page Content  
        const pageData = await page.evaluate(() => {
            return {
                title: document.title,
                html: document.documentElement.outerHTML,
                styles: Array.from(document.styleSheets).map(sheet => sheet.href).filter(Boolean),
                scripts: Array.from(document.scripts).map(script => script.src).filter(Boolean),
                images: Array.from(document.images).map(img => img.src)
            };
        });

        await browser.close();

        // ✅ Cache in Redis for 5 mins  
        await redisClient.setEx(url, 300, JSON.stringify(pageData));

        console.log("✅ Data cached successfully");

        res.json(pageData);
    } catch (error) {
        console.error("❌ Scraping Error:", error);
        res.status(500).json({ error: "Failed to fetch website" });
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

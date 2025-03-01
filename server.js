const express = require("express");
const cors = require("cors");
const redis = require("redis");
const puppeteer = require("puppeteer-core");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(express.json());

// Redis Setup with Render Support
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redisClient.on("error", (err) => console.error("Redis Error:", err));

redisClient.connect()
    .then(() => console.log("✅ Redis Connected"))
    .catch(err => console.error("Redis Connection Error:", err));

// Proxy Route with Scraping & Redis Caching
app.get("/proxy/fetch", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`Fetching URL: ${url}`);

        // Check Redis Cache
        const cachedData = await redisClient.get(url);
        if (cachedData) {
            console.log("✅ Cache hit");
            return res.json(JSON.parse(cachedData));
        }

        console.log("🚀 Cache miss, scraping...");

        // Scrape Website Data
        const browser = await puppeteer.launch({
            executablePath: process.env.CHROME_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable",
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }); // Increased timeout
        const content = await page.content();
        await browser.close();

        // Parse Content with Cheerio
        const $ = cheerio.load(content);
        const pageData = { title: $("title").text(), html: $.html() };

        // Cache in Redis for 5 mins
        await redisClient.setEx(url, 300, JSON.stringify(pageData));

        console.log("✅ Data cached successfully");

        res.json(pageData);
    } catch (error) {
        console.error("❌ Scraping Error:", error);
        res.status(500).json({ error: "Failed to fetch website" });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

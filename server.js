const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const urlLib = require("url");

const app = express();
app.use(cors());
app.use(express.json());

const REDIS_URL = process.env.REDIS_URL || "redis://default:AXzeAAIjcDEzMzNlODE2YjViNWU0ZWU2OGYzYTc5YzVmYzNhY2Q2ZHAxMA@modest-corgi-31966.upstash.io:6379";
const redisClient = redis.createClient({ url: REDIS_URL, socket: { tls: true } });

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));
redisClient.connect().then(() => console.log("✅ Redis Connected")).catch((err) => console.error("❌ Redis Connection Failed:", err));

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

    // ✅ Launch Playwright Browser  
    const browser = await chromium.launch({  
        headless: true,  
        executablePath: "/opt/render/project/src/node_modules/playwright-core/.local-browsers/chromium-1155/chrome-linux/chrome"  
    });  

    const page = await browser.newPage();  
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });  

    // ✅ Extract Full HTML  
    const content = await page.content();  
    const $ = cheerio.load(content);  

    // ✅ Convert relative URLs to absolute  
    const absoluteUrl = (relativePath) => new URL(relativePath, url).href;  

    $("img").each((_, img) => {  
        const src = $(img).attr("src");  
        if (src && !src.startsWith("http")) $(img).attr("src", absoluteUrl(src));  
    });  

    $("link[rel='stylesheet']").each((_, link) => {  
        const href = $(link).attr("href");  
        if (href && !href.startsWith("http")) $(link).attr("href", absoluteUrl(href));  
    });  

    $("script").each((_, script) => {  
        const src = $(script).attr("src");  
        if (src && !src.startsWith("http")) $(script).attr("src", absoluteUrl(src));  
    });  

    const pageData = {  
        title: $("title").text(),  
        html: $.html(),  
        styles: $("link[rel='stylesheet']").map((_, link) => $(link).attr("href")).get(),  
        scripts: $("script[src]").map((_, script) => $(script).attr("src")).get(),  
        images: $("img[src]").map((_, img) => $(img).attr("src")).get(),  
    };  

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
app.listen(PORT, () => console.log("Server running on port ${PORT}"));

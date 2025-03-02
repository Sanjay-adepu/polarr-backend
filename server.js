const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { chromium } = require("playwright");
const fs = require("fs-extra");
const path = require("path");

const app = express();
app.use(cors({ origin: "*" }));
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

// ✅ Serve Static Files
const CACHE_DIR = path.join(__dirname, "cache");
fs.ensureDirSync(CACHE_DIR);
app.use("/cache", express.static(CACHE_DIR));

app.get("/proxy/fetch", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`Fetching URL: ${url}`);

        // ✅ Check Redis Cache  
        const cachedData = await redisClient.get(url);
        if (cachedData) {
            console.log("✅ Cache hit");
            return res.sendFile(path.join(CACHE_DIR, `${Buffer.from(url).toString("base64")}.html`));
        }

        console.log("🚀 Cache miss, scraping...");

        // ✅ Launch Headless Browser
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

        // ✅ Capture Page Content  
        const pageData = await page.evaluate(() => {
            return {
                title: document.title,
                html: document.documentElement.outerHTML
            };
        });

        // ✅ Download Assets
        const assetPromises = [];
        const downloadAsset = async (assetUrl, folder) => {
            try {
                const response = await page.evaluate(async (url) => {
                    const res = await fetch(url);
                    return res.ok ? { buffer: await res.arrayBuffer(), type: res.headers.get("content-type") } : null;
                }, assetUrl);

                if (!response) return null;
                const ext = response.type.includes("css") ? ".css" : response.type.includes("javascript") ? ".js" : path.extname(assetUrl);
                const filename = Buffer.from(assetUrl).toString("base64") + ext;
                const filePath = path.join(CACHE_DIR, folder, filename);
                fs.ensureDirSync(path.dirname(filePath));
                fs.writeFileSync(filePath, Buffer.from(response.buffer));

                return `/cache/${folder}/${filename}`;
            } catch (err) {
                console.error(`❌ Failed to download asset: ${assetUrl}`, err);
                return assetUrl; // Fallback to original URL
            }
        };

        const styles = await page.evaluate(() => Array.from(document.styleSheets).map(sheet => sheet.href).filter(Boolean));
        const scripts = await page.evaluate(() => Array.from(document.scripts).map(script => script.src).filter(Boolean));
        const images = await page.evaluate(() => Array.from(document.images).map(img => img.src));

        for (let style of styles) assetPromises.push(downloadAsset(style, "styles"));
        for (let script of scripts) assetPromises.push(downloadAsset(script, "scripts"));
        for (let image of images) assetPromises.push(downloadAsset(image, "images"));

        const cachedAssets = await Promise.all(assetPromises);

        // ✅ Rewrite HTML
        let modifiedHTML = pageData.html;
        styles.forEach((original, index) => modifiedHTML = modifiedHTML.replace(original, cachedAssets[index]));
        scripts.forEach((original, index) => modifiedHTML = modifiedHTML.replace(original, cachedAssets[styles.length + index]));
        images.forEach((original, index) => modifiedHTML = modifiedHTML.replace(original, cachedAssets[styles.length + scripts.length + index]));

        await browser.close();

        // ✅ Cache in Redis & Save File
        const cacheFilePath = path.join(CACHE_DIR, `${Buffer.from(url).toString("base64")}.html`);
        fs.writeFileSync(cacheFilePath, modifiedHTML);
        await redisClient.setEx(url, 300, "cached");

        console.log("✅ Website cached successfully");

        res.sendFile(cacheFilePath);
    } catch (error) {
        console.error("❌ Scraping Error:", error);
        res.status(500).json({ error: "Failed to fetch website" });
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

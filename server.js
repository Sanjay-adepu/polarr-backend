const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const sharp = require("sharp");

const app = express();
app.use(cors());
app.use(express.json());


const REDIS_URL = process.env.REDIS_URL || "redis://default:AXzeAAIjcDEzMzNlODE2YjViNWU0ZWU2OGYzYTc5YzVmYzNhY2Q2ZHAxMA@modest-corgi-31966.upstash.io:6379";



const redisClient = redis.createClient({ url: REDIS_URL, socket: { tls: true } });

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));
redisClient.connect().then(() => console.log("✅ Redis Connected")).catch((err) => console.error("❌ Redis Connection Failed:", err));

const PROXY_SERVER = "http://your-proxy-url"; // Optional Proxy Server

// Function to convert images to WebP
const convertToWebP = async (imgBuffer) => {
    try {
        return await sharp(imgBuffer).webp().toBuffer();
    } catch (error) {
        console.error("❌ WebP Conversion Error:", error);
        return imgBuffer;
    }
};

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

        // ✅ Launch Playwright Browser with Proxy
        const browser = await chromium.launch({
            headless: true,
            proxy: PROXY_SERVER ? { server: PROXY_SERVER } : undefined,
            args: ["--disable-blink-features=AutomationControlled"] // Helps bypass bot detection
        });

        const page = await browser.newPage();

        // ✅ Auto-Retry Mechanism (3 attempts)
        let success = false;
        for (let i = 0; i < 3; i++) {
            try {
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
                success = true;
                break;
            } catch (error) {
                console.warn(`Retry ${i + 1}: Failed to load ${url}`);
            }
        }

        if (!success) {
            await browser.close();
            return res.status(500).json({ error: "Failed to fetch website after multiple attempts" });
        }

        // ✅ Extract Full HTML
        const content = await page.content();
        const $ = cheerio.load(content);

        // ✅ Remove Ads, Trackers & Heavy Scripts
        $("script").remove(); // Removes all scripts to avoid tracking
        $("iframe").remove(); // Removes embedded ads & third-party iframes

        // ✅ Convert Relative URLs to Absolute
        const absoluteUrl = (relativePath) => new URL(relativePath, url).href;

        $("img").each((_, img) => {
            const src = $(img).attr("src");
            if (src && !src.startsWith("http")) $(img).attr("src", absoluteUrl(src));
        });

        $("link[rel='stylesheet']").each((_, link) => {
            const href = $(link).attr("href");
            if (href && !href.startsWith("http")) $(link).attr("href", absoluteUrl(href));
        });

        // ✅ Convert Images to WebP
        const images = [];
        for (const img of $("img").toArray()) {
            const imgSrc = $(img).attr("src");
            if (imgSrc) {
                try {
                    const response = await page.goto(imgSrc);
                    if (response.ok()) {
                        const imgBuffer = await response.body();
                        const webpBuffer = await convertToWebP(imgBuffer);
                        const base64WebP = `data:image/webp;base64,${webpBuffer.toString("base64")}`;
                        $(img).attr("src", base64WebP);
                        images.push(base64WebP);
                    }
                } catch (error) {
                    console.warn("❌ Image Load Error:", error);
                }
            }
        }

        const pageData = {
            title: $("title").text(),
            html: $.html(),
            styles: $("link[rel='stylesheet']").map((_, link) => $(link).attr("href")).get(),
            images: images
        };

        await browser.close();

        // ✅ Cache in Redis for 5 minutes
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
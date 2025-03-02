const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { chromium } = require("playwright");
const fetch = require("node-fetch"); // Ensure fetch is available
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
            return res.send(cachedData);
        }

        console.log("🚀 Cache miss, scraping...");

        // ✅ Launch Playwright Browser
        const browser = await chromium.launch({
            headless: true,
            executablePath: "/opt/render/project/src/node_modules/playwright-core/.local-browsers/chromium-1155/chrome-linux/chrome"
        });

        const page = await browser.newPage();

        // ✅ Modify requests to serve assets via proxy
        await page.route("**/*", async (route) => {
            const request = route.request();
            const reqUrl = request.url();

            // Allow only valid URLs
            if (!reqUrl.startsWith("http")) {
                return route.continue();
            }

            // Skip unnecessary requests (ads, trackers)
            if (reqUrl.includes("google-analytics") || reqUrl.includes("ads") || reqUrl.includes("tracking")) {
                return route.abort();
            }

            // Proxy images, CSS, and scripts
            if (["image", "stylesheet", "script"].includes(request.resourceType())) {
                return route.continue({ url: `/proxy/static?url=${encodeURIComponent(reqUrl)}` });
            }

            return route.continue();
        });

        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

        // ✅ Get Full Page Content
        const pageContent = await page.content();
        await browser.close();

        // ✅ Cache in Redis for 5 mins
        await redisClient.setEx(url, 300, pageContent);

        console.log("✅ Data cached successfully");

        res.send(pageContent);
    } catch (error) {
        console.error("❌ Scraping Error:", error);
        res.status(500).json({ error: "Failed to fetch website" });
    }
});

// ✅ Serve Static Assets via Proxy
app.get("/proxy/static", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Asset URL is required" });

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const contentType = response.headers.get("content-type");
        res.set("Content-Type", contentType);
        res.send(await response.arrayBuffer());
    } catch (error) {
        console.error("❌ Error fetching asset:", error);
        res.status(500).json({ error: "Failed to fetch asset" });
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

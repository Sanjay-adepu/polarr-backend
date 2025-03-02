const express = require("express");
const cors = require("cors");
const redis = require("redis");
const fetch = require("node-fetch");

const app = express();

// ✅ CORS Setup
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ✅ Redis Setup
const REDIS_URL = process.env.REDIS_URL || "redis://default:AXzeAAIjcDEzMzNlODE2YjViNWU0ZWU2OGYzYTc5YzVmYzNhY2Q2ZHAxMA@modest-corgi-31966.upstash.io:6379";

const redisClient = redis.createClient({ url: REDIS_URL, socket: { tls: true } });

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));

redisClient.connect()
    .then(() => console.log("✅ Redis Connected"))
    .catch(err => console.error("❌ Redis Connection Failed:", err));

// ✅ Increase Max Event Listeners (Prevents Memory Leak)
require("events").EventEmitter.defaultMaxListeners = 50;

// ✅ Proxy Route
app.get("/proxy", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        console.log(`Fetching URL: ${url}`);

        // ✅ Check Redis Cache First
        const cachedData = await redisClient.get(url);
        if (cachedData) {
            console.log("✅ Cache hit");
            return res.send(cachedData);
        }

        // ✅ Direct Fetch as Fallback (Avoid Playwright / Proxy Issues)
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
                "Accept-Encoding": "gzip, deflate, br"
            },
            timeout: 25000 // ✅ 25s Timeout
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const html = await response.text();

        // ✅ Cache in Redis for 5 mins
        await redisClient.setEx(url, 300, html);

        console.log("✅ Data cached successfully");

        res.send(html);
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        res.status(500).json({ error: "Failed to fetch website" });
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

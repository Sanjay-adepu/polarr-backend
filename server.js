const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ✅ Configure CORS for Frontend
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

// ✅ Reverse Proxy Middleware (For Any Website)
app.use("/proxy", async (req, res, next) => {
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

        // ✅ Reverse Proxy Request
        createProxyMiddleware({
            target: url,
            changeOrigin: true,
            followRedirects: true,
            ws: true,
            selfHandleResponse: true,
            onProxyRes: async (proxyRes, req, res) => {
                let body = "";
                proxyRes.on("data", (chunk) => (body += chunk));
                proxyRes.on("end", async () => {
                    // ✅ Cache in Redis for 5 mins
                    await redisClient.setEx(url, 300, body);
                    console.log("✅ Data cached successfully");
                    res.send(body);
                });
            },
            onError: (err, req, res) => {
                console.error("❌ Proxy Error:", err);
                res.status(500).json({ error: "Proxy failed" });
            }
        })(req, res, next);
    } catch (error) {
        console.error("❌ Proxy Error:", error);
        res.status(500).json({ error: "Failed to fetch website" });
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

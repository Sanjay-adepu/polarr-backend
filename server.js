const express = require("express");
const cors = require("cors");
const { createProxyMiddleware } = require("http-proxy-middleware");
const redis = require("redis");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Redis Setup
const REDIS_URL = process.env.REDIS_URL || "redis://default:AXzeAAIjcDEzMzNlODE2YjViNWU0ZWU2OGYzYTc5YzVmYzNhY2Q2ZHAxMA@modest-corgi-31966.upstash.io:6379";
const redisClient = redis.createClient({ url: REDIS_URL, socket: { tls: true } });

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));
redisClient.connect()
    .then(() => console.log("✅ Redis Connected"))
    .catch(err => console.error("❌ Redis Connection Failed:", err));

// ✅ Reverse Proxy Middleware
app.use("/proxy", createProxyMiddleware({
    target: "", // Will be set dynamically
    changeOrigin: true,
    selfHandleResponse: false,
    onProxyReq: (proxyReq, req) => {
        const url = req.query.url;
        if (url) {
            proxyReq.setHeader("host", new URL(url).host);
            proxyReq.path = new URL(url).pathname + new URL(url).search;
            proxyReq.setHeader("Referer", url);
        }
    }
}));

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

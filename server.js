const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// Configure CORS for your frontend (adjust the origin as needed)
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// --- Redis Setup ---
const REDIS_URL = process.env.REDIS_URL || "redis://default:YOUR_UPSTASH_REDIS_URL_HERE";
const redisClient = redis.createClient({
  url: REDIS_URL,
  socket: { tls: true }
});

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));

redisClient.connect()
  .then(() => console.log("✅ Redis Connected"))
  .catch(err => console.error("❌ Redis Connection Failed:", err));

// --- Reverse Proxy with Redis Caching ---
// This route will act as a reverse proxy. It expects a query parameter "url"
// e.g. GET /proxy?url=https://www.example.com
app.use("/proxy", async (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    console.log(`Fetching URL: ${targetUrl}`);

    // Check if the response for this URL is cached in Redis
    const cachedData = await redisClient.get(targetUrl);
    if (cachedData) {
      console.log("✅ Cache hit");
      return res.send(cachedData);
    }

    // Create and use the proxy middleware with selfHandleResponse so we can capture the response
    const proxy = createProxyMiddleware({
      target: targetUrl, // dynamically set the target
      changeOrigin: true,
      followRedirects: true,
      selfHandleResponse: true, // we want to capture the response body
      timeout: 60000,
      proxyTimeout: 60000,
      onProxyReq: (proxyReq, req, res) => {
        // Set headers to mimic a regular browser
        proxyReq.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36");
      },
      onProxyRes: (proxyRes, req, res) => {
        let body = "";
        // Collect the response data
        proxyRes.on("data", (chunk) => {
          body += chunk.toString();
        });
        proxyRes.on("end", async () => {
          try {
            // Cache the response body in Redis for 5 minutes (300 seconds)
            await redisClient.setEx(targetUrl, 300, body);
            console.log("✅ Data cached successfully");
          } catch (cacheError) {
            console.error("❌ Failed to cache data:", cacheError);
          }
          // Send the response body to the client
          res.send(body);
        });
      },
      onError: (err, req, res) => {
        console.error("❌ Proxy Error:", err);
        res.status(500).json({ error: "Proxy failed" });
      }
    });

    return proxy(req, res, next);

  } catch (error) {
    console.error("❌ Proxy Route Error:", error);
    return res.status(500).json({ error: "Failed to fetch website" });
  }
});

// --- Start the Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

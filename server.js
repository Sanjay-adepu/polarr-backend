const express = require("express");
const cors = require("cors");
const redis = require("redis");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const urlLib = require("url");

const app = express();

// ✅ Configure CORS for Frontend
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ✅ Redis Setup
const REDIS_URL = process.env.REDIS_URL || "redis://default:AXzeAAIjcDEzMzNlODE2YjViNWU0ZWU2OGYzYTc5YzVmYzNhY2Q2ZHAxMA@modest-corgi-31966.upstash.io:6379";

const redisClient = redis.createClient({ url: REDIS_URL, socket: { tls: true } });

redisClient.on("error", (err) => console.error("❌ Redis Error:", err));

redisClient
  .connect()
  .then(() => console.log("✅ Redis Connected"))
  .catch((err) => console.error("❌ Redis Connection Failed:", err));

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

    // ✅ Use Explicit Browser Path
    const browser = await chromium.launch({
      headless: true,
      executablePath:
        "/opt/render/project/src/node_modules/playwright-core/.local-browsers/chromium-1155/chrome-linux/chrome",
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const content = await page.content();
    const $ = cheerio.load(content);

    const baseUrl = urlLib.parse(url).protocol + "//" + urlLib.parse(url).host;

    // ✅ Extract & Fix Asset Links
    const fixUrl = (src) => {
      if (!src) return null;
      return src.startsWith("http") ? src : baseUrl + src;
    };

    const styles = $("link[rel='stylesheet']")
      .map((_, el) => fixUrl($(el).attr("href")))
      .get();

    const scripts = $("script[src]")
      .map((_, el) => fixUrl($(el).attr("src")))
      .get();

    const images = $("img[src]")
      .map((_, el) => fixUrl($(el).attr("src")))
      .get();

    const pageData = {
      title: $("title").text(),
      html: $.html(),
      styles,
      scripts,
      images,
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
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

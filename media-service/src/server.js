require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const Redis = require("ioredis");
const rateLimit = require("express-rate-limit").rateLimit;
const { RedisStore } = require("rate-limit-redis");
const mediaRoutes = require("./routes/media-routes");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { connectToRabbitMQ, consumeEvent } = require("./utils/rabbitmq");
const { handlePostDeleted } = require("./eventHandlers/media-event-handlers");
const { authenticateRequest } = require("./middleware/authMiddleware");

const app = express();
const PORT = process.env.PORT || 3003;

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => logger.info("✅ Connected to MongoDB"))
  .catch((e) => logger.error("❌ MongoDB connection error:", e));

// Connect to Redis
const redisClient = new Redis(process.env.REDIS_URL);
redisClient.on("connect", () => {
  logger.info("✅ Connected to Redis successfully");
});
redisClient.on("error", (err) => {
  logger.error("❌ Redis connection error:", err);
});

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

app.use((req, res, next) => {
  logger.info(`📥 Received ${req.method} request to ${req.url}`);
  logger.debug(`📦 Request body: ${JSON.stringify(req.body)}`);
  next();
});

// IP-based Rate Limiting for Sensitive Endpoints
const sensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ success: false, message: "Too many requests" });
  },
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
  }),
});

// Routes
app.use(
  "/api/media",
  authenticateRequest, // Add authentication middleware
  sensitiveRateLimiter,
  (req, res, next) => {
    req.redisClient = redisClient;
    next();
  },
  mediaRoutes
);

// Error Handler
app.use(errorHandler);

// Start Server
async function startServer() {
  try {
    await connectToRabbitMQ();
    await consumeEvent("post.deleted", handlePostDeleted);
    app.listen(PORT, () => {
      logger.info(`🚀 Media service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const Redis = require("ioredis");
const cors = require("cors");
const helmet = require("helmet");
const postRoutes = require("./routes/post-routes");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { connectToRabbitMQ } = require("./utils/rabbitmq");
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");

const app = express();
const PORT = process.env.PORT || 3002;

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => logger.success("✅ Connected to MongoDB"))
  .catch((e) => logger.error("❌ MongoDB connection error", e));

// Redis Connection
const redisClient = new Redis(process.env.REDIS_URL);

redisClient.on("connect", () => {
  logger.success("✅ Connected to Redis");
});

redisClient.on("error", (err) => {
  logger.error("❌ Redis connection error", err);
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Logging all requests
app.use((req, res, next) => {
  logger.info(`➡️  ${req.method} ${req.url}`);
  if (Object.keys(req.body).length) {
    logger.debug(`📦 Body: ${JSON.stringify(req.body)}`);
  }
  next();
});

// Rate Limiting for sensitive endpoints (e.g., create post)
const sensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
  }),
  handler: (req, res) => {
    logger.warn(`🚫 Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ success: false, message: "Too many requests" });
  },
});

// Routes
app.use(
  "/api/posts",
  (req, res, next) => {
    req.redisClient = redisClient;
    next();
  },
  sensitiveRateLimiter, // Apply rate limiting to all post routes (optional: only POST routes)
  postRoutes
);

// Global error handler
app.use(errorHandler);

// Start the server after RabbitMQ is connected
async function startServer() {
  try {
    await connectToRabbitMQ();
    logger.success("✅ Connected to RabbitMQ");
    app.listen(PORT, () => {
      logger.info(`🚀 Post service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("❌ Failed to start server", error);
    process.exit(1);
  }
}

startServer();

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at", promise, "reason:", reason);
});

// Graceful shutdown (optional)
process.on("SIGINT", () => {
  logger.warn("🛑 Gracefully shutting down...");
  redisClient.quit();
  mongoose.disconnect();
  process.exit(0);
});

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const Redis = require("ioredis");
const cors = require("cors");
const helmet = require("helmet");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { connectToRabbitMQ, consumeEvent } = require("./utils/rabbitmq");
const searchRoutes = require("./routes/search-routes");
const { handlePostCreated, handlePostDeleted } = require("./eventHandlers/search-event-handlers");
const { rateLimit } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");

const app = express();
const PORT = process.env.PORT || 3004;

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => logger.info("Connected to MongoDB"))
  .catch((e) => logger.error("MongoDB connection error", e));

const redisClient = new Redis(process.env.REDIS_URL);
redisClient.on("connect", () => {
  logger.info("Connected to Redis successfully");
});

redisClient.on("error", (err) => {
  logger.error("Redis connection error", err);
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  logger.info(`Received ${req.method} request to ${req.url}`);
  logger.info(`Request body: ${JSON.stringify(req.body)}`);
  next();
});

// Homework: IP-based rate limiting for sensitive endpoints
const sensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
  }),
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: "Too many requests",
    });
  },
});

// Homework: Pass Redis client and implement Redis caching
app.use(
  "/api/search",
  sensitiveRateLimiter,
  (req, res, next) => {
    req.redisClient = redisClient;
    next();
  },
  searchRoutes
);

app.use(errorHandler);

async function startServer() {
  try {
    await connectToRabbitMQ();

    // Consume the events / subscribe to the events
    await consumeEvent("post.created", handlePostCreated);
    await consumeEvent("post.deleted", handlePostDeleted);

    app.listen(PORT, () => {
      logger.info(`Search service is running on port: ${PORT}`);
    });
  } catch (e) {
    logger.error(e, "Failed to start search service");
    process.exit(1);
  }
}

startServer();

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at", promise, "reason:", reason);
});
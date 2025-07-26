import express from "express";
import { DockerLoadBalancer } from "./docker-load-balancer";
import { loadConfig } from "./utils/read-config";

const app = express();

// Load configuration
const config = loadConfig();

// Initialize Docker load balancer
const loadBalancer = new DockerLoadBalancer(config);

// Status endpoint
app.get("/lb-status", (req, res) => {
  res.json(loadBalancer.getStatus());
});

// Health endpoint for the load balancer itself
app.get("/health", (req, res) => {
  const status = loadBalancer.getStatus();
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    instances: status,
  });
});

// Main proxy handler
app.use((req, res) => {
  loadBalancer.handleRequest(req, res);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\n[🛑] Shutting down gracefully...");
  await loadBalancer.shutdown();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`🚀 Docker Load Balancer running on http://localhost:${PORT}`);
  try {
    await loadBalancer.initialize();
  } catch (error) {
    console.error("Failed to initialize load balancer:", error);
    process.exit(1);
  }
});

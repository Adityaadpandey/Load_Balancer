import express from "express";
import { LoadBalancer } from "./module";

const app = express();

// Initialize load balancer
const loadBalancer = new LoadBalancer();

// Status endpoint
app.get("/lb-status", (req, res) => {
  res.json(loadBalancer.getStatus());
});

// Main proxy handler
app.use((req, res) => {
  loadBalancer.handleRequest(req, res);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[!] Shutting down gracefully...");
  loadBalancer.shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[!] Shutting down gracefully...");
  loadBalancer.shutdown();
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`🚀 Load Balancer running on http://localhost:${PORT}`);
  await loadBalancer.initialize();
});

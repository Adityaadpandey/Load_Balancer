import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { type Request, type Response } from "express";
import http from "http";
import type { Instance } from "../types";
import { loadConfig } from "../utils/read-config";

const config = loadConfig();

export class LoadBalancer {
  private instances: Instance[] = [];
  private nextPort = 5001;
  private healthCheckInterval?: NodeJS.Timeout;
  private scaleCheckInterval?: NodeJS.Timeout;
  SERVER_TIMEOUT: number = 30000; // 30 secondss

  constructor() {
    this.startHealthChecks();
    this.startScaleChecks();
  }

  private getNextPort(): number {
    return this.nextPort++;
  }

  private async spawnInstance(): Promise<Instance> {
    const port = this.getNextPort();
    const id = randomUUID();

    const proc = spawn("bun", [config.location, "--port", port.toString()], {
      stdio: "pipe", // Changed from "inherit" for better control
      detached: false,
    });

    const instance: Instance = {
      id,
      port,
      process: proc,
      lastHealth: Date.now(),
      isHealthy: false, // Start as unhealthy until first health check
      activeRequests: 0,
      totalRequests: 0,
      lastRequestTime: Date.now(),
      responseTime: 0,
    };

    // Handle process events
    proc.on("error", (error) => {
      console.error(`[!] Instance ${id} error:`, error.message);
      this.removeInstance(instance);
    });

    proc.on("exit", (code) => {
      console.log(`[!] Instance ${id} exited with code ${code}`);
      this.removeInstance(instance);
    });

    this.instances.push(instance);
    console.log(`[+] Spawned instance ${id} on port ${port}`);

    // Wait for instance to be ready
    await this.waitForInstanceReady(instance);
    return instance;
  }

  private async waitForInstanceReady(instance: Instance, maxWait = 10000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        await this.checkInstanceHealth(instance);
        if (instance.isHealthy) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.warn(`[!] Instance ${instance.id} failed to become ready, removing`);
    this.removeInstance(instance);
  }

  private killInstance(instance: Instance) {
    console.log(`[-] Killing instance ${instance.id} on port ${instance.port}`);
    try {
      instance.process.kill("SIGTERM");
      // Force kill after 5 seconds if not terminated
      setTimeout(() => {
        if (!instance.process.killed) {
          instance.process.kill("SIGKILL");
        }
      }, 5000);
    } catch (error) {
      console.error(`[!] Error killing instance ${instance.id}:`, error);
    }
  }

  private removeInstance(instance: Instance) {
    const index = this.instances.indexOf(instance);
    if (index > -1) {
      this.instances.splice(index, 1);
    }
  }

  private async checkInstanceHealth(instance: Instance): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const req = http.get(`http://localhost:${instance.port}/health`, { timeout: 2000 }, (res) => {
        const responseTime = Date.now() - startTime;

        if (res.statusCode === 200) {
          instance.lastHealth = Date.now();
          instance.isHealthy = true;
          instance.responseTime = responseTime;
          resolve();
        } else {
          instance.isHealthy = false;
          reject(new Error(`Health check failed: ${res.statusCode}`));
        }
      });

      req.on("error", (error) => {
        instance.isHealthy = false;
        reject(error);
      });

      req.on("timeout", () => {
        req.destroy();
        instance.isHealthy = false;
        reject(new Error("Health check timeout"));
      });
    });
  }

  private async healthCheckAll() {
    const healthPromises = this.instances.map(
      (instance) => this.checkInstanceHealth(instance).catch(() => {}) // Ignore individual failures
    );

    await Promise.allSettled(healthPromises);
  }

  private getHealthyInstances(): Instance[] {
    return this.instances.filter((i) => i.isHealthy);
  }

  private getInstanceLoad(instance: Instance): number {
    // Calculate load based on active requests and response time
    const requestLoad = instance.activeRequests;
    const responseTimeWeight = Math.max(0, (instance.responseTime - 100) / 1000); // Penalty for slow responses
    return requestLoad + responseTimeWeight;
  }

  private shouldScaleUp(): boolean {
    const healthy = this.getHealthyInstances();
    if (healthy.length >= config.maxInstances) return false;
    if (healthy.length < config.minInstances) return true;

    // Scale up if average load is high
    const avgLoad = healthy.reduce((sum, i) => sum + this.getInstanceLoad(i), 0) / healthy.length;
    const highLoadThreshold = 3; // Scale up if average load > 3 requests per instance

    return avgLoad > highLoadThreshold;
  }

  private shouldScaleDown(): boolean {
    const healthy = this.getHealthyInstances();
    if (healthy.length <= config.minInstances) return false;

    // Scale down if instances are idle
    const now = Date.now();
    const idleThreshold = this.SERVER_TIMEOUT; // 30 seconds
    const lowLoadThreshold = 0.5;

    const avgLoad = healthy.reduce((sum, i) => sum + this.getInstanceLoad(i), 0) / healthy.length;
    const hasIdleInstances = healthy.some(
      (i) => now - i.lastRequestTime > idleThreshold && i.activeRequests === 0
    );

    return avgLoad < lowLoadThreshold && hasIdleInstances;
  }

  private async autoScale() {
    const healthy = this.getHealthyInstances();
    // console.log(`[---] Healthy: ${healthy.length}, Total: ${this.instances.length}`);

    if (this.shouldScaleUp()) {
      console.log(`[⇡] Scaling up - current load too high`);
      try {
        await this.spawnInstance();
      } catch (error) {
        console.error(`[!] Failed to scale up:`, error);
      }
    } else if (this.shouldScaleDown()) {
      console.log(`[⇣] Scaling down - instances idle`);

      // Find the most idle instance to remove
      const candidate = healthy
        .filter((i) => i.activeRequests === 0)
        .sort((a, b) => a.lastRequestTime - b.lastRequestTime)[0];

      if (candidate) {
        this.killInstance(candidate);
        this.removeInstance(candidate);
      }
    }
  }

  private pickInstance(): Instance | null {
    const healthy = this.getHealthyInstances();
    if (healthy.length === 0) return null;

    // Weighted round-robin based on load
    const leastLoaded = healthy.reduce((min, instance) =>
      this.getInstanceLoad(instance) < this.getInstanceLoad(min) ? instance : min
    );

    return leastLoaded;
  }

  private startHealthChecks() {
    this.healthCheckInterval = setInterval(async () => {
      await this.healthCheckAll();
    }, Math.min(config.checkInterval, 5000)); // Health checks more frequent than scaling
  }

  private startScaleChecks() {
    this.scaleCheckInterval = setInterval(async () => {
      await this.autoScale();
    }, config.checkInterval);
  }

  async handleRequest(req: Request, res: Response) {
    const instance = this.pickInstance();

    if (!instance) {
      return res.status(503).json({
        error: "No healthy backend servers available",
        instances: this.instances.length,
        healthy: this.getHealthyInstances().length,
      });
    }

    instance.activeRequests++;
    instance.totalRequests++;
    instance.lastRequestTime = Date.now();

    const startTime = Date.now();

    const options = {
      hostname: "localhost",
      port: instance.port,
      path: req.originalUrl,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${instance.port}` },
      timeout: this.SERVER_TIMEOUT, // 30 second timeout
    };

    const proxyReq = http.request(options, (proxyRes) => {
      // Forward status and headers
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);

      proxyRes.pipe(res, { end: true });

      proxyRes.on("end", () => {
        instance.activeRequests = Math.max(0, instance.activeRequests - 1);
        instance.responseTime = Date.now() - startTime;
      });
    });

    proxyReq.on("error", (error) => {
      console.error(`[!] Proxy error for instance ${instance.id}:`, error.message);
      instance.activeRequests = Math.max(0, instance.activeRequests - 1);

      if (!res.headersSent) {
        res.status(502).json({
          error: "Bad Gateway",
          message: "Backend server error",
        });
      }
    });

    proxyReq.on("timeout", () => {
      console.warn(`[!] Request timeout for instance ${instance.id}`);
      proxyReq.destroy();
      instance.activeRequests = Math.max(0, instance.activeRequests - 1);

      if (!res.headersSent) {
        res.status(504).json({
          error: "Gateway Timeout",
          message: "Backend server timeout",
        });
      }
    });

    req.pipe(proxyReq, { end: true });
  }

  async initialize() {
    console.log(`🚀 Load Balancer starting...`);

    // Spawn initial instances
    const spawnPromises = Array(config.minInstances)
      .fill(0)
      .map(() =>
        this.spawnInstance().catch((error) => {
          console.error("[!] Failed to spawn initial instance:", error);
          return null;
        })
      );

    await Promise.allSettled(spawnPromises);

    const healthy = this.getHealthyInstances().length;
    console.log(`🚀 Load Balancer ready with ${healthy}/${config.minInstances} instances`);
  }

  getStatus() {
    const healthy = this.getHealthyInstances();
    return {
      total: this.instances.length,
      healthy: healthy.length,
      instances: this.instances.map((i) => ({
        id: i.id,
        port: i.port,
        healthy: i.isHealthy,
        activeRequests: i.activeRequests,
        totalRequests: i.totalRequests,
        responseTime: i.responseTime,
        load: this.getInstanceLoad(i),
      })),
    };
  }

  shutdown() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.scaleCheckInterval) clearInterval(this.scaleCheckInterval);

    this.instances.forEach((instance) => this.killInstance(instance));
  }
}

import { type Request, type Response } from "express";
import http from "http";
import { DockerManager } from "./docker-manager";
import type { AppConfig, DockerInstance } from "./types";

export class DockerLoadBalancer {
  private instances: DockerInstance[] = [];
  private nextPort = 5001;
  private healthCheckInterval?: NodeJS.Timeout;
  private scaleCheckInterval?: NodeJS.Timeout;
  private dockerManager: DockerManager;
  private config: AppConfig;
  private readonly SERVER_TIMEOUT = 30000; // 30 seconds

  constructor(config: AppConfig) {
    this.config = config;
    this.dockerManager = new DockerManager(config);
    this.startHealthChecks();
    this.startScaleChecks();
  }

  private getNextPort(): number {
    return this.nextPort++;
  }

  private async spawnInstance(): Promise<DockerInstance> {
    const port = this.getNextPort();

    try {
      const instance = await this.dockerManager.createContainer(port);
      this.instances.push(instance);

      // Wait for container to be ready
      await this.waitForInstanceReady(instance);
      return instance;
    } catch (error) {
      console.error(`[!] Failed to spawn instance: ${error}`);
      throw error;
    }
  }

  private async waitForInstanceReady(instance: DockerInstance, maxWait = 30000): Promise<void> {
    const startTime = Date.now();
    instance.status = "starting";

    while (Date.now() - startTime < maxWait) {
      try {
        const containerStatus = await this.dockerManager.getContainerStatus(instance);

        if (containerStatus === "running") {
          instance.status = "running";
          await this.checkInstanceHealth(instance);
          if (instance.isHealthy) {
            console.log(`[+] Instance ${instance.containerName} is ready`);
            return;
          }
        } else if (containerStatus === "exited" || containerStatus === "not-found") {
          throw new Error(`Container failed to start: ${containerStatus}`);
        }
      } catch (error) {
        console.warn(`[!] Waiting for instance ${instance.containerName}: ${error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.error(`[!] Instance ${instance.containerName} failed to become ready, removing`);
    await this.removeInstance(instance);
    throw new Error(`Instance failed to become ready within ${maxWait}ms`);
  }

  private async removeInstance(instance: DockerInstance): Promise<void> {
    const index = this.instances.indexOf(instance);
    if (index > -1) {
      this.instances.splice(index, 1);
    }

    await this.dockerManager.removeContainer(instance);
  }

  private async checkInstanceHealth(instance: DockerInstance): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const healthUrl = `http://localhost:${instance.port}${this.config.healthEndpoint}`;

      const req = http.get(
        healthUrl,
        {
          timeout: this.config.healthTimeout,
        },
        (res) => {
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
        }
      );

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

  private async healthCheckAll(): Promise<void> {
    const healthPromises = this.instances.map((instance) =>
      this.checkInstanceHealth(instance).catch(() => {})
    );

    await Promise.allSettled(healthPromises);

    // Remove unhealthy instances that have been unhealthy for too long
    const now = Date.now();
    const unhealthyInstances = this.instances.filter(
      (i) => !i.isHealthy && now - i.lastHealth > 60000 // 1 minute
    );

    for (const instance of unhealthyInstances) {
      console.log(`[-] Removing persistently unhealthy instance: ${instance.containerName}`);
      await this.removeInstance(instance);
    }
  }

  private getHealthyInstances(): DockerInstance[] {
    return this.instances.filter((i) => i.isHealthy && i.status === "running");
  }

  private getInstanceLoad(instance: DockerInstance): number {
    const requestLoad = instance.activeRequests;
    const responseTimeWeight = Math.max(0, (instance.responseTime - 100) / 1000);
    return requestLoad + responseTimeWeight;
  }

  private shouldScaleUp(): boolean {
    const healthy = this.getHealthyInstances();
    if (healthy.length >= this.config.maxInstances) return false;
    if (healthy.length < this.config.minInstances) return true;

    const avgLoad = healthy.reduce((sum, i) => sum + this.getInstanceLoad(i), 0) / healthy.length;
    return avgLoad > this.config.scaleUpThreshold;
  }

  private shouldScaleDown(): boolean {
    const healthy = this.getHealthyInstances();
    if (healthy.length <= this.config.minInstances) return false;

    const now = Date.now();
    const avgLoad = healthy.reduce((sum, i) => sum + this.getInstanceLoad(i), 0) / healthy.length;
    const hasIdleInstances = healthy.some(
      (i) => now - i.lastRequestTime > this.config.idleTimeout && i.activeRequests === 0
    );

    return avgLoad < this.config.scaleDownThreshold && hasIdleInstances;
  }

  private async autoScale(): Promise<void> {
    const healthy = this.getHealthyInstances();

    if (this.shouldScaleUp()) {
      console.log(`[⬆] Scaling up - current load: ${healthy.length} instances`);
      try {
        await this.spawnInstance();
      } catch (error) {
        console.error(`[!] Failed to scale up: ${error}`);
      }
    } else if (this.shouldScaleDown()) {
      console.log(`[⬇] Scaling down - instances idle`);

      const candidate = healthy
        .filter((i) => i.activeRequests === 0)
        .sort((a, b) => a.lastRequestTime - b.lastRequestTime)[0];

      if (candidate) {
        await this.removeInstance(candidate);
      }
    }
  }

  private pickInstance(): DockerInstance | null {
    const healthy = this.getHealthyInstances();
    if (healthy.length === 0) return null;

    const leastLoaded = healthy.reduce((min, instance) =>
      this.getInstanceLoad(instance) < this.getInstanceLoad(min) ? instance : min
    );

    return leastLoaded;
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.healthCheckAll();
    }, Math.min(this.config.checkInterval, 5000));
  }

  private startScaleChecks(): void {
    this.scaleCheckInterval = setInterval(async () => {
      await this.autoScale();
    }, this.config.checkInterval);
  }

  async handleRequest(req: Request, res: Response): Promise<any> {
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
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res, { end: true });

      proxyRes.on("end", () => {
        instance.activeRequests = Math.max(0, instance.activeRequests - 1);
        instance.responseTime = Date.now() - startTime;
      });
    });

    proxyReq.on("error", (error) => {
      console.error(`[!] Proxy error for instance ${instance.containerName}: ${error.message}`);
      instance.activeRequests = Math.max(0, instance.activeRequests - 1);

      if (!res.headersSent) {
        res.status(502).json({
          error: "Bad Gateway",
          message: "Backend server error",
        });
      }
    });

    proxyReq.on("timeout", () => {
      console.warn(`[!] Request timeout for instance ${instance.containerName}`);
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

  async initialize(): Promise<void> {
    console.log(`Load Balancer starting...`);

    // Cleanup any orphaned containers from previous runs
    await this.dockerManager.cleanupOrphanedContainers();

    // Pull the Docker image
    await this.dockerManager.pullImage();

    // Spawn initial instances
    const spawnPromises = Array(this.config.minInstances)
      .fill(0)
      .map(() =>
        this.spawnInstance().catch((error) => {
          console.error("[!] Failed to spawn initial instance:", error);
          return null;
        })
      );

    await Promise.allSettled(spawnPromises);

    const healthy = this.getHealthyInstances().length;
    console.log(`Docker Load Balancer ready with ${healthy}/${this.config.minInstances} instances`);
  }

  getStatus() {
    const healthy = this.getHealthyInstances();
    return {
      total: this.instances.length,
      healthy: healthy.length,
      dockerImage: this.config.dockerImage,
      instances: this.instances.map((i) => ({
        id: i.id,
        containerId: i.containerId,
        containerName: i.containerName,
        port: i.port,
        healthy: i.isHealthy,
        status: i.status,
        activeRequests: i.activeRequests,
        totalRequests: i.totalRequests,
        responseTime: i.responseTime,
        load: this.getInstanceLoad(i),
      })),
    };
  }

  async shutdown(): Promise<void> {
    console.log(`[X] Shutting down Docker Load Balancer...`);

    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.scaleCheckInterval) clearInterval(this.scaleCheckInterval);

    // Remove all instances
    const removalPromises = this.instances.map((instance) =>
      this.removeInstance(instance).catch((error) =>
        console.error(`Failed to remove instance ${instance.containerName}:`, error)
      )
    );

    await Promise.allSettled(removalPromises);
    console.log(`[X] Docker Load Balancer shutdown complete`);
  }
}

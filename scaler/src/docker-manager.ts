import { spawn } from "child_process";
import { randomUUID } from "crypto";
import type { AppConfig, DockerInstance } from "./types";

export class DockerManager {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  private async executeDockerCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn("docker", args, { stdio: "pipe" });
      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Docker command failed: ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(error);
      });
    });
  }

  async pullImage(): Promise<void> {
    if (this.config.pullPolicy === "never") return;

    try {
      console.log(`[🐳] Pulling Docker image: ${this.config.dockerImage}`);
      await this.executeDockerCommand(["pull", this.config.dockerImage]);
      console.log(`[✅] Successfully pulled image: ${this.config.dockerImage}`);
    } catch (error) {
      if (this.config.pullPolicy === "always") {
        throw error;
      }
      console.warn(`[⚠️] Failed to pull image, using local version: ${error}`);
    }
  }

  async createContainer(port: number): Promise<DockerInstance> {
    const id = randomUUID();
    const containerName = `${this.config.containerPrefix}-${id.substring(0, 8)}`;

    const dockerArgs = [
      "run",
      "-d",
      "--name",
      containerName,
      "-p",
      `${port}:${this.config.containerPort}`,
    ];

    // Add environment variables
    Object.entries(this.config.environment).forEach(([key, value]) => {
      dockerArgs.push("-e", `${key}=${value}`);
    });

    // Add volumes if specified
    if (this.config.volumes) {
      this.config.volumes.forEach((volume) => {
        dockerArgs.push("-v", volume);
      });
    }

    // Add network if specified
    if (this.config.network) {
      dockerArgs.push("--network", this.config.network);
    }

    // Add restart policy
    dockerArgs.push("--restart", "unless-stopped");

    // Add image
    dockerArgs.push(this.config.dockerImage);

    try {
      console.log(`[🐳] Creating container: ${containerName} on port ${port}`);
      const containerId = await this.executeDockerCommand(dockerArgs);

      const instance: DockerInstance = {
        id,
        containerId: containerId.substring(0, 12),
        port,
        containerName,
        lastHealth: Date.now(),
        isHealthy: false,
        activeRequests: 0,
        totalRequests: 0,
        lastRequestTime: Date.now(),
        responseTime: 0,
        status: "starting",
      };

      console.log(`[✅] Container created: ${containerName} (${instance.containerId})`);
      return instance;
    } catch (error) {
      console.error(`[❌] Failed to create container: ${error}`);
      throw error;
    }
  }

  async removeContainer(instance: DockerInstance): Promise<void> {
    try {
      console.log(`[🗑️] Removing container: ${instance.containerName}`);

      // Stop container gracefully
      await this.executeDockerCommand(["stop", instance.containerId]);
      instance.status = "stopping";

      // Remove container
      await this.executeDockerCommand(["rm", instance.containerId]);
      instance.status = "stopped";

      console.log(`[✅] Container removed: ${instance.containerName}`);
    } catch (error) {
      console.error(`[❌] Failed to remove container ${instance.containerName}: ${error}`);

      // Force remove if graceful removal fails
      try {
        await this.executeDockerCommand(["rm", "-f", instance.containerId]);
        console.log(`[✅] Force removed container: ${instance.containerName}`);
      } catch (forceError) {
        console.error(`[❌] Failed to force remove container: ${forceError}`);
      }
    }
  }

  async getContainerStatus(instance: DockerInstance): Promise<string> {
    try {
      const status = await this.executeDockerCommand([
        "inspect",
        "--format",
        "{{.State.Status}}",
        instance.containerId,
      ]);
      return status.toLowerCase();
    } catch {
      return "not-found";
    }
  }

  async listManagedContainers(): Promise<string[]> {
    try {
      const containers = await this.executeDockerCommand([
        "ps",
        "-a",
        "--filter",
        `name=${this.config.containerPrefix}`,
        "--format",
        "{{.Names}}",
      ]);

      return containers.split("\n").filter((name) => name.trim() !== "");
    } catch {
      return [];
    }
  }

  async cleanupOrphanedContainers(): Promise<void> {
    try {
      const containers = await this.listManagedContainers();

      for (const containerName of containers) {
        console.log(`[🧹] Cleaning up orphaned container: ${containerName}`);
        await this.executeDockerCommand(["rm", "-f", containerName]);
      }

      if (containers.length > 0) {
        console.log(`[✅] Cleaned up ${containers.length} orphaned containers`);
      }
    } catch (error) {
      console.error(`[❌] Failed to cleanup orphaned containers: ${error}`);
    }
  }
}

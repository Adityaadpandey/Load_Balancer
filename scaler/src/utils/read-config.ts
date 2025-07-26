import { readFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";
import type { AppConfig } from "../types";

export function loadConfig(filePath: string = "config.yaml"): AppConfig {
  const absolutePath = join(process.cwd(), filePath);
  const file = readFileSync(absolutePath, "utf8");
  const config = yaml.parse(file);

  if (!config.dockerImage) {
    throw new Error("Missing 'dockerImage' in config.yaml");
  }

  return {
    dockerImage: config.dockerImage,
    containerPort: config.containerPort ?? 3000,
    environment: config.environment ?? {},
    volumes: config.volumes,
    minInstances: config.minInstances ?? 2,
    maxInstances: config.maxInstances ?? 10,
    checkInterval: config.checkInterval ?? 5000,
    healthTimeout: config.healthTimeout ?? 2000,
    scaleUpThreshold: config.scaleUpThreshold ?? 3,
    scaleDownThreshold: config.scaleDownThreshold ?? 0.5,
    idleTimeout: config.idleTimeout ?? 30000,
    healthEndpoint: config.healthEndpoint ?? "/health",
    containerPrefix: config.containerPrefix ?? "lb-instance",
    network: config.network,
    pullPolicy: config.pullPolicy ?? "missing",
  };
}

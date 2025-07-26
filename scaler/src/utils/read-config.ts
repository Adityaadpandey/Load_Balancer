// src/utils/read-config.ts
import { readFileSync } from "fs";
import { join } from "path";
import yaml from "yaml";

export type AppConfig = {
  location: string;
  minInstances: number;
  maxInstances: number;
  checkInterval: number;
  healthTimeout: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  idleTimeout: number;
};

export function loadConfig(filePath: string = "config.yaml"): AppConfig {
  const absolutePath = join(process.cwd(), filePath);
  const file = readFileSync(absolutePath, "utf8");
  const config = yaml.parse(file);

  if (!config.location) {
    throw new Error("Missing 'location' in config.yaml");
  }

  return {
    location: config.location,
    minInstances: config.minInstances ?? 2,
    maxInstances: config.maxInstances ?? 10,
    checkInterval: config.checkInterval ?? 5000,
    healthTimeout: config.healthTimeout ?? 2000,
    scaleUpThreshold: config.scaleUpThreshold ?? 3,
    scaleDownThreshold: config.scaleDownThreshold ?? 0.5,
    idleTimeout: config.idleTimeout ?? 30000,
  };
}

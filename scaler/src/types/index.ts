import { spawn } from "child_process";

export type Instance = {
  id: string;
  port: number;
  process: ReturnType<typeof spawn>;
  lastHealth: number;
  isHealthy: boolean;
  activeRequests: number;
  totalRequests: number;
  lastRequestTime: number;
  responseTime: number;
};

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

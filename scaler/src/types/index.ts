export type DockerInstance = {
  id: string;
  containerId: string;
  port: number;
  containerName: string;
  lastHealth: number;
  isHealthy: boolean;
  activeRequests: number;
  totalRequests: number;
  lastRequestTime: number;
  responseTime: number;
  status: "starting" | "running" | "stopping" | "stopped";
};

export type AppConfig = {
  dockerImage: string;
  containerPort: number; // Port inside the container
  environment: Record<string, string>;
  volumes?: string[];
  minInstances: number;
  maxInstances: number;
  checkInterval: number;
  healthTimeout: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  idleTimeout: number;
  healthEndpoint: string;
  containerPrefix: string;
  network?: string;
  pullPolicy: "always" | "missing" | "never";
};

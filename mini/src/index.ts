import { spawn } from "child_process";
import express from "express";
import { readFileSync } from "fs";
import http from "http";
import yaml from "yaml";

interface Config {
    dockerImage: string;
    minInstances: number;
    maxInstances: number;
    responseTimeThreshold: number;
}

interface Instance {
    id: string;
    port: number;
    containerId: string;
    avgResponseTime: number;
    activeRequests: number;
}

class DockerASG {
    private instances: Instance[] = [];
    private nextPort = 6231;
    private currentInstanceIndex = 0;
    private config: Config;

    constructor() {
        const file = readFileSync("config.yaml", "utf8");
        this.config = yaml.parse(file);
        this.initInstances();
    }

    private async dockerCommand(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn("docker", args);
            let output = "";
            let errorOutput = "";

            proc.stdout.on("data", (data) => output += data);
            proc.stderr.on("data", (data) => errorOutput += data);

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve(output.trim());
                } else {
                    reject(new Error(`Docker failed: ${errorOutput}`));
                }
            });

            proc.on("error", (err) => {
                reject(new Error(`Docker spawn failed: ${err.message}`));
            });
        });
    }

    private async createInstance(): Promise<Instance> {
        const id = Math.random().toString(36).substr(2, 8);
        const port = this.nextPort++;

        console.log(`[+] Creating instance ${id} on port ${port}`);

        const containerId = await this.dockerCommand([
            "run", "-d", "-p", `${port}:3000`, this.config.dockerImage
        ]);

        const instance: Instance = {
            id,
            port,
            containerId: containerId.substring(0, 12),
            avgResponseTime: 0,
            activeRequests: 0
        };

        this.instances.push(instance);
        console.log(`[+] Instance ${id} created successfully`);
        return instance;
    }

    private async removeInstance(instance: Instance): Promise<void> {
        console.log(`[-] Removing instance ${instance.id}`);

        await this.dockerCommand(["rm", "-f", instance.containerId]);

        const index = this.instances.indexOf(instance);
        if (index > -1) {
            this.instances.splice(index, 1);
            // Adjust round robin index if needed
            if (this.currentInstanceIndex >= this.instances.length) {
                this.currentInstanceIndex = 0;
            }
        }
    }

    private shouldScale(): "up" | "down" | "none" {
        if (this.instances.length < this.config.minInstances) return "up";
        if (this.instances.length >= this.config.maxInstances) return "down";

        const avgResponseTime = this.instances.reduce((sum, i) => sum + i.avgResponseTime, 0) / this.instances.length;

        if (avgResponseTime > this.config.responseTimeThreshold) return "up";
        if (avgResponseTime < this.config.responseTimeThreshold / 2 && this.instances.length > this.config.minInstances) return "down";

        return "none";
    }

    private async scale(): Promise<void> {
        const action = this.shouldScale();

        if (action === "up") {
            await this.createInstance();
        } else if (action === "down") {
            if (this.instances.length > this.config.minInstances) return
            const lastInstance = this.instances[this.instances.length - 1];

            if (lastInstance) {
                await this.removeInstance(lastInstance);
            }
        }
    }

    // Round robin load balancing
    private pickInstance() {
        if (this.instances.length === 0) return null;

        const instance = this.instances[this.currentInstanceIndex];
        this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.instances.length;

        return instance;
    }

    async handleRequest(req: express.Request, res: express.Response) {

        const instance = this.pickInstance();
        if (!instance) {
            return res.status(503).json({ error: "No instances available" });
        }

        instance.activeRequests++;
        const startTime = Date.now();

        const proxyReq = http.request({
            hostname: "localhost",
            port: instance.port,
            path: req.originalUrl,
            method: req.method,
            headers: req.headers
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(res);

            proxyRes.on("end", () => {
                const responseTime = Date.now() - startTime;
                instance.avgResponseTime = (instance.avgResponseTime + responseTime) / 2;
                instance.activeRequests--;
                this.scale();
            });
        });

        proxyReq.on("error", () => {
            instance.activeRequests--;
            res.status(502).end();
        });

        if (req.readable) {
            req.pipe(proxyReq);
        } else {
            proxyReq.end();
        }
    }

    private async initInstances(): Promise<void> {
        for (let i = 0; i < this.config.minInstances; i++) {
            await this.createInstance();
        }
        console.log(`[+] Initialization complete. Running instances: ${this.instances.length}`);
    }

    getStatus() {
        return {
            instances: this.instances.length,
            currentRoundRobinIndex: this.currentInstanceIndex,
            instanceDetails: this.instances,
            config: this.config
        };
    }

    async cleanup(): Promise<void> {
        console.log('[+] Cleaning up containers...');
        for (const instance of this.instances) {
            await this.dockerCommand(['rm', '-f', instance.containerId]);
        }
        console.log('[+] Cleanup complete');
    }
}

const app = express();
const asg = new DockerASG();

app.use(express.json());

app.get("/status", (req, res) => res.json(asg.getStatus()));

app.use((req, res) => asg.handleRequest(req, res));

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await asg.cleanup();
    process.exit(0);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`[+] Load balancer running on port ${PORT}`);
});

# Docker-Based Auto-Scaling Load Balancer (Express + Docker)

<div align="center">

<img src="https://github.com/Adityaadpandey/Load_Balancer/actions/workflows/ci.yml/badge.svg" />
<img src="https://img.shields.io/badge/License-MIT-green.svg" />
<img src="https://img.shields.io/badge/Built%20With-Node.js-blue" />
<img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" />
<img src="https://img.shields.io/badge/Code-TypeScript-blue?logo=typescript" />
<img src="https://img.shields.io/github/repo-size/Adityaadpandey/Load_Balancer" />
<img src="https://img.shields.io/github/last-commit/Adityaadpandey/Load_Balancer" />

</div>

---

## 🚀 Overview

This project is a **dynamic load balancer** built with **Node.js**, **Express**, and **Docker**, capable of:

- Auto-spawning and managing Docker containers of your app.
- Performing regular **health checks**.
- **Scaling** instances **up/down** based on load and idle time.
- **Forwarding** requests to the **least loaded** healthy instance.
- Providing a live **status endpoint** for monitoring.

---

## 📦 Key Features

- 🐳 **Docker Integration** – Automatically pulls images, runs containers, and cleans up.
- 💓 **Health Monitoring** – Periodic `/health` checks to verify backend availability.
- ⚖️ **Auto-Scaling** – Adjusts number of instances based on load:

  - Scales **up** on high request load.
  - Scales **down** when idle.

- 📉 **Smart Load Balancing** – Routes requests to the **least busy** healthy container.
- 📊 **Live Status Endpoint** – Monitor all running instances in real-time.

---

## 📁 Project Structure

```
.
├── scaler/                    # Load balancer source code
│   ├── src/
│   │   ├── docker-load-balancer.ts # Core load balancing logic
│   │   ├── docker-manager.ts
│   │   ├─── types/
│   │   │     └── index.ts     # types for the app
│   │   │── utils/
│   │   │   └── read-config.ts      # YAML config loader
│   │   ├── index.ts                # Entry point to start the load Balancer
│   │
│   ├── config.yaml                # Configuration for scaling and docker
│
```

---

## 🧩 Configuration (`config.yaml`)

```yaml
dockerImage: "bun-express-app:latest" # Docker image to launch
containerPort: 3000 # Port the app runs on inside the container
containerPrefix: "my-app-lb" # Prefix for naming containers

environment: # Environment variables passed to each container
  NODE_ENV: "production"

volumes: # Optional volume mounts
  - "/host/path:/container/path"

minInstances: 2 # Minimum number of containers
maxInstances: 10 # Maximum number of containers
scaleUpThreshold: 3 # Avg load per instance to scale up
scaleDownThreshold: 0.5 # Avg load below which to scale down
idleTimeout: 30000 # Idle time (ms) before scale down
checkInterval: 5000 # Interval for health/scaling checks (ms)
healthTimeout: 2000 # Timeout for health checks (ms)
healthEndpoint: "/health" # Path to health endpoint

pullPolicy: "missing" # Image pull policy: always, missing, never
```

> ✅ Make sure your Dockerized backend exposes a `/health` route that returns `200 OK`.

---

## 🛠️ Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Docker](https://www.docker.com/)
- A backend app Docker image (e.g. `bun-express-app:latest`) that:

  - Listens on a specific port (e.g. `3000`)
  - Accepts traffic at `/health` for status
  - Is stateless (recommended for dynamic scaling)

---

## 🚀 Getting Started

### 1. Clone the Repo

```bash
git clone https://github.com/Adityaadpandey/Load_Balancer
cd Load_Balancer/scaler
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure `config.yaml`

Update your Docker image, environment, and scaling settings.

---

## ▶️ Running the Load Balancer

```bash
bun start
```

> This will:
>
> - Pull your Docker image (if not already present).
> - Start the minimum number of containers.
> - Begin forwarding traffic to healthy containers on port `4000`.

---

## 🌐 Endpoints

### 🔁 Request Forwarding

All incoming requests (except internal endpoints) are proxied to healthy backend containers:

```
GET /api/user -> routed to http://localhost:5001/api/user (example)
```

### 📊 Load Balancer Status

```
GET /lb-status
```

Returns real-time stats:

```json
{
  "total": 3,
  "healthy": 3,
  "dockerImage": "bun-express-app:latest",
  "instances": [
    {
      "id": "uuid",
      "containerId": "abc123def456",
      "port": 5001,
      "healthy": true,
      "status": "running",
      "activeRequests": 1,
      "totalRequests": 12,
      "responseTime": 123,
      "load": 1.2
    }
  ]
}
```

---

## 📈 How It Works

### 🩺 Health Checks

Every `checkInterval` ms, each instance is pinged on `/health`. If it fails for more than 60 seconds, it's removed.

### ⚖️ Load Balancing

Routing is based on:

```
load = activeRequests + (responseTime penalty)
```

### 📊 Auto Scaling

- **Scale Up**:

  - If avg load > `scaleUpThreshold`
  - And current instances < `maxInstances`

- **Scale Down**:

  - If avg load < `scaleDownThreshold`
  - And some instances are idle for > `idleTimeout`
  - And more than `minInstances` are running

---

## 🧹 Graceful Shutdown

The system listens for `SIGINT` and `SIGTERM` and will:

- Stop and remove all running containers.
- Clean up health/scaling intervals.

---

## 🧠 Tips for Backend Apps

- Must be built into a **Docker image**.
- Should **accept a fixed port** (e.g., via `EXPOSE` or `--port` flag).
- Should respond to `/health` with HTTP 200 when healthy.
- Be **stateless** or use external storage (like databases/Redis) to work well with auto-scaling.

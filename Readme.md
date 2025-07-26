# ⚖️ Dynamic Load Balancer with Auto-Scaling (Bun + Express)

This project is a **dynamic load balancer** built with **Node.js**, **Express**, and **Bun**, capable of:

* Automatically spawning and managing backend instances.
* Performing regular **health checks** on each instance.
* **Auto-scaling** instances up or down based on live load.
* Forwarding incoming requests to the least loaded healthy instance.
* Exposing an internal status endpoint for monitoring.

---

## 📦 Features

* 🏁 **Instance Spawning**: Launches multiple instances of a backend app using `bun`.
* 💓 **Health Checks**: Regularly checks if each instance is healthy (`/health` endpoint).
* 📈 **Auto-Scaling**:

  * Scales **up** when the load is high.
  * Scales **down** when instances are idle.
* 🚥 **Load-Aware Routing**: Requests are routed to the instance with the **lowest load**.
* 🚦 **Status Endpoint**: `/lb-status` shows live info about active instances.

---

## 📁 Project Structure

```
.
.
├── scaler/                    # Load balancer code
│   ├── src/
│   │   ├── index.ts           # Main load balancer server
│   │   └── utils/
│   │       └── read-config.ts # YAML config loader
│   └── config.yaml            # Load balancer configuration file

```

---

## 🔧 Configuration (`config.yaml`)

Here's the configuration format:

```yaml
location: "../backend/src/bin.ts"   # Path to the Bun entry point
minInstances: 2                     # Minimum number of instances
maxInstances: 8                     # Maximum number of instances
checkInterval: 5000                # Health + scaling check interval (ms)
healthTimeout: 2000                # Timeout for health checks (ms)
scaleUpThreshold: 3               # Avg load to trigger scale-up
scaleDownThreshold: 0.5           # Avg load to trigger scale-down
idleTimeout: 30000                 # Time before an idle instance is removed (ms)
```

> 💡 Ensure your backend exposes a `/health` endpoint that returns `200 OK` when healthy.

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

Also install `bun` globally if you haven’t already:

```bash
npm install -g bun
```

### 2. Prepare the Backend App

Ensure your backend app:

* Can be run via `bun run path/to/app.ts --port 1234`
* Accepts a `--port` flag.
* Exposes a working `/health` endpoint.

Example `/health` response:

```json
{ "status": "ok" }
```

### 3. Configure the Balancer

Edit the `config.yaml` with the correct backend entry path and parameters.

---

## ✅ Running the Load Balancer

```bash
bun start
# or if you're using ts-node:
npx ts-node src/index.ts
```

This starts the load balancer on port **4000** (default) and spawns the `minInstances` of your backend.

---

## 🌐 Endpoints

### 🔁 Proxy Handler

All requests will be forwarded to healthy backend instances:

```http
GET /api/your-endpoint -> proxied to backend instance
```

### 📊 Status Monitor

```http
GET /lb-status
```

Returns live status of all instances:

```json
{
  "total": 3,
  "healthy": 3,
  "instances": [
    {
      "id": "uuid",
      "port": 5001,
      "healthy": true,
      "activeRequests": 0,
      "totalRequests": 10,
      "responseTime": 123,
      "load": 0.1
    }
  ]
}
```

---

## 🛑 Graceful Shutdown

The load balancer listens for `SIGINT`/`SIGTERM` and will:

* Kill all backend instances.
* Clear health and scaling intervals.

---

## 🧠 How Load Balancing Works

* **Health Checks**: Every few seconds, all instances are pinged on `/health`.
* **Routing Logic**:

  * Requests are routed to the instance with the **least load** (based on active requests + response time).
* **Scaling**:

  * **Scale Up**: When average load > `scaleUpThreshold`.
  * **Scale Down**: When average load < `scaleDownThreshold` and idle time > `idleTimeout`.

---

## 📌 Requirements

* Node.js 18+
* Bun (for spawning backend instances)
* A compatible backend app exposing a `/health` route

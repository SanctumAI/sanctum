# Deployment Options

This guide covers deployment strategies for Sanctum across different cloud providers.

> ⚠️ **Note (Jan 2026):** With Neo4j temporarily disabled, Sanctum has modest resource requirements. The current stack (Qdrant + Maple Proxy + SearXNG + Backend + Frontend) runs comfortably on 4-8GB RAM.

---

## Resource Requirements

### Current Stack (No Neo4j)

| Component | RAM | Notes |
|-----------|-----|-------|
| Qdrant | 1-2GB | Scales with vector count |
| Embedding model | 1-2GB | `multilingual-e5-base` loaded in backend |
| Backend (FastAPI) | 512MB | Lightweight |
| Frontend (Vite) | 256MB | Static + dev server |
| SearXNG | 256MB | Web search aggregator |
| Maple Proxy | 128MB | Proxies LLM requests externally |
| **Total** | **~4-5GB** | With headroom |

### Recommended Specs

| Tier | vCPUs | RAM | Storage | Use Case |
|------|-------|-----|---------|----------|
| Minimum | 2 | 4GB | 50GB | Dev/demo, small doc sets |
| **Recommended** | 4 | 8GB | 50-100GB | Production, moderate usage |
| Growth | 8 | 16GB | 100GB+ | Large doc sets, concurrent users |

---

## Storage Concepts

Before diving into providers, understand these storage types:

### Block Storage (Persistent Disk)

A virtual hard drive that attaches to your server. Databases run directly on it.

```
┌─────────────────────────────────────────────────────┐
│                    YOUR SERVER                       │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │  Built-in Disk  │    │  Block Storage Volume   │ │
│  │   (25-100GB)    │    │      (50GB extra)       │ │
│  │                 │    │                         │ │
│  │  OS, Docker     │    │  /mnt/sanctum-data/     │ │
│  │  (dies with VM) │    │  (survives VM delete)   │ │
│  └─────────────────┘    └─────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Key points:**
- Databases (Qdrant, SQLite) read/write directly to this disk
- NOT a backup — it's live storage
- Survives VM deletion; can reattach to new VM
- Same-region only (can't move between datacenters easily)

### Object Storage (S3/Spaces/Blobs)

File storage accessed via HTTP API. Good for backups, static assets, large files.

**Key points:**
- Not mountable as a filesystem (without FUSE hacks)
- Best for: backups, document uploads, static hosting
- Accessible from anywhere (not region-locked)

---

## DNS & Frontend Configuration

This section explains how traffic flows from your domain to the Sanctum containers. This applies to **all cloud providers**.

### Traffic Flow Overview

```
┌──────────────────┐      ┌───────────────────┐      ┌─────────────────────────────────┐
│  Domain Registrar │      │   Cloud Provider  │      │            Server               │
│  (e.g. Namecheap) │      │                   │      │                                 │
│                   │      │                   │      │  ┌─────────────────────────┐    │
│   sanctum.org     │─────▶│   143.198.x.x     │─────▶│  │ Caddy (ports 80 & 443)  │    │
│   A Record ───────│      │   (Server IP)     │      │  │ • Terminates SSL/HTTPS  │    │
│                   │      │                   │      │  │ • Routes by URL path    │    │
└──────────────────┘      └───────────────────┘      │  └───────────┬─────────────┘    │
                                                      │              │                  │
                                                      │     ┌────────┴────────┐        │
                                                      │     ▼                 ▼        │
                                                      │  ┌────────┐      ┌─────────┐   │
                                                      │  │Frontend│      │ Backend │   │
                                                      │  │ :5173  │      │  :8000  │   │
                                                      │  └────────┘      └─────────┘   │
                                                      └─────────────────────────────────┘
```

### How It Works

1. **User visits `https://sanctum.org`**
2. **DNS lookup**: Browser asks "what IP is sanctum.org?" → Your registrar returns `143.198.x.x`
3. **Request hits server**: Browser connects to that IP on port 443 (HTTPS)
4. **Caddy receives request**: The reverse proxy running in Docker
5. **Caddy routes by path**:
   - `/api/*`, `/query/*`, `/ingest/*` → Backend container (port 8000)
   - Everything else → Frontend container (port 5173)
6. **Response flows back** through Caddy to the user

### Step 1: Configure DNS at Your Registrar

At your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.), create A records pointing to your server's IP address.

**Example for Namecheap:**

1. Log in → Domain List → Manage → Advanced DNS
2. Add these records:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | @ | 143.198.100.50 | 300 |
| A | www | 143.198.100.50 | 300 |

- `@` = the root domain (sanctum.org)
- `www` = the www subdomain (www.sanctum.org)
- Replace `143.198.100.50` with your actual server IP

**DNS propagation takes 5-30 minutes** (sometimes up to 48 hours, but usually fast).

### Step 2: Why Caddy (Not nginx)

Sanctum uses **Caddy** as a reverse proxy because it handles SSL automatically:

| Feature | Caddy | nginx |
|---------|-------|-------|
| SSL certificate setup | **Automatic** (built-in Let's Encrypt) | Manual (certbot + cron) |
| Certificate renewal | **Automatic** | Manual cron job |
| Config syntax | Simple, readable | Complex |
| Production-ready | ✅ | ✅ |

With Caddy, you literally just specify your domain and it:
1. Detects it needs an SSL certificate
2. Contacts Let's Encrypt automatically
3. Proves domain ownership via HTTP challenge
4. Installs the certificate
5. Auto-renews every 60 days

**Zero manual SSL configuration required.**

### Step 3: The Caddyfile Explained

```
sanctum.org {
    # API routes → backend container
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /health {
        reverse_proxy backend:8000
    }
    handle /query* {
        reverse_proxy backend:8000
    }
    handle /ingest* {
        reverse_proxy backend:8000
    }
    handle /admin* {
        reverse_proxy backend:8000
    }
    handle /auth* {
        reverse_proxy backend:8000
    }
    
    # Everything else → frontend container
    handle {
        reverse_proxy frontend:5173
    }
}
```

**Breaking it down:**

- `sanctum.org { ... }` — This config applies when requests come for this domain
- `handle /api/* { ... }` — If URL path starts with `/api/`, use this block
- `reverse_proxy backend:8000` — Forward the request to the container named `backend` on port 8000
- `handle { ... }` (no path) — Default fallback for all other requests

### Step 4: Caddy in Docker Compose

```yaml
caddy:
  image: caddy:2-alpine
  restart: unless-stopped
  ports:
    - "80:80"    # HTTP (for Let's Encrypt challenge + redirect)
    - "443:443"  # HTTPS (main traffic)
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile   # Your config
    - caddy_data:/data                    # SSL certs stored here
    - caddy_config:/config
  networks:
    - sanctum-net  # Same network as other containers
```

**Important:** Caddy must be on the same Docker network as frontend/backend to resolve container names like `backend:8000`.

### Step 5: Verify It's Working

After DNS propagates and you start the stack:

```bash
# Check Caddy logs for SSL provisioning
docker logs sanctum-caddy

# You should see something like:
# "certificate obtained successfully"
# "enabling automatic HTTPS"

# Test HTTPS
curl -I https://sanctum.org
# Should return HTTP/2 200
```

### Troubleshooting

**"Connection refused" or timeout:**
- DNS hasn't propagated yet — wait and retry
- Firewall blocking ports 80/443 — check cloud provider firewall rules
- Caddy not running — `docker ps` to verify

**"Certificate error" in browser:**
- Caddy couldn't get a certificate — check logs with `docker logs caddy`
- Common cause: DNS not pointing to server yet when Caddy started
- Fix: Wait for DNS, then `docker restart caddy`

**Frontend loads but API calls fail:**
- Check Caddyfile routes are correct
- Verify backend is healthy: `docker logs sanctum-backend`
- Test directly: `curl http://localhost:8000/health` (from server)

### Alternative: Using nginx

If you prefer nginx, the concept is the same but requires manual SSL setup:

```bash
# Install certbot
apt install certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d sanctum.org -d www.sanctum.org

# Certbot modifies nginx config automatically
# Set up cron for renewal:
echo "0 0 * * * certbot renew --quiet" | crontab -
```

nginx config equivalent:
```nginx
server {
    listen 443 ssl;
    server_name sanctum.org;
    
    ssl_certificate /etc/letsencrypt/live/sanctum.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sanctum.org/privkey.pem;
    
    location /api/ {
        proxy_pass http://backend:8000;
    }
    location /query {
        proxy_pass http://backend:8000;
    }
    location / {
        proxy_pass http://frontend:5173;
    }
}
```

**Recommendation:** Stick with Caddy unless you have specific nginx requirements.

---

## DigitalOcean

### Overview

| Aspect | Details |
|--------|---------|
| **Approach** | Container Registry → Single Droplet |
| **Estimated Cost** | $48-63/mo |
| **Complexity** | Low |
| **Best For** | Small teams, straightforward ops |

### Architecture

```
┌─────────────────────────────────────────┐
│       Droplet (s-4vcpu-8gb)             │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐  │
│  │ Frontend│ │ Backend │ │  Qdrant   │  │
│  └─────────┘ └─────────┘ └───────────┘  │
│  ┌───────────┐ ┌─────────────┐          │
│  │  SearXNG  │ │ Maple Proxy │          │
│  └───────────┘ └─────────────┘          │
│              + Block Storage            │
└─────────────────────────────────────────┘
         │
         ▼ HTTPS (Caddy)
    [ Users ]
```

### Cost Breakdown

| Item | Spec | Monthly |
|------|------|---------|
| Droplet | `s-4vcpu-8gb` | $48 |
| Block Storage | 50GB | $5 |
| Container Registry (DOCR) | Basic tier | $5 |
| Spaces (backups) | Optional, 250GB | $5 |
| **Total** | | **$58-63** |

*Budget option: `s-2vcpu-4gb` at $24/mo (tight but works for demos)*

### Setup Steps

#### 1. Create Container Registry

```bash
# Install doctl CLI
brew install doctl  # or snap install doctl

# Authenticate
doctl auth init

# Create registry
doctl registry create sanctum-registry
```

#### 2. Build & Push Images

```bash
# Login to registry
doctl registry login

# Build images
docker compose build

# Tag for registry
docker tag sanctum-backend registry.digitalocean.com/sanctum-registry/backend:v1
docker tag sanctum-frontend registry.digitalocean.com/sanctum-registry/frontend:v1

# Push
docker push registry.digitalocean.com/sanctum-registry/backend:v1
docker push registry.digitalocean.com/sanctum-registry/frontend:v1
```

#### 3. Create Droplet with Block Storage

```bash
# Create droplet
doctl compute droplet create sanctum-prod \
  --size s-4vcpu-8gb \
  --image docker-20-04 \
  --region nyc1 \
  --ssh-keys <your-ssh-key-id>

# Create block storage volume
doctl compute volume create sanctum-data \
  --size 50GiB \
  --region nyc1

# Attach volume to droplet
doctl compute volume-action attach <volume-id> <droplet-id>
```

#### 4. Configure the Droplet

SSH into the droplet:

```bash
ssh root@<droplet-ip>

# Format block storage (first time only!)
mkfs.ext4 /dev/disk/by-id/scsi-0DO_Volume_sanctum-data

# Create mount point
mkdir -p /mnt/sanctum-data

# Mount
mount -o defaults,nofail,discard,noatime \
  /dev/disk/by-id/scsi-0DO_Volume_sanctum-data /mnt/sanctum-data

# Persist across reboots
echo '/dev/disk/by-id/scsi-0DO_Volume_sanctum-data /mnt/sanctum-data ext4 defaults,nofail,discard,noatime 0 2' >> /etc/fstab

# Create data directories
mkdir -p /mnt/sanctum-data/{qdrant,sqlite,uploads,hf_cache}

# Login to container registry
doctl registry login
```

#### 5. Deploy

Create `/opt/sanctum/docker-compose.prod.yml`:

```yaml
services:
  maple-proxy:
    image: ghcr.io/opensecretcloud/maple-proxy:latest
    restart: unless-stopped
    environment:
      - MAPLE_BACKEND_URL=https://enclave.trymaple.ai
      - MAPLE_API_KEY=${MAPLE_API_KEY}
    networks:
      - sanctum-net

  qdrant:
    image: qdrant/qdrant:v1.12.6
    restart: unless-stopped
    volumes:
      - /mnt/sanctum-data/qdrant:/qdrant/storage
    networks:
      - sanctum-net

  searxng:
    image: searxng/searxng:latest
    restart: unless-stopped
    volumes:
      - ./searxng:/etc/searxng:ro
    networks:
      - sanctum-net

  backend:
    image: registry.digitalocean.com/sanctum-registry/backend:v1
    restart: unless-stopped
    environment:
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - EMBEDDING_PROVIDER=local
      - EMBEDDING_MODEL=intfloat/multilingual-e5-base
      - LLM_PROVIDER=maple
      - MAPLE_BASE_URL=http://maple-proxy:8080/v1
      - MAPLE_API_KEY=${MAPLE_API_KEY}
      - MAPLE_MODEL=kimi-k2-thinking
      - SEARXNG_URL=http://searxng:8080
      - SQLITE_PATH=/data/sanctum.db
      - SECRET_KEY=${SECRET_KEY}
      - FRONTEND_URL=${FRONTEND_URL}
      - MOCK_EMAIL=false
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_PORT=${SMTP_PORT}
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASS=${SMTP_PASS}
      - SMTP_FROM=${SMTP_FROM}
    volumes:
      - /mnt/sanctum-data/uploads:/uploads
      - /mnt/sanctum-data/hf_cache:/root/.cache/huggingface
      - /mnt/sanctum-data/sqlite:/data
    depends_on:
      - qdrant
      - maple-proxy
      - searxng
    networks:
      - sanctum-net

  frontend:
    image: registry.digitalocean.com/sanctum-registry/frontend:v1
    restart: unless-stopped
    environment:
      - VITE_DEV_MODE=false
    depends_on:
      - backend
    networks:
      - sanctum-net

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - frontend
      - backend
    networks:
      - sanctum-net

volumes:
  caddy_data:
  caddy_config:

networks:
  sanctum-net:
    driver: bridge
```

Create `/opt/sanctum/Caddyfile`:

```
yourdomain.com {
    # API routes to backend
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /health {
        reverse_proxy backend:8000
    }
    handle /query* {
        reverse_proxy backend:8000
    }
    handle /ingest* {
        reverse_proxy backend:8000
    }
    handle /admin* {
        reverse_proxy backend:8000
    }
    
    # Everything else to frontend
    handle {
        reverse_proxy frontend:5173
    }
}
```

Create `/opt/sanctum/.env`:

```bash
MAPLE_API_KEY=your-maple-key
SECRET_KEY=generate-a-secure-random-string
FRONTEND_URL=https://yourdomain.com
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=Sanctum <noreply@yourdomain.com>
```

Start the stack:

```bash
cd /opt/sanctum
docker compose -f docker-compose.prod.yml up -d
```

### Maintenance

#### Update deployment

```bash
# On local machine: build & push new images
docker compose build
docker tag sanctum-backend registry.digitalocean.com/sanctum-registry/backend:v2
docker push registry.digitalocean.com/sanctum-registry/backend:v2

# On droplet: pull & restart
ssh root@<droplet-ip>
cd /opt/sanctum
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

#### Backup to Spaces

```bash
# Install s3cmd
apt install s3cmd
s3cmd --configure  # Enter Spaces credentials

# Backup
tar -czf /tmp/sanctum-backup.tar.gz /mnt/sanctum-data
s3cmd put /tmp/sanctum-backup.tar.gz s3://your-space/backups/sanctum-$(date +%Y%m%d).tar.gz
```

#### Restore from backup

```bash
# Stop services
docker compose -f docker-compose.prod.yml down

# Restore
s3cmd get s3://your-space/backups/sanctum-YYYYMMDD.tar.gz /tmp/
tar -xzf /tmp/sanctum-YYYYMMDD.tar.gz -C /

# Start services
docker compose -f docker-compose.prod.yml up -d
```

---

## Amazon Web Services (AWS)

*Coming soon*

Planned sections:
- EC2 + EBS (equivalent to DO Droplet + Block Storage)
- ECR (Container Registry)
- Fargate/ECS (managed containers)
- Cost comparison

---

## Google Cloud Platform (GCP)

*Coming soon*

Planned sections:
- Compute Engine + Persistent Disk
- Artifact Registry
- Cloud Run (managed containers)
- Cost comparison

---

## Microsoft Azure

*Coming soon*

Planned sections:
- Azure VM + Managed Disk
- Azure Container Registry
- Azure Container Instances
- Cost comparison

---

## Comparison Matrix

| Provider | Compute | Block Storage | Container Registry | Estimated Cost |
|----------|---------|---------------|-------------------|----------------|
| **DigitalOcean** | Droplet 4vCPU/8GB | Volume 50GB | DOCR | ~$58/mo |
| AWS | EC2 t3.large | EBS gp3 50GB | ECR | ~$70-90/mo |
| GCP | e2-standard-2 | PD-SSD 50GB | Artifact Registry | ~$65-85/mo |
| Azure | B2ms | Managed Disk 50GB | ACR | ~$70-90/mo |

*AWS/GCP/Azure estimates are rough; actual costs vary by region and usage.*

---

## Choosing a Provider

| If you need... | Consider |
|----------------|----------|
| Simplicity, low cost | DigitalOcean |
| Enterprise compliance, existing AWS infra | AWS |
| ML/AI integrations, BigQuery | GCP |
| Microsoft ecosystem, Azure AD | Azure |
| Maximum privacy, self-hosted | Bare metal / Hetzner |

For most Sanctum deployments, **DigitalOcean offers the best balance** of simplicity, cost, and capability.

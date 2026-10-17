# Deploying Frostvale to CloudPanel

The GitHub Actions workflow `.github/workflows/deploy.yml` builds the game and rsyncs `dist/` into your CloudPanel site over SSH.
- **Every pull request:** build and checks only.
- **Every push to `staging`:** build, checks, then deploy to the staging site. A manual run from the Actions tab also deploys.
- **Production:** not set up yet; it will get its own environment and trigger.

## 1. One-time server setup

1. **Create the site.** In CloudPanel: **Sites → Add Site → Create a Static HTML Site**. Pick your domain (e.g. `frostvale.example.com`); CloudPanel creates a *site user* (e.g. `frostvale`). The site root is `/home/<site-user>/htdocs/<domain>`.
2. **HTTPS.** Site → **SSL/TLS → New Let's Encrypt Certificate**. HTTPS is required for fullscreen, the web-app manifest and vibration on phones.
3. **Create a deploy key** on your own computer. Don't reuse your personal key.
   ```bash
   ssh-keygen -t ed25519 -C "github-deploy-frostvale" -f frostvale_deploy -N ""
   ```
4. **Authorise it for the site user.** SSH into the server as the site user (its password is under Site → **SSH/FTP**), then run:
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo "<contents of frostvale_deploy.pub>" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
5. **Pin the server's host key.** From your computer:
   ```bash
   ssh-keyscan -p 22 your.server.ip.or.host
   ```

## 2. GitHub settings

Go to **Settings → Secrets and variables → Actions** and add these:

| Secret | Value |
|---|---|
| `CLOUDPANEL_HOST` | Server IP or hostname |
| `CLOUDPANEL_USER` | The site user (e.g. `frostvale`), not `root` |
| `CLOUDPANEL_SSH_KEY` | Full contents of the private key file `frostvale_deploy` |
| `CLOUDPANEL_PATH` | `/home/<site-user>/htdocs/<domain>` |
| `CLOUDPANEL_KNOWN_HOSTS` | Output of the `ssh-keyscan` command above |
| `CLOUDPANEL_PORT` | Only if SSH isn't on port 22 |

Optionally, add a **variable** (not a secret) called `SITE_URL`, e.g. `https://frostvale.example.com`. The deploy then shows the link and smoke-tests the live site.

The deploy job runs in the GitHub **environment** `CLOUDPANEL_STAGING` (**Settings → Environments**). The secrets above can live there as *environment secrets* instead of repository secrets; the names stay the same. You can also require an approval before each deploy there. If you rename the environment, update `environment.name` in `.github/workflows/deploy.yml` to match.

## 3. Recommended nginx tweaks (optional)

Go to CloudPanel → Site → **Vhost** and add these inside the `server { … }` block for the HTTPS site:

```nginx
# Game files: Vite's hashed bundles never change, so cache them for a year.
location /assets/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
  try_files $uri =404;
}
# Models, textures and world data aren't hashed: cache for a day, revalidate after.
location ~* \.(gltf|glb|bin|webp|png|jpg)$ {
  add_header Cache-Control "public, max-age=86400";
  try_files $uri =404;
}
# Always fetch the latest page so a new deploy is picked up immediately.
location = /index.html { add_header Cache-Control "no-cache"; }

# MIME types nginx doesn't know by default.
types {
  model/gltf+json gltf;
  model/gltf-binary glb;
  application/manifest+json webmanifest;
}
gzip_types application/javascript text/css application/json model/gltf+json model/gltf-binary application/octet-stream application/manifest+json;
```

> Note: a `types { }` block inside `server` replaces nginx's defaults for that block. If HTML or CSS start being served as `application/octet-stream`, move the three lines into the global `mime.types` instead.

## 4. Deploy

- Push or merge to `staging`, or go to **Actions → Deploy to CloudPanel (staging) → Run workflow**.
- rsync swaps the new files in all at once (`--delay-updates`), then removes stale files (`--delete-after`).
- It leaves `.well-known/` alone, so Let's Encrypt renewals keep working.
- The game server (`server/`) is uploaded to `/home/<site-user>/frostvale-server` (or `CLOUDPANEL_SERVER_PATH`) and restarted with pm2. Its `.env` and `node_modules` are never overwritten.

## 5. Game server: accounts, leaderboards, multiplayer (one-time)

The game works without this. Until it's set up, players get the offline single-player game, and the deploy prints *"Game server uploaded but not started"*.

Once it's done, the same site serves:

| Path | What |
|---|---|
| `/` | The game (static files, as before) |
| `/api/*` | Accounts and leaderboards (Node server on `127.0.0.1:3100`) |
| `/ws` | Multiplayer WebSocket (same Node server) |

### 5.1 Database
1. In CloudPanel, go to **Databases → Add Database**:
   - Database name: `frostvale`
   - Database user: `frostvale`
   - Password: generate a strong one and keep it for the next step.
2. You don't create any tables. The server creates and upgrades them itself on start-up, using the files in `server/migrations`.

### 5.2 Node.js for the site user
SSH in as the **site user** (Site → **SSH/FTP**), then:
```bash
# nvm + Node 22 for this user only (no root needed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
npm install -g pm2      # keeps the server running and restarts it if it crashes
```

### 5.3 Server settings (`.env`)
Run a deploy once, which creates `~/frostvale-server`. Then:
```bash
cd ~/frostvale-server
cp .env.example .env
nano .env        # DB_PASSWORD = the password from 5.1; keep PORT=3100 unless that port is taken
chmod 600 .env
```

| Setting | Meaning |
|---|---|
| `AUTH_MODE` | `email` (email + password) now; `phone` (phone number + SMS code) for production. Switching needs no new build: just restart. |
| `SMS_PROVIDER` | `console` writes codes to the server log, for staging. Production needs the local gateway's adapter (tell us which provider). |
| `PORT` | Must match the nginx block below. |

Start it the first time (later deploys restart it automatically):
```bash
pm2 start ecosystem.config.cjs && pm2 save
pm2 logs frostvale-server --lines 20     # should end with "Server listening at http://127.0.0.1:3100"
```

### 5.4 Keep it running after a reboot
Site users can't install system services, so add a **Cron Job** (Site → **Cron Jobs**) that brings pm2 back if the server rebooted:
```
*/5 * * * *   bash -lc 'source ~/.nvm/nvm.sh && pm2 resurrect >/dev/null 2>&1 || true'
```

### 5.5 nginx: send `/api` and `/ws` to the server
Site → **Vhost**: paste this inside the `server { … }` block that listens on 443, above the existing `location /` block, then **Save**:
```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3100;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
location = /ws {
  proxy_pass http://127.0.0.1:3100;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 1h;   # multiplayer connections stay open
  proxy_send_timeout 1h;
}
```

### 5.6 Check
- `https://<your-site>/api/health` returns `{"ok":true}`.
- Open the game and press Start: a **Join Frostvale** card appears. Create an account, pick an adventurer, then open the game on a second device and you'll see each other.
- The deploy's smoke test now also prints **"Game server reachable ✅"**.

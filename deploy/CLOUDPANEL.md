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

## 3. nginx vhost (recommended)

Paste [`deploy/nginx-vhost.conf`](nginx-vhost.conf) into Site → **Vhost** and **Save**. It is CloudPanel's Node.js template with three changes:
- nginx serves the game files from `htdocs` itself: fast, and the game still loads (offline-only) if the Node server is down.
- Cache headers: a year for fingerprinted build files, a day for models, textures and world data, and `no-cache` for the page and `sw.js`.
- Anything that isn't a file (`/api/*`, the `/ws` socket) goes to the Node server, with a one-hour socket timeout.

Keep the `{{…}}` placeholders: CloudPanel fills them in. Without this vhost, the default Node.js one also works, because the Node server serves the files too.

## 4. Deploy

- Push or merge to `staging`, or go to **Actions → Deploy to CloudPanel (staging) → Run workflow**.
- rsync swaps the new files in all at once (`--delay-updates`), then removes stale files (`--delete-after`).
- It leaves `.well-known/` alone, so Let's Encrypt renewals keep working.
- The game server (`server/`) is uploaded to `/home/<site-user>/frostvale-server` (or `CLOUDPANEL_SERVER_PATH`) and restarted with pm2. Its `.env` and `node_modules` are never overwritten.

## 5. Game server: accounts, leaderboards, multiplayer (one-time)

The game works without this. Until it's set up, players get the offline single-player game, and the deploy prints *"Game server uploaded but not started"*.

The site must be a **Node.js site**: CloudPanel can't add databases to a Static HTML site. On a Node.js site, nginx forwards every request to the app, so the Node server serves everything:

| Path | What |
|---|---|
| `/` | The game files from `htdocs` (the deploy still uploads them there) |
| `/api/*` | Accounts and leaderboards |
| `/ws` | Multiplayer WebSocket |

The deploy does the rest: it installs Node 22 and pm2 for the site user, writes the server's `.env`, runs it, and adds a reboot cron.

### 5.1 Switch the site to Node.js
1. Delete the Static HTML site. The game files go with it; the next deploy puts them back.
2. **Add Site → Create a Node.js Site**:
   - Domain: the same domain.
   - Node.js version: **22**.
   - App Port: **3100**.
   - Site user: the **same user name** as before (it must match the `CLOUDPANEL_USER` secret), plus a password.
3. Site → **SSL/TLS → Actions → New Let's Encrypt Certificate**.
4. The site user's home is new, so add the deploy key again. As the site user (Site → **SSH/FTP**):
   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   echo 'ssh-ed25519 AAAA…  (the deploy PUBLIC key)' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
5. Check that the `CLOUDPANEL_PATH` secret is still the site's `htdocs` folder, e.g. `/home/<user>/htdocs/<domain>`.

### 5.2 Database
Site → **Databases → Add Database**:
- Database name: `frostvale`
- Database user: `frostvale`
- Password: a strong one.

You don't create tables. The server creates and upgrades them itself on start-up.

### 5.3 GitHub settings
Repository → **Settings → Environments → `CLOUDPANEL_STAGING`**:

| Kind | Name | Value |
|---|---|---|
| Secret | `FROSTVALE_DB_PASSWORD` | the database password from 5.2 (**required**) |
| Variable | `FROSTVALE_DB_NAME` / `FROSTVALE_DB_USER` | only if not `frostvale` |
| Variable | `FROSTVALE_PORT` | only if the App Port isn't `3100` |
| Variable | `FROSTVALE_AUTH_MODE` | `email` (default) or `phone` (phone number + SMS code, for production) |

Then push, or **Actions → Deploy → Re-run**. The deploy writes `~/frostvale-server/.env` (mode 600) from these on every run, so change settings here, not on the server.

### 5.4 Check
- `https://<your-site>/api/health` returns `{"ok":true}`.
- Open the game and press Start: a **Join Frostvale** card appears. Create an account and pick an adventurer. Open the game on a second device and you'll see each other.
- The deploy's smoke test prints **"Game server reachable ✅"**.
- Logs, as the site user: `source ~/.nvm/nvm.sh && pm2 logs frostvale-server`.

If `/ws` doesn't connect (players never appear), check that the vhost is the one from section 3. Its `@app` block carries the WebSocket `Upgrade` headers.

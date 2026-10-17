# Deploying Frostvale to CloudPanel

The GitHub Actions workflow `.github/workflows/deploy.yml` builds the game and rsyncs `dist/` into your CloudPanel site over SSH.
- **Every pull request:** build and checks only.
- **Every push to `main`:** build, checks, then deploy. A manual run from the Actions tab also deploys.

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

The deploy job uses a GitHub **environment** called `production`, created automatically on first run. Under **Settings → Environments → production** you can require an approval before each deploy, or move the secrets there.

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
gzip_types application/javascript text/css application/json model/gltf+json application/manifest+json;
```

> Note: a `types { }` block inside `server` replaces nginx's defaults for that block. If HTML or CSS start being served as `application/octet-stream`, move the three lines into the global `mime.types` instead.

## 4. Deploy

- Push or merge to `main`, or go to **Actions → Deploy to CloudPanel → Run workflow**.
- rsync swaps the new files in all at once (`--delay-updates`), then removes stale files (`--delete-after`).
- It leaves `.well-known/` alone, so Let's Encrypt renewals keep working.

# Auto-deploy (VPS)

`smartcook-deploy.timer` runs `scripts/deploy.sh` every minute. A push to
`main` on GitHub reaches production in about a minute, with no manual step.

What a deploy does: `git fetch` -> if `origin/main` moved: `git reset --hard`
-> `npm ci` only if `package*.json` changed -> `node --check` on every JS file
-> `pm2 restart smartcook-backend` -> wait for `/api/health` (success + mongodb
connected). If the new build is not healthy it rolls back to the previous
commit and remembers the bad commit in `/root/.smartcook-bad-commits`, so it
does not retry it every minute. Push a newer commit to try again.

Safe by construction: `reset --hard` only touches tracked files. `.env`,
`node_modules/`, `data/` and the service-account json are untracked and are
never overwritten. Do not start tracking any file the running API writes.

## Operate

```bash
tail -f /root/smartcook-deploy.log          # what happened
systemctl list-timers smartcook-deploy.timer
bash /root/smartcook-backend/scripts/deploy.sh   # deploy now
systemctl disable --now smartcook-deploy.timer   # pause auto-deploy
```

Pausing is needed before editing files directly on the server, because the
next deploy resets them to what is on GitHub.

## One-time install (already done on the VPS)

```bash
cp deploy/smartcook-deploy.* /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now smartcook-deploy.timer
```

The frontend (APK) is not part of this; releases go through
`smartcook-frontend/scripts/release.ps1`.

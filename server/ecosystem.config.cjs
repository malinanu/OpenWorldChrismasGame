// pm2 process file (deploy runs `pm2 startOrReload ecosystem.config.cjs`).
// One instance: rooms and snowballs live in memory, so all players must share one process.
module.exports = {
  apps: [
    {
      name: 'frostvale-server',
      script: 'dist/index.js',
      cwd: __dirname,
      node_args: '--env-file=.env',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      kill_timeout: 5000,
      env: { NODE_ENV: 'production' },
    },
  ],
};

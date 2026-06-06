#!/usr/bin/env node
// Launcher — runs server.js and auto-restarts it when it exits with code 42
// (code 42 = graceful restart signal from the /api/restart endpoint)
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, 'server.js');

function launch() {
  console.log('[launcher] Starting server...');
  const proc = spawn(process.execPath, [SERVER], {
    stdio: 'inherit',
    env: process.env,
    cwd: __dirname,
  });

  proc.on('exit', (code, signal) => {
    if (code === 42) {
      console.log('[launcher] Restart requested — restarting in 1s...');
      setTimeout(launch, 1000);
    } else {
      console.log(`[launcher] Server exited (code=${code} signal=${signal}). Not restarting.`);
      process.exit(code ?? 1);
    }
  });
}

launch();

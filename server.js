// File: sidehustle-ai/provisioning-template/server.js
// Purpose: Entry point for the Railway service
// Uses OpenClaw's native ${VARIABLE} syntax in config.json

const { createServer } = require('http');
const { readFileSync, existsSync, writeFileSync, mkdirSync } = require('fs');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const VOLUME_PATH = '/app/data';
const VOLUME_TIMEOUT = 60000;
const VOLUME_CHECK_INTERVAL = 1000;

// Wait for Volume to be mounted
function waitForVolume() {
  return new Promise((resolve) => {
    console.log(`Waiting for volume at ${VOLUME_PATH}...`);
    const startTime = Date.now();
    const checkVolume = () => {
      if (existsSync(VOLUME_PATH)) {
        console.log(`Volume mounted - ready!`);
        resolve(true);
      } else if (Date.now() - startTime > VOLUME_TIMEOUT) {
        console.error(`Volume timeout after ${VOLUME_TIMEOUT/1000}s - proceeding anyway`);
        resolve(false);
      } else {
        setTimeout(checkVolume, VOLUME_CHECK_INTERVAL);
      }
    };
    checkVolume();
  });
}

// Start OpenClaw Gateway
function startOpenClaw() {
  console.log('=== Starting OpenClaw Gateway ===');
  const openclaw = spawn('openclaw', ['gateway', 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: './config.json',
      // CRITICAL: Set to /root/.openclaw NOT /root to prevent double nesting
      OPENCLAW_HOME: '/root/.openclaw'
    }
  });

  openclaw.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`[OpenClaw] ${output}`);
  });

  openclaw.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.error(`[OpenClaw ERROR] ${output}`);
  });

  openclaw.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[OpenClaw] Process exited with code ${code}`);
      process.exit(1);
    }
  });

  console.log(`[OpenClaw] Process started with PID: ${openclaw.pid}`);
  console.log(`[OpenClaw] Using config: ./config.json`);
}

// HTTP server for success page
const server = createServer((req, res) => {
  if (req.url === '/') {
    try {
      const html = readFileSync('./start-page.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      console.error('Error serving start-page.html:', e);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading page');
    }
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Main initialization
async function init() {
  console.log('=== Clawbot Service Starting ===');
  console.log(`Node version: ${process.version}`);
  console.log(`Platform: ${process.platform}`);

  // Wait for volume
  await waitForVolume();

  // Start web server
  server.listen(PORT, () => {
    console.log(`✓ Web server listening on port ${PORT}`);
    console.log(`✓ Visit your Railway URL to see the success page`);
    // Only start OpenClaw if we have real credentials
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.OPENCLAW_MODEL_ALIAS) {
      startOpenClaw();
    } else {
      console.log('⚠️ OpenClaw not started - waiting for environment variables');
    }
  });
}

init();

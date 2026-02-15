// File: sidehustle-ai/provisioning-template/server.js
// Purpose: Entry point for the Railway service.
// Features: Direct Key Injection into runtime config to ensure agent auth success.

const { createServer } = require('http');
const { readFileSync, existsSync, writeFileSync } = require('fs');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const VOLUME_PATH = '/app/data';
const VOLUME_TIMEOUT = 60000;
const VOLUME_CHECK_INTERVAL = 1000;

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

function startOpenClaw() {
  console.log('=== Starting OpenClaw Gateway ===');

  try {
    const configTemplate = readFileSync('./config.json', 'utf8');
    let config = JSON.parse(configTemplate);

    // DIRECT KEY INJECTION: Replace placeholders with real values from Environment
    if (config.auth?.profiles) {
        if (process.env.GOOGLE_API_KEY) config.auth.profiles['google:default'].apiKey = process.env.GOOGLE_API_KEY;
        if (process.env.OPENAI_API_KEY) config.auth.profiles['openai:default'].apiKey = process.env.OPENAI_API_KEY;
        if (process.env.ANTHROPIC_API_KEY) config.auth.profiles['anthropic:default'].apiKey = process.env.ANTHROPIC_API_KEY;
    }

    // Model and Telegram Substitution
    if (config.agents?.defaults?.model) {
      config.agents.defaults.model.primary = process.env.OPENCLAW_MODEL_ALIAS || 'google/gemini-1.5-flash';
    }
    if (config.channels?.telegram) {
      config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN || 'PLACEHOLDER';
      config.channels.telegram.allowFrom = process.env.TELEGRAM_OWNER_ID ? [parseInt(process.env.TELEGRAM_OWNER_ID)] : [0];
    }

    // Write the "Hot" runtime config with real data
    writeFileSync('./config-runtime.json', JSON.stringify(config, null, 2));
    console.log('✓ Runtime configuration baked with real API keys.');
  } catch (error) {
    console.error('Error baking config:', error);
    process.exit(1);
  }

  const openclaw = spawn('openclaw', ['gateway', 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: './config-runtime.json'
    }
  });

  openclaw.stdout.on('data', (data) => console.log(`[OpenClaw] ${data.toString().trim()}`));
  openclaw.stderr.on('data', (data) => console.error(`[OpenClaw ERROR] ${data.toString().trim()}`));

  openclaw.on('exit', (code) => {
    if (code !== 0) process.exit(1);
  });

  console.log(`[OpenClaw] Process started with PID: ${openclaw.pid}`);
}

const server = createServer((req, res) => {
  if (req.url === '/') {
    try {
      const html = readFileSync('./start-page.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      res.writeHead(500);
      res.end('Error loading page');
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

async function init() {
  console.log('=== Clawbot Service Starting ===');
  await waitForVolume();
  
  server.listen(PORT, () => {
    console.log(`✓ Web server listening on port ${PORT}`);
    if (process.env.TELEGRAM_BOT_TOKEN) {
      startOpenClaw();
    } else {
      console.log('⚠️ Template build - waiting for variables');
    }
  });
}

init();

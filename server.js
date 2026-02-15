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

// Provision agent auth profiles physically on disk (insurance policy)
function provisionAgentAuth() {
  console.log('=== Provisioning Agent Auth (Insurance) ===');
  try {
    const agentAuthDir = '/root/.openclaw/agents/main/agent';
    if (!existsSync(agentAuthDir)) {
      mkdirSync(agentAuthDir, { recursive: true });
      console.log(`✓ Created agent directory: ${agentAuthDir}`);
    }

    // Build auth profiles (no apiKey field - OpenClaw reads from env vars)
    const authProfiles = {};
    if (process.env.GOOGLE_API_KEY) {
      authProfiles['google:default'] = { provider: 'google', mode: 'api_key' };
    }
    if (process.env.OPENAI_API_KEY) {
      authProfiles['openai:default'] = { provider: 'openai', mode: 'api_key' };
    }
    if (process.env.ANTHROPIC_API_KEY) {
      authProfiles['anthropic:default'] = { provider: 'anthropic', mode: 'api_key' };
    }

    // Write auth-profiles.json to agent directory
    const authProfilesPath = `${agentAuthDir}/auth-profiles.json`;
    writeFileSync(authProfilesPath, JSON.stringify(authProfiles, null, 2));
    console.log(`✓ Wrote auth profiles to: ${authProfilesPath}`);
    console.log(`✓ Configured ${Object.keys(authProfiles).length} auth profile(s)`);
    return true;
  } catch (error) {
    console.error('Error provisioning agent auth:', error);
    return false;
  }
}

// Start OpenClaw Gateway
function startOpenClaw() {
  console.log('=== Starting OpenClaw Gateway ===');

  // Process config to substitute TELEGRAM_OWNER_ID as integer
  try {
    const configTemplate = readFileSync('./config.json', 'utf8');
    let config = JSON.parse(configTemplate);

    // Substitute model alias
    if (config.agents?.defaults?.model?.primary) {
      config.agents.defaults.model.primary = process.env.OPENCLAW_MODEL_ALIAS || 'google/gemini-1.5-flash';
    }

    // Substitute Telegram config
    if (config.channels?.telegram) {
      config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN || 'PLACEHOLDER';
      config.channels.telegram.allowFrom = process.env.TELEGRAM_OWNER_ID ? [parseInt(process.env.TELEGRAM_OWNER_ID)] : [0];
    }

    // Write runtime config
    writeFileSync('./config-runtime.json', JSON.stringify(config, null, 2));
    console.log('✓ Processed config with substitutions');
  } catch (error) {
    console.error('Error processing config:', error);
    process.exit(1);
  }

  const openclaw = spawn('openclaw', ['gateway', 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: './config-runtime.json',
      OPENCLAW_HOME: '/root/.openclaw'
    }
  });

  openclaw.stdout.on('data', (data) => console.log(`[OpenClaw] ${data.toString().trim()}`));
  openclaw.stderr.on('data', (data) => console.error(`[OpenClaw ERROR] ${data.toString().trim()}`));

  openclaw.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[OpenClaw] Process exited with code ${code}`);
      process.exit(1);
    }
  });

  console.log(`[OpenClaw] Process started with PID: ${openclaw.pid}`);
  console.log(`[OpenClaw] Using config: ./config-runtime.json`);
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

  // Provision agent auth (insurance policy)
  provisionAgentAuth();

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

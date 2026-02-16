// File: sidehustle-ai/provisioning-template/server.js
// Purpose: Entry point for the Railway service
// FINAL APPROACH: Remove ALL apiKey logic, rely ONLY on environment variables

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

// Provision physical auth file for agent
function provisionAgentAuth() {
  console.log('=== Provisioning Agent Auth File ===');
  try {
    const { mkdirSync } = require('fs');
    const agentAuthDir = '/root/.openclaw/agents/main/agent';
    
    if (!existsSync(agentAuthDir)) {
      mkdirSync(agentAuthDir, { recursive: true });
      console.log(`✓ Created: ${agentAuthDir}`);
    }
    
    const authProfiles = {};
    
    if (process.env.GOOGLE_API_KEY) {
      authProfiles['google:default'] = {
        provider: 'google',
        mode: 'api_key',
        apiKey: process.env.GOOGLE_API_KEY
      };
    }
    
    if (process.env.OPENAI_API_KEY) {
      authProfiles['openai:default'] = {
        provider: 'openai',
        mode: 'api_key',
        apiKey: process.env.OPENAI_API_KEY
      };
    }
    
    if (process.env.ANTHROPIC_API_KEY) {
      authProfiles['anthropic:default'] = {
        provider: 'anthropic',
        mode: 'api_key',
        apiKey: process.env.ANTHROPIC_API_KEY
      };
    }
    
    const authPath = `${agentAuthDir}/auth-profiles.json`;
    const authContent = JSON.stringify(authProfiles, null, 2);
    writeFileSync(authPath, authContent);
    console.log(`✓ Wrote physical auth file: ${authPath}`);
    console.log(`✓ Keys configured: ${Object.keys(authProfiles).length}`);
    console.log(`DEBUG - File contents:\n${authContent}`);
    
    return true;
  } catch (error) {
    console.error('Error provisioning auth:', error);
    return false;
  }
}

function startOpenClaw() {
  console.log('=== Starting OpenClaw Gateway ===');
  
  // DEBUG: Log environment variables
  console.log('Environment variables being passed to OpenClaw:');
  console.log(`  GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? '[SET]' : '[NOT SET]'}`);
  console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '[SET]' : '[NOT SET]'}`);
  console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET]'}`);

  try {
    const configTemplate = readFileSync('./config.json', 'utf8');
    let config = JSON.parse(configTemplate);

    // Only substitute model and Telegram config - NO apiKey fields
    if (config.agents?.defaults?.model) {
      config.agents.defaults.model.primary = process.env.OPENCLAW_MODEL_ALIAS || 'google/gemini-1.5-flash';
    }
    if (config.channels?.telegram) {
      config.channels.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN || 'PLACEHOLDER';
      config.channels.telegram.allowFrom = process.env.TELEGRAM_OWNER_ID ? [parseInt(process.env.TELEGRAM_OWNER_ID)] : [0];
    }

    writeFileSync('./config-runtime.json', JSON.stringify(config, null, 2));
    console.log('✓ Processed config (model + Telegram only)');
  } catch (error) {
    console.error('Error processing config:', error);
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
  console.log(`[OpenClaw] Using config: ./config-runtime.json`);
}

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

async function init() {
  console.log('=== Clawbot Service Starting ===');
  console.log(`Node version: ${process.version}`);
  console.log(`Platform: ${process.platform}`);

  await waitForVolume();

  // Provision physical auth file
  provisionAgentAuth();

  server.listen(PORT, () => {
    console.log(`✓ Web server listening on port ${PORT}`);
    console.log(`✓ Visit your Railway URL to see the success page`);
    
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.OPENCLAW_MODEL_ALIAS) {
      startOpenClaw();
    } else {
      console.log('⚠️  OpenClaw not started - waiting for environment variables');
      console.log('   This is normal for template builds');
    }
  });
}

init();

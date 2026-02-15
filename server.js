// File: sidehustle-ai/provisioning-template/server.js
// Purpose: Entry point for the Railway service. Runs OpenClaw with the provided config.
// Handles environment variable substitution and model alias parsing
const { createServer } = require('http');
const { readFileSync, existsSync, writeFileSync } = require('fs');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const VOLUME_PATH = '/app/data';
const VOLUME_TIMEOUT = 60000; // 60 seconds
const VOLUME_CHECK_INTERVAL = 1000; // 1 second

// Wait for Volume to be mounted (Railway persistent storage)
function waitForVolume() {
  return new Promise((resolve) => {
    console.log(`Waiting for volume at ${VOLUME_PATH}...`);
    const startTime = Date.now();
    const checkVolume = () => {
      if (existsSync(VOLUME_PATH)) {
        console.log(`Volume mounted at ${VOLUME_PATH} - ready!`);
        resolve(true);
      } else if (Date.now() - startTime > VOLUME_TIMEOUT) {
        console.error(`Volume timeout after ${VOLUME_TIMEOUT/1000}s - proceeding anyway`);
        resolve(false);
      } else {
        console.log(`Waiting for volume... (${Math.floor((Date.now() - startTime)/1000)}s)`);
        setTimeout(checkVolume, VOLUME_CHECK_INTERVAL);
      }
    };
    checkVolume();
  });
}

// Parse model alias (e.g., "openai/gpt-4o-mini" -> { provider: "openai", model: "gpt-4o-mini" })
function parseModelAlias(alias) {
  if (!alias || !alias.includes('/')) {
    console.warn(`Invalid model alias format: ${alias}. Expected format: provider/model-name`);
    return null;
  }
  const [provider, model] = alias.split('/');
  return { provider: provider.trim(), model: model.trim(), fullAlias: alias };
}

// Process config.json and substitute environment variables
function processConfig() {
  console.log('=== Processing Configuration ===');
  try {
    // Read template config
    const configTemplate = readFileSync('./config.json', 'utf8');
    const config = JSON.parse(configTemplate);

    // Get environment variables
    const envVars = {
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
      TELEGRAM_OWNER_ID: process.env.TELEGRAM_OWNER_ID || '',
      OPENCLAW_MODEL_ALIAS: process.env.OPENCLAW_MODEL_ALIAS || ''
    };

    // Log environment status (masked for security)
    console.log('Environment variables:');
    for (const [key, value] of Object.entries(envVars)) {
      if (key.includes('KEY') || key.includes('TOKEN')) {
        console.log(` ${key}: ${value ? '[SET]' : '[NOT SET]'}`);
      } else {
        console.log(` ${key}: ${value || '[NOT SET]'}`);
      }
    }

    // Parse model alias
    const modelInfo = parseModelAlias(envVars.OPENCLAW_MODEL_ALIAS);
    if (!modelInfo) {
      console.error('Failed to parse OPENCLAW_MODEL_ALIAS. Exiting.');
      return null;
    }
    console.log(`Parsed model: Provider="${modelInfo.provider}", Model="${modelInfo.model}"`);

    // Substitute environment variables in auth profiles
    if (config.auth && config.auth.profiles) {
      for (const profileKey in config.auth.profiles) {
        const profile = config.auth.profiles[profileKey];
        if (profile.apiKey) {
          if (profile.apiKey === '$GOOGLE_API_KEY') {
            profile.apiKey = envVars.GOOGLE_API_KEY;
          } else if (profile.apiKey === '$OPENAI_API_KEY') {
            profile.apiKey = envVars.OPENAI_API_KEY;
          } else if (profile.apiKey === '$ANTHROPIC_API_KEY') {
            profile.apiKey = envVars.ANTHROPIC_API_KEY;
          }
        }
      }
    }

    // Substitute Telegram configuration
    if (config.channels && config.channels.telegram) {
      config.channels.telegram.botToken = envVars.TELEGRAM_BOT_TOKEN;
      config.channels.telegram.allowFrom = [envVars.TELEGRAM_OWNER_ID];
    }

    // Set primary model to the full alias
    if (config.model) {
      config.model.primary = modelInfo.fullAlias;
    }

    // Add models section with parsed model information
    config.models = {
      [modelInfo.fullAlias]: {
        provider: modelInfo.provider,
        model: modelInfo.model,
        auth: `${modelInfo.provider}:default`
      }
    };

    // Write processed config
    const processedConfig = JSON.stringify(config, null, 2);
    writeFileSync('./config-runtime.json', processedConfig);
    console.log('✓ Configuration processed successfully');
    console.log(`✓ Using model: ${modelInfo.fullAlias}`);
    console.log(`✓ Auth profile: ${modelInfo.provider}:default`);
    return true;
  } catch (error) {
    console.error('Error processing config:', error);
    return null;
  }
}

// Start OpenClaw with proper logging
function startOpenClaw() {
  console.log('=== Starting OpenClaw Gateway ===');
  // OpenClaw uses OPENCLAW_CONFIG_PATH environment variable to specify config location
  const openclaw = spawn('openclaw', ['gateway', 'start'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: './config-runtime.json' // Official env var name
    }
  });

  openclaw.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.log(`[OpenClaw] ${output}`);
    }
  });

  openclaw.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.error(`[OpenClaw ERROR] ${output}`);
    }
  });

  openclaw.on('error', (error) => {
    console.error(`[OpenClaw] Failed to start: ${error.message}`);
    console.error('Make sure openclaw is installed via npm');
    process.exit(1);
  });

  openclaw.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`[OpenClaw] Process exited with code ${code} and signal ${signal}`);
      console.error('Check the logs above for errors');
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
      res.end('Error: Could not load the Clawbot start page.');
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

  // Process configuration
  const configReady = processConfig();
  if (!configReady) {
    console.error('❌ Configuration processing failed. Exiting.');
    process.exit(1);
  }

  // Start web server
  server.listen(PORT, () => {
    console.log(`✓ Web server listening on port ${PORT}`);
    console.log(`✓ Visit your Railway URL to see the success page`);
    // Start OpenClaw
    startOpenClaw();
  });
}

init();

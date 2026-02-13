// File: sidehustle-ai/provisioning-template/server.js
// Purpose: Entry point for the Railway service. Runs OpenClaw with the provided config.
// CommonJS version with Volume support

const { createServer } = require('http');
const { readFileSync, existsSync, mkdirSync } = require('fs');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const VOLUME_PATH = '/app/data';
const VOLUME_TIMEOUT = 60000; // 60 seconds
const VOLUME_CHECK_INTERVAL = 1000; // 1 second

// Wait for Volume to be mounted (Railway persistent storage)
function waitForVolume() {
    return new Promise((resolve, reject) => {
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

// Function to start the OpenClaw service in the background
function startOpenClaw() {
    console.log('Starting OpenClaw Gateway with config.json...');
    // The OpenClaw command uses the config.json file in the same directory.
    // We run it with 'nohup' and '&' to keep it running in the background.
    const command = 'nohup openclaw gateway start --config ./config.json > openclaw.log 2>&1 &';
    
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`OpenClaw startup error: ${error.message}`);
            return;
        }
        console.log('OpenClaw Gateway started successfully in the background.');
    });
}

// Simple HTTP server to serve the final success page
const server = createServer((req, res) => {
    // Only serve the success page on the root path
    if (req.url === '/') {
        try {
            // Read the success page HTML
            const html = readFileSync('./start-page.html'); 
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (e) {
            console.error('Error serving start-page.html:', e);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error: Could not load the Clawbot start page. Check the logs.');
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// Pre-flight: wait for volume, then start server
async function init() {
    // Wait for volume before starting
    await waitForVolume();
    
    server.listen(PORT, () => {
        console.log(`Web server listening on port ${PORT}`);
        // Start OpenClaw after web server is ready
        startOpenClaw();
    });
}

init();

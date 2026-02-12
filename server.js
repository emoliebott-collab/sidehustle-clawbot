// File: sidehustle-ai/provisioning-template/server.js
// Purpose: Entry point for the Railway service. Runs OpenClaw with the provided config.

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { exec } from 'child_process';

const PORT = process.env.PORT || 3000;

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

server.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
    // Start OpenClaw immediately after the web server is up
    startOpenClaw();
});

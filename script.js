// Bitmap Block Tracker with Historical Backfill
// Optimized for GeniiData Free Tier with Multi-API Key Support
// Supports multiple API keys for higher throughput and IP rotation
// Run with: node script.js

require('dotenv').config();
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
    MEMPOOL_WS_URL: 'wss://mempool.space/api/v1/ws',
    GENIIDATA_API_URL: 'https://api.geniidata.com/api/1/bitmap/bitmapInfo/bitmapNumber/',
      // Multi-API key support from environment variables (filter out empty keys)
    API_KEYS: (process.env.GENIIDATA_API_KEYS || '142cf1b0-1ca7-11ee-bb5e-9d74c2e854ac')
        .split(',')
        .map(key => key.trim())
        .filter(key => key && key.length > 0 && !key.includes('your-')), // Remove empty and placeholder keys
    USER_AGENTS: (process.env.USER_AGENTS || 'Bitmap-Block-Tracker/1.0').split(',').map(ua => ua.trim()),
    
    // IP rotation settings
    USE_PROXY_ROTATION: process.env.USE_PROXY_ROTATION === 'true',
    PROXY_LIST: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',').map(p => p.trim()) : [],
    ROTATE_USER_AGENTS: process.env.ROTATE_USER_AGENTS !== 'false',
    ROTATE_REQUEST_HEADERS: process.env.ROTATE_REQUEST_HEADERS !== 'false',
      CSV_FILE: process.env.CSV_FILE || 'bitmap_data.csv', // Main combined file
    HISTORICAL_CSV_FILE: process.env.HISTORICAL_CSV_FILE || 'bitmap_historical.csv', // Historical backfill (840000 -> up)
    REALTIME_CSV_FILE: process.env.REALTIME_CSV_FILE || 'bitmap_realtime.csv', // Real-time blocks (current -> up)
    PROGRESS_FILE: process.env.PROGRESS_FILE || 'backfill_progress.json',
    
    // Rate limits per API key
    MAX_REQUESTS_PER_DAY_PER_KEY: parseInt(process.env.MAX_REQUESTS_PER_DAY_PER_KEY) || 2000,
    MAX_REQUESTS_PER_SECOND: parseInt(process.env.MAX_REQUESTS_PER_SECOND) || 5,
    
    // Historical backfill settings
    HISTORICAL_START_BLOCK: parseInt(process.env.HISTORICAL_START_BLOCK) || 840000,
    
    // Timing - optimized for safe operation under rate limits
    REQUEST_INTERVAL: parseInt(process.env.REQUEST_INTERVAL) || 220, // 220ms = ~4.5 requests/second
    RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 5000,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 2,
      // Safety buffers
    DAILY_LIMIT_BUFFER: parseInt(process.env.DAILY_LIMIT_BUFFER) || 50,
    RATE_LIMIT_BUFFER: parseFloat(process.env.RATE_LIMIT_BUFFER) || 0.9,
    
    // Git Auto-Commit Settings
    AUTO_COMMIT_CSV: process.env.AUTO_COMMIT_CSV !== 'false', // Default to true
    GIT_COMMIT_MESSAGE: process.env.GIT_COMMIT_MESSAGE || 'Update Bitcoin bitmap data - Block {blockNumber}',
    GIT_PUSH_TO_REMOTE: process.env.GIT_PUSH_TO_REMOTE !== 'false', // Default to true
    GIT_BRANCH: process.env.GIT_BRANCH || 'main'
};

class BitmapTracker {
    constructor() {
        this.ws = null;
        this.csvInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
          // Multi-API key management
        this.apiKeys = CONFIG.API_KEYS;
        this.userAgents = CONFIG.USER_AGENTS;
        this.currentKeyIndex = 0;
        this.keyUsage = {}; // Track usage per API key
        this.processedBlocks = new Set(); // Track which blocks we've successfully processed
        
        // Initialize key usage tracking
        this.initializeKeyUsage();
        
        // Rate limiting
        this.requestsToday = 0;
        this.lastRequestTime = 0;
        this.dailyResetTime = this.getNextMidnight();
        
        // Queue management
        this.priorityQueue = []; // Real-time blocks (highest priority)
        this.backfillQueue = []; // Historical blocks (lower priority)
        this.processing = false;
          // Progress tracking
        this.currentBlock = 0;
        this.backfillProgress = this.loadBackfillProgress();
        this.scheduledSortCheck = 0; // Counter for triggering CSV sorts
        
        this.initializeQueues();
    }    // Initialize API key usage tracking
    initializeKeyUsage() {
        // Validate and filter API keys
        const validKeys = this.apiKeys.filter(key => {
            // Check if key is valid (not empty, not placeholder)
            const isValid = key && 
                           key.length > 10 && 
                           !key.includes('your-') && 
                           !key.includes('add-') && 
                           !key.includes('example');
            
            if (!isValid && key) {
                console.log(`⚠️  Skipping invalid/placeholder API key: ${key.substring(0, 8)}...`);
            }
            
            return isValid;
        });
        
        if (validKeys.length === 0) {
            console.error('❌ No valid API keys found! Please check your .env file.');
            console.error('🔑 Contact bd@geniidata.com for valid API keys');
            process.exit(1);
        }
        
        if (validKeys.length < this.apiKeys.length) {
            console.log(`🔧 Filtered ${this.apiKeys.length - validKeys.length} invalid/placeholder keys`);
        }
        
        // Update to only use valid keys
        this.apiKeys = validKeys;
        
        this.apiKeys.forEach((key, index) => {
            this.keyUsage[key] = {
                requestsToday: 0,
                lastRequestTime: 0,
                dailyResetTime: this.getNextMidnight(),
                userAgent: this.userAgents[index % this.userAgents.length] || 'Bitmap-Block-Tracker/1.0',
                headerRotation: index % 3 // Simple header rotation
            };
        });
        
        console.log(`🔑 Loaded ${this.apiKeys.length} valid API key${this.apiKeys.length > 1 ? 's' : ''} for load balancing`);
        console.log(`📈 Total Daily Capacity: ${this.apiKeys.length * CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY} requests/day`);
        
        if (CONFIG.USE_PROXY_ROTATION && CONFIG.PROXY_LIST.length > 0) {
            console.log(`🌐 Proxy rotation enabled with ${CONFIG.PROXY_LIST.length} proxies`);
        }
        if (CONFIG.ROTATE_USER_AGENTS) {
            console.log(`🔄 User agent rotation enabled`);
        }
    }

    // Get next available API key (round-robin with rate limiting)
    getNextAvailableKey() {
        const now = Date.now();
        
        // Try to find an available key starting from current index
        for (let i = 0; i < this.apiKeys.length; i++) {
            const keyIndex = (this.currentKeyIndex + i) % this.apiKeys.length;
            const key = this.apiKeys[keyIndex];
            const usage = this.keyUsage[key];
            
            // Reset daily counter if needed
            if (now >= usage.dailyResetTime) {
                usage.requestsToday = 0;
                usage.dailyResetTime = this.getNextMidnight();
                console.log(`🔄 Daily limit reset for API key ${keyIndex + 1}`);
            }
            
            // Check if this key can make a request
            const canUseKey = usage.requestsToday < (CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY - CONFIG.DAILY_LIMIT_BUFFER);
            const rateLimitOk = (now - usage.lastRequestTime) >= CONFIG.REQUEST_INTERVAL;
            
            if (canUseKey && rateLimitOk) {
                this.currentKeyIndex = (keyIndex + 1) % this.apiKeys.length; // Round-robin
                return { key, userAgent: usage.userAgent, keyIndex };
            }
        }
        
        return null; // No available keys
    }

    // Get enhanced request headers for IP rotation
    getRequestHeaders(keyInfo, usage) {
        const headers = {
            'Accept': 'application/json',
            'Api-Key': keyInfo.key,
            'User-Agent': keyInfo.userAgent
        };
        
        // Add rotation headers for better IP diversity
        if (CONFIG.ROTATE_REQUEST_HEADERS) {
            const rotationHeaders = [
                { 'Accept-Language': 'en-US,en;q=0.9' },
                { 'Accept-Language': 'en-GB,en;q=0.8' },
                { 'Accept-Language': 'en-CA,en;q=0.7' }
            ];
            
            Object.assign(headers, rotationHeaders[usage.headerRotation]);
            
            // Add additional entropy
            if (Math.random() > 0.5) {
                headers['Accept-Encoding'] = 'gzip, deflate, br';
            }
        }
        
        return headers;
    }    // Initialize CSV file with clean headers (only block and inscription_id)
    initializeCSV() {
        if (!this.csvInitialized) {
            const headers = 'block_number,inscription_id\n';
            
            // Check if CSV exists and needs format conversion
            if (fs.existsSync(CONFIG.CSV_FILE) && fs.statSync(CONFIG.CSV_FILE).size > 0) {
                const existingContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
                const firstLine = existingContent.split('\n')[0];
                
                // Check if old format (has status, timestamp columns)
                if (firstLine.includes('status') || firstLine.includes('timestamp')) {
                    console.log('🔄 Converting CSV from old format to clean format...');
                    this.convertToCleanCSV();            } else {
                // Already clean format, just load processed blocks
                this.loadProcessedBlocks();
                // Validate order on startup
                if (!this.validateCSVOrder()) {
                    console.log('🔄 CSV order validation triggered sorting...');
                }
            }
            } else {
                // Create new clean CSV
                fs.writeFileSync(CONFIG.CSV_FILE, headers);
                console.log(`📄 Created clean CSV file: ${CONFIG.CSV_FILE}`);
                this.processedBlocks = new Set();
            }
            
            this.csvInitialized = true;
        }
    }    // Convert old CSV format to clean format
    convertToCleanCSV() {
        try {
            const csvContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = csvContent.split('\n');
            
            // Create backup of old file
            const backupFile = CONFIG.CSV_FILE.replace('.csv', '_backup.csv');
            fs.writeFileSync(backupFile, csvContent);
            console.log(`📄 Backup created: ${backupFile}`);
            
            // Create new clean CSV
            const cleanLines = ['block_number,inscription_id'];
            this.processedBlocks = new Set();
            
            for (let i = 1; i < lines.length; i++) { // Skip header
                const line = lines[i].trim();
                if (line) {
                    const parts = line.split(',');
                    const blockNumber = parts[0];
                    const inscriptionId = parts[1] || '';
                    const status = parts[2] || '';
                    
                    // Only include successful entries with inscription IDs in clean CSV
                    if (status === 'success' && inscriptionId && inscriptionId !== '""' && inscriptionId !== '') {
                        cleanLines.push(`${blockNumber},${inscriptionId}`);
                    }
                    
                    // Mark block as processed regardless of whether it had a bitmap
                    const blockNum = parseInt(blockNumber);
                    if (!isNaN(blockNum)) {
                        this.processedBlocks.add(blockNum);
                    }
                }
            }
            
            // Write clean CSV
            fs.writeFileSync(CONFIG.CSV_FILE, cleanLines.join('\n') + '\n');
            console.log(`✅ Converted to clean format: ${cleanLines.length - 1} entries with bitmaps, ${this.processedBlocks.size} total processed blocks`);
            
        } catch (error) {
            this.logError('SYSTEM', 0, `Failed to convert CSV format: ${error.message}`);
            // Fallback to loading existing data
            this.loadProcessedBlocks();
        }
    }

    // Load processed blocks from existing CSV
    loadProcessedBlocks() {
        this.processedBlocks = new Set();
        try {
            const csvContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = csvContent.split('\n');
            
            for (let i = 1; i < lines.length; i++) { // Skip header
                const line = lines[i].trim();
                if (line) {
                    const blockNumber = parseInt(line.split(',')[0]);
                    if (!isNaN(blockNumber)) {
                        this.processedBlocks.add(blockNumber);
                    }
                }
            }
            
            console.log(`📊 Loaded ${this.processedBlocks.size} processed blocks from clean CSV`);
        } catch (error) {
            this.logError('SYSTEM', 0, `Failed to load processed blocks: ${error.message}`);
            this.processedBlocks = new Set();
        }
    }    // Write clean data to CSV (only entries with bitmaps)
    writeToCSV(blockNumber, inscriptionId) {
        // Always mark block as processed
        this.processedBlocks.add(blockNumber);
        
        if (inscriptionId) {
            // Only write to CSV if there's actually a bitmap
            const row = `${blockNumber},${inscriptionId}\n`;
            fs.appendFileSync(CONFIG.CSV_FILE, row);
            console.log(`📝 ✅ Block ${blockNumber}: ${inscriptionId}`);
            
            // Auto-commit to Git after writing CSV data
            this.autoCommitToGit(blockNumber, inscriptionId).catch(error => {
                // Log but don't stop execution if Git operations fail
                console.log(`⚠️ Git auto-commit error: ${error.message.substring(0, 100)}...`);
            });
            
            // Trigger periodic CSV sorting to maintain order
            this.scheduledSortCheck++;
            if (this.scheduledSortCheck >= 50) { // Sort every 50 new entries
                this.scheduledSortCheck = 0;
                setTimeout(() => this.sortCSVFile(), 1000); // Delay to avoid blocking
            }
        } else {
            // No bitmap found - don't write to CSV but log it
            console.log(`📝 📭 Block ${blockNumber}: no bitmap`);
        }
    }// Sort CSV file to maintain sequential order
    async sortCSVFile() {
        try {
            console.log('🔄 Sorting CSV to maintain sequential order...');
            
            const csvFile = CONFIG.CSV_FILE;
            if (!fs.existsSync(csvFile)) {
                return;
            }

            const content = fs.readFileSync(csvFile, 'utf8');
            const lines = content.split('\n');
            
            if (lines.length < 3) { // Header + at least 2 data lines
                return;
            }

            // Extract header and data
            const header = lines[0];
            const dataLines = lines.slice(1).filter(line => line.trim() !== '');
            
            // Parse and sort data by block number
            const parsedData = dataLines.map(line => {
                const parts = line.split(',');
                const blockNumber = parseInt(parts[0]);
                const inscriptionId = parts[1] || '';
                
                return { blockNumber, inscriptionId };
            }).filter(entry => !isNaN(entry.blockNumber));

            // Sort by block number
            parsedData.sort((a, b) => a.blockNumber - b.blockNumber);

            // Remove duplicates (keep first occurrence)
            const uniqueData = [];
            const seenBlocks = new Set();
            
            for (const entry of parsedData) {
                if (!seenBlocks.has(entry.blockNumber)) {
                    uniqueData.push(entry);
                    seenBlocks.add(entry.blockNumber);
                }
            }

            // Write sorted data back
            const sortedLines = [header];
            uniqueData.forEach(entry => {
                sortedLines.push(`${entry.blockNumber},${entry.inscriptionId}`);
            });

            fs.writeFileSync(csvFile, sortedLines.join('\n') + '\n');
            
            if (uniqueData.length !== parsedData.length) {
                console.log(`🧹 CSV sorted and cleaned: ${parsedData.length} -> ${uniqueData.length} entries`);
            } else {
                console.log(`📊 CSV sorted: ${uniqueData.length} entries in sequential order`);
            }
            
        } catch (error) {
            this.logError('CSV_SORT', 0, `Failed to sort CSV: ${error.message}`);
        }
    }

    // Enhanced error logging
    logError(level, blockNumber, message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level}] [Block ${blockNumber}] ${message}\n`;
        
        try {
            fs.appendFileSync('error.log', logEntry);
        } catch (err) {
            console.error('Failed to write to error log:', err.message);
        }
        
        console.error(`❌ ${level}: Block ${blockNumber} - ${message}`);
    }    // Validate CSV sequential order
    validateCSVOrder() {
        try {
            const csvFile = CONFIG.CSV_FILE;
            if (!fs.existsSync(csvFile)) {
                return true; // No file to validate
            }

            const content = fs.readFileSync(csvFile, 'utf8');
            const lines = content.split('\n').slice(1).filter(line => line.trim() !== '');
            
            if (lines.length <= 1) {
                return true; // Not enough data to validate
            }
            
            let previousBlock = -1;
            let outOfOrderCount = 0;
            
            for (const line of lines) {
                const blockNumber = parseInt(line.split(',')[0]);
                if (!isNaN(blockNumber)) {
                    if (blockNumber <= previousBlock) {
                        outOfOrderCount++;
                    }
                    previousBlock = blockNumber;
                }
            }

            if (outOfOrderCount > 0) {
                console.log(`⚠️ CSV has ${outOfOrderCount} out-of-order entries, scheduling sort...`);
                setTimeout(() => this.sortCSVFile(), 2000);
                return false;
            }

            return true;        } catch (error) {
            this.logError('CSV_VALIDATION', 0, `Failed to validate CSV order: ${error.message}`);
            return false;
        }
    }

    // Auto-commit CSV changes to Git after each block
    async autoCommitToGit(blockNumber, inscriptionId) {
        if (!CONFIG.AUTO_COMMIT_CSV) {
            return; // Auto-commit disabled
        }

        try {
            // Ensure CSV file is tracked by git
            execSync('git add bitmap_data.csv', { cwd: process.cwd(), stdio: 'pipe' });
            
            // Create commit message with block number
            const commitMessage = CONFIG.GIT_COMMIT_MESSAGE.replace('{blockNumber}', blockNumber);
            const hasChanges = execSync('git diff --cached --quiet || echo "changes"', { 
                cwd: process.cwd(), 
                stdio: 'pipe' 
            }).toString().trim();
            
            if (hasChanges === 'changes') {
                // Commit the changes
                execSync(`git commit -m "${commitMessage}"`, { 
                    cwd: process.cwd(), 
                    stdio: 'pipe' 
                });
                
                console.log(`📤 ✅ Git commit: Block ${blockNumber}`);
                
                // Push to remote if enabled
                if (CONFIG.GIT_PUSH_TO_REMOTE) {
                    try {
                        execSync(`git push origin ${CONFIG.GIT_BRANCH}`, { 
                            cwd: process.cwd(), 
                            stdio: 'pipe',
                            timeout: 10000 // 10 second timeout for push
                        });
                        console.log(`📤 🌐 Pushed to remote: Block ${blockNumber}`);
                    } catch (pushError) {
                        console.log(`⚠️ Git push failed: ${pushError.message.substring(0, 100)}...`);
                        // Continue operation even if push fails
                    }
                }
            }
            
        } catch (error) {
            console.log(`⚠️ Git auto-commit failed: ${error.message.substring(0, 100)}...`);
            // Don't stop operation for Git failures
        }
    }

    // Load backfill progress
    loadBackfillProgress() {
        try {
            if (fs.existsSync(CONFIG.PROGRESS_FILE)) {
                const progress = JSON.parse(fs.readFileSync(CONFIG.PROGRESS_FILE, 'utf8'));
                console.log(`📊 Loaded backfill progress: ${progress.lastProcessedBlock}`);
                return progress;
            }
        } catch (error) {
            console.log('⚠️ Could not load backfill progress, starting fresh');
        }
        
        return {
            lastProcessedBlock: CONFIG.HISTORICAL_START_BLOCK - 1,
            totalProcessed: 0,
            startTime: new Date().toISOString()
        };
    }

    // Save backfill progress
    saveBackfillProgress() {
        try {
            fs.writeFileSync(CONFIG.PROGRESS_FILE, JSON.stringify(this.backfillProgress, null, 2));
        } catch (error) {
            console.error('❌ Could not save backfill progress:', error.message);
        }
    }

    // Get next midnight for daily reset
    getNextMidnight() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow.getTime();
    }

    // Get total daily usage across all API keys
    getTotalDailyUsage() {
        return Object.values(this.keyUsage).reduce((total, usage) => total + usage.requestsToday, 0);
    }

    // Check if we can make a request (rate limiting with multi-key support)
    canMakeRequest() {
        return this.getNextAvailableKey() !== null;
    }

    // Wait for rate limit
    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const waitTime = CONFIG.REQUEST_INTERVAL - timeSinceLastRequest;
        
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    // Initialize queues
    async initializeQueues() {
        // Get current block height
        try {
            const currentBlock = await this.getCurrentBlockHeight();
            this.currentBlock = currentBlock;
            console.log(`📊 Current block height: ${currentBlock}`);
            
            // Queue historical blocks for backfill
            this.queueHistoricalBlocks();
            
        } catch (error) {
            console.error('❌ Could not get current block height:', error.message);
            // Continue anyway, websocket will provide current block
        }
    }

    // Get current block height from mempool.space API
    getCurrentBlockHeight() {
        return new Promise((resolve, reject) => {
            const req = https.get('https://mempool.space/api/blocks/tip/height', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const height = parseInt(data.trim());
                        resolve(height);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            
            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
    }    // Queue historical blocks for backfill with gap detection
    queueHistoricalBlocks() {
        const startBlock = this.backfillProgress.lastProcessedBlock + 1;
        const endBlock = Math.min(startBlock + 1000, this.currentBlock); // Process in chunks
        
        console.log(`📚 Analyzing blocks ${startBlock} to ${endBlock} for gaps...`);
        
        // First, detect gaps in already processed ranges
        this.detectAndQueueGaps();
        
        // Then queue new blocks in sequential order
        const newBlocks = [];
        for (let block = startBlock; block <= endBlock; block++) {
            if (!this.processedBlocks.has(block)) {
                newBlocks.push(block);
            }
        }
        
        // Add new blocks to end of queue (after gaps)
        this.backfillQueue.push(...newBlocks);
        
        // Sort the entire backfill queue to ensure sequential processing
        this.backfillQueue.sort((a, b) => a - b);
        
        console.log(`📋 Backfill queue: ${this.backfillQueue.length} blocks (gaps + new blocks, sorted sequentially)`);
        
        if (this.backfillQueue.length > 0) {
            const first = this.backfillQueue[0];
            const last = this.backfillQueue[this.backfillQueue.length - 1];
            console.log(`📊 Queue range: Block ${first} to ${last}`);
        }
    }// Detect gaps in processed blocks and queue them for backfill
    detectAndQueueGaps() {
        const gapsFound = [];
        
        // Check for gaps between start block and current progress
        for (let block = CONFIG.HISTORICAL_START_BLOCK; block <= this.backfillProgress.lastProcessedBlock; block++) {
            if (!this.processedBlocks.has(block)) {
                gapsFound.push(block);
            }
        }
        
        // Sort gaps to process them in order
        gapsFound.sort((a, b) => a - b);
        
        // Add gaps to front of queue (higher priority) in reverse order
        // so they are processed in sequential order
        for (let i = gapsFound.length - 1; i >= 0; i--) {
            this.backfillQueue.unshift(gapsFound[i]);
        }
        
        if (gapsFound.length > 0) {
            console.log(`🔍 Found ${gapsFound.length} gaps to backfill: ${gapsFound.slice(0, 10).join(', ')}${gapsFound.length > 10 ? '...' : ''}`);
            this.logError('GAP_DETECTED', 0, `Found ${gapsFound.length} missing blocks: ${gapsFound.slice(0, 20).join(', ')}`);
        }
    }// Fetch bitmap data from GeniiData API with enhanced error handling
    async fetchBitmapData(blockNumber) {
        // Get next available API key with fallback check
        const keyInfo = await this.getNextAvailableKeyWithFallback();
        if (!keyInfo) {
            throw new Error('Rate limit exceeded - all API keys exhausted');
        }
        
        // Respect rate limits strictly for free tier
        await this.waitForRateLimit();
        
        return new Promise((resolve, reject) => {
            const url = `${CONFIG.GENIIDATA_API_URL}${blockNumber}`;
            const usage = this.keyUsage[keyInfo.key];
            const options = {
                headers: this.getRequestHeaders(keyInfo, usage),
                timeout: 15000 // Longer timeout for better reliability
            };

            const req = https.get(url, options, (res) => {
                const now = Date.now();
                
                // Update usage for the specific key
                usage.lastRequestTime = now;
                usage.requestsToday++;
                
                // Update global tracking
                this.lastRequestTime = now;
                this.requestsToday++;
                
                console.log(`🔑 Using API key ${keyInfo.keyIndex + 1} (${usage.requestsToday}/${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY} requests today)`);
                
                // Check response status
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }
                  // Check content type
                const contentType = res.headers['content-type'];
                if (!contentType || !contentType.includes('application/json')) {
                    reject(new Error(`Invalid content type: ${contentType || 'unknown'}`));
                    return;
                }
                
                // Handle compression (gzip, deflate, br)
                let stream = res;
                const encoding = res.headers['content-encoding'];
                
                if (encoding === 'gzip') {
                    stream = res.pipe(zlib.createGunzip());
                } else if (encoding === 'deflate') {
                    stream = res.pipe(zlib.createInflate());
                } else if (encoding === 'br') {
                    stream = res.pipe(zlib.createBrotliDecompress());
                }
                
                let data = '';
                
                stream.on('data', chunk => {
                    data += chunk.toString('utf8');
                });
                  stream.on('end', () => {
                    // Validate response is not empty
                    if (!data || data.trim().length === 0) {
                        reject(new Error('Empty response received'));
                        return;
                    }
                    
                    // Only check for obvious corruption patterns, not normal API responses
                    if (data.length < 10 && (data === '""' || data === 'null' || data === 'undefined')) {
                        reject(new Error('Invalid response format'));
                        return;
                    }
                    
                    try {
                        const jsonData = JSON.parse(data);
                        
                        // Validate response structure
                        if (typeof jsonData !== 'object' || jsonData === null) {
                            reject(new Error('Invalid JSON structure'));
                            return;
                        }
                        
                        if (jsonData.code === 0 && jsonData.data && jsonData.data.length > 0) {
                            resolve(jsonData.data[0].inscription_id);
                        } else if (jsonData.code === 1001) {
                            reject(new Error(`Invalid API key (Key ${keyInfo.keyIndex + 1})`));
                        } else if (jsonData.code === 429) {
                            reject(new Error('Rate limit exceeded'));
                        } else {
                            resolve(null); // No bitmap found
                        }
                    } catch (error) {
                        reject(new Error(`JSON Parse Error: ${error.message} - Response: ${data.substring(0, 100)}...`));
                    }
                });
                
                // Handle decompression errors
                stream.on('error', (error) => {
                    reject(new Error(`Decompression Error: ${error.message}`));
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request Error: ${error.message}`));
            });
            
            req.setTimeout(15000, () => {
                req.destroy();
                reject(new Error('Request timeout (15s)'));
            });
        });
    }// Process a single block with improved error handling
    async processBlock(blockNumber, isPriority = false) {
        const prefix = isPriority ? '🔥' : '📚';
        
        // Skip if already processed
        if (this.processedBlocks.has(blockNumber)) {
            console.log(`⏭️ ${prefix} Block ${blockNumber}: already processed`);
            return true;
        }
        
        let retries = 0;
        while (retries < CONFIG.MAX_RETRIES) {
            try {
                if (!this.canMakeRequest()) {
                    // If we hit daily limit for all keys, stop processing
                    const totalDailyLimit = CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length;
                    if (this.requestsToday >= totalDailyLimit) {
                        console.log(`⏸️ All API keys exhausted (${totalDailyLimit} total requests). Pausing until tomorrow.`);
                        return false;
                    }
                    
                    // Otherwise wait for rate limit
                    await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_INTERVAL));
                    continue;
                }
                
                const inscriptionId = await this.fetchBitmapData(blockNumber);
                
                // Write to clean CSV (only successful results with bitmaps)
                this.writeToCSV(blockNumber, inscriptionId);
                
                // Update backfill progress if this was a historical block
                if (!isPriority && blockNumber > this.backfillProgress.lastProcessedBlock) {
                    this.backfillProgress.lastProcessedBlock = blockNumber;
                    this.backfillProgress.totalProcessed++;
                    if (this.backfillProgress.totalProcessed % 50 === 0) {
                        this.saveBackfillProgress();
                    }
                }
                
                return true;
                  } catch (error) {
                retries++;
                
                // Calculate exponential backoff delay for free tier optimization
                const backoffDelay = Math.min(CONFIG.RETRY_DELAY * Math.pow(2, retries - 1), 30000);
                
                if (error.message.includes('Invalid API key')) {
                    this.logError('API_ERROR', blockNumber, `${error.message} - attempt ${retries}/${CONFIG.MAX_RETRIES}`);
                } else if (error.message === 'Rate limit exceeded') {
                    this.logError('RATE_LIMIT', blockNumber, 'All API keys exhausted, waiting...');
                    // Longer wait for rate limit issues
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    continue;                } else if (error.message.includes('Invalid response format') || error.message.includes('JSON Parse Error')) {
                    this.logError('API_ERROR', blockNumber, `${error.message} - attempt ${retries}/${CONFIG.MAX_RETRIES}`);
                    // API issues use standard backoff
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                } else {
                    this.logError('FETCH_ERROR', blockNumber, `${error.message} - attempt ${retries}/${CONFIG.MAX_RETRIES}`);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                }
                
                if (retries >= CONFIG.MAX_RETRIES) {
                    this.logError('FAILED', blockNumber, `Failed after ${CONFIG.MAX_RETRIES} attempts with exponential backoff, will retry later`);
                    // Don't mark as processed - leave it for gap detection to pick up later
                    return true; // Continue processing other blocks
                }
                
                console.log(`⏳ Backing off for ${backoffDelay/1000}s before retry ${retries + 1}/${CONFIG.MAX_RETRIES}`);
            }
        }
        
        return true;
    }

    // API Key validation and monitoring
    async validateAPIKey(apiKey) {
        return new Promise((resolve, reject) => {
            const url = 'https://api.geniidata.com/api/1/key/info';
            const options = {
                headers: {
                    'Accept': 'application/json',
                    'Api-Key': apiKey,
                    'User-Agent': 'Bitmap-Tracker-Validator/1.0'
                }
            };

            const req = https.get(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        
                        if (jsonData.code === 0 && jsonData.data) {
                            const keyInfo = jsonData.data;
                            resolve({
                                valid: true,
                                plan: keyInfo.plan,
                                plan_status: keyInfo.plan_status,
                                requests_made: keyInfo.usage.current_day.requests_made,
                                requests_left: keyInfo.usage.current_day.requests_left
                            });
                        } else {
                            resolve({
                                valid: false,
                                error: `API Error: ${jsonData.code} - ${jsonData.message || 'Unknown error'}`
                            });
                        }
                    } catch (error) {
                        resolve({
                            valid: false,
                            error: `JSON Parse Error: ${error.message}`
                        });
                    }
                });
            });

            req.on('error', (error) => {
                resolve({
                    valid: false,
                    error: `Request Error: ${error.message}`
                });
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve({
                    valid: false,
                    error: 'Request timeout'
                });
            });
        });
    }

    // Validate all API keys on startup (sparingly used)
    async validateAllAPIKeys() {
        console.log('🔍 Validating API keys...');
        const validatedKeys = [];
        
        for (let i = 0; i < this.apiKeys.length; i++) {
            const key = this.apiKeys[i];
            console.log(`🔑 Validating key ${i + 1}/${this.apiKeys.length}: ${key.substring(0, 8)}...`);
            
            const validation = await this.validateAPIKey(key);
            
            if (validation.valid) {
                console.log(`✅ Key ${i + 1}: ${validation.plan} plan, ${validation.requests_left} requests left today`);
                validatedKeys.push({
                    key,
                    index: i,
                    ...validation
                });
                
                // Update our tracking with actual usage from API
                if (this.keyUsage[key]) {
                    this.keyUsage[key].requestsToday = validation.requests_made;
                }
            } else {
                console.log(`❌ Key ${i + 1}: ${validation.error}`);
                this.logError('API_KEY_INVALID', 0, `Key ${i + 1} (${key.substring(0, 8)}...): ${validation.error}`);
            }
            
            // Small delay between validations to avoid rate limiting
            if (i < this.apiKeys.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        if (validatedKeys.length === 0) {
            console.error('❌ No valid API keys found after validation!');
            console.error('🔑 Contact bd@geniidata.com for valid API keys');
            throw new Error('No valid API keys available');
        }
        
        // Update our API keys list to only include validated ones
        this.apiKeys = validatedKeys.map(v => v.key);
        console.log(`🎯 ${validatedKeys.length}/${this.apiKeys.length} API keys validated successfully`);
        
        const totalRequestsLeft = validatedKeys.reduce((sum, v) => sum + v.requests_left, 0);
        console.log(`📊 Total requests available today: ${totalRequestsLeft}`);
        
        return validatedKeys;
    }

    // Check key usage periodically (sparingly used - only when needed)
    async checkKeyUsage(apiKey, forceCheck = false) {
        const usage = this.keyUsage[apiKey];
        
        // Only check if we're getting close to limits or if forced
        const shouldCheck = forceCheck || 
                          usage.requestsToday > (CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * 0.8) ||
                          usage.requestsToday % 100 === 0; // Check every 100 requests
        
        if (!shouldCheck) {
            return null;
        }
        
        console.log(`🔍 Checking usage for API key...`);
        const validation = await this.validateAPIKey(apiKey);
        
        if (validation.valid) {
            // Update our local tracking with actual API data
            usage.requestsToday = validation.requests_made;
            console.log(`📊 API Key usage: ${validation.requests_made}/${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY} (${validation.requests_left} left)`);
            
            return validation;
        } else {
            this.logError('API_KEY_CHECK_FAILED', 0, `Key usage check failed: ${validation.error}`);
            return null;
        }
    }    // Main processing loop with free tier optimization
    async startProcessing() {
        if (this.processing) return;
        this.processing = true;
        
        console.log('🔄 Starting optimized processing loop for free tier...');
        
        while (true) {
            try {
                // Check if we're approaching daily limits (free tier safety)
                const currentUsage = this.getTotalDailyUsage();
                const dailyLimit = CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length;
                const usagePercentage = (currentUsage / dailyLimit) * 100;
                
                if (currentUsage >= dailyLimit - CONFIG.DAILY_LIMIT_BUFFER) {
                    console.log(`⏸️ Approaching daily limit: ${currentUsage}/${dailyLimit} requests (${usagePercentage.toFixed(1)}%)`);
                    console.log(`🕐 Pausing until tomorrow to preserve free tier quota...`);
                    await new Promise(resolve => setTimeout(resolve, 3600000)); // Wait 1 hour
                    continue;
                }
                
                // Log usage every 100 requests
                if (currentUsage > 0 && currentUsage % 100 === 0) {
                    console.log(`📊 Daily usage: ${currentUsage}/${dailyLimit} requests (${usagePercentage.toFixed(1)}%)`);
                }
                
                // Process real-time blocks first (highest priority)
                if (this.priorityQueue.length > 0) {
                    const blockNumber = this.priorityQueue.shift();
                    await this.processBlock(blockNumber, true);
                    continue;
                }
                
                // Process historical backfill (lower priority)
                if (this.backfillQueue.length > 0) {
                    const blockNumber = this.backfillQueue.shift();
                    const success = await this.processBlock(blockNumber, false);
                    
                    if (success) {
                        this.backfillProgress.lastProcessedBlock = blockNumber;
                        this.backfillProgress.totalProcessed++;
                        
                        // Queue next batch if we're running low
                        if (this.backfillQueue.length < 100) {
                            this.queueHistoricalBlocks();
                        }
                    } else {
                        // Add back to queue if failed
                        this.backfillQueue.unshift(blockNumber);
                        // Wait longer before retrying
                        await new Promise(resolve => setTimeout(resolve, 30000));
                    }
                    continue;
                }
                
                // If no blocks to process, queue more historical blocks
                if (this.backfillProgress.lastProcessedBlock < this.currentBlock - 1000) {
                    this.queueHistoricalBlocks();
                }
                
                // Wait before next iteration
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error('❌ Processing loop error:', error.message);
                this.logError('PROCESSING_LOOP', 0, `Processing error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    
    // Connect to WebSocket for real-time blocks
    connectWebSocket() {
        console.log('🔌 Connecting to mempool.space websocket...');
        
        this.ws = new WebSocket(CONFIG.MEMPOOL_WS_URL);
        
        this.ws.on('open', () => {
            console.log('✅ Connected to mempool.space websocket');
            this.ws.send(JSON.stringify({"action": "want", "data": ["blocks"]}));
            this.reconnectAttempts = 0;
        });
        
        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.block) {
                    const blockHeight = message.block.height;
                    if (!this.priorityQueue.includes(blockHeight)) {
                        this.priorityQueue.push(blockHeight);
                        console.log(`🔥 New block detected: ${blockHeight}`);
                        
                        if (blockHeight > this.currentBlock) {
                            this.currentBlock = blockHeight;
                        }
                    }
                }
            } catch (error) {
                console.error('❌ WebSocket message error:', error.message);
            }
        });
        
        this.ws.on('close', () => {
            console.log('⚠️ WebSocket connection closed');
            this.reconnect();
        });
        
        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
            this.reconnect();
        });
    }
    
    // Reconnect WebSocket with exponential backoff
    reconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            console.log(`🔄 Reconnecting WebSocket in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => this.connectWebSocket(), delay);
        } else {
            console.error('❌ Max reconnection attempts reached');
            this.logError('WEBSOCKET', 0, 'Max reconnection attempts reached');
        }
    }

    // Enhanced get next available key with fallback
    async getNextAvailableKeyWithFallback() {
        let keyInfo = this.getNextAvailableKey();
        
        // If no keys available, check if our usage tracking is accurate
        if (!keyInfo) {
            console.log('⚠️ No keys available according to local tracking, checking actual API usage...');
            
            // Check one key to see if we're tracking usage correctly
            for (const apiKey of this.apiKeys) {
                const actualUsage = await this.checkKeyUsage(apiKey, true);
                if (actualUsage && actualUsage.requests_left > CONFIG.DAILY_LIMIT_BUFFER) {
                    console.log('🔄 Found available key after usage check');
                    return this.getNextAvailableKey();
                }
            }
            
            console.log('⏸️ All API keys genuinely exhausted for today');
            return null;
        }
        
        return keyInfo;
    }

    // Print status
    printStatus() {
        const totalBlocks = this.currentBlock - CONFIG.HISTORICAL_START_BLOCK;
        const processedBlocks = this.backfillProgress.totalProcessed;
        const percentage = totalBlocks > 0 ? ((processedBlocks / totalBlocks) * 100).toFixed(1) : 0;
        
        console.log(`\n📊 STATUS REPORT`);
        console.log(`─────────────────────────────────────`);
        console.log(`🔥 Priority Queue: ${this.priorityQueue.length} blocks`);
        console.log(`📚 Backfill Queue: ${this.backfillQueue.length} blocks`);
        console.log(`📈 Progress: ${processedBlocks}/${totalBlocks} blocks (${percentage}%)`);
        console.log(`📅 Requests Today: ${this.requestsToday}/${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length}`);
        console.log(`🎯 Current Block: ${this.currentBlock}`);
        console.log(`📍 Last Processed: ${this.backfillProgress.lastProcessedBlock}`);
        console.log(`────────────────────────────────────────\n`);
    }

    // Start the tracker
    async start() {
        console.log('🚀 Starting Bitmap Block Tracker with Historical Backfill...');
        console.log(`📁 CSV file: ${path.resolve(CONFIG.CSV_FILE)}`);
        console.log(`🔑 API Keys: ${this.apiKeys.length} keys loaded`);
        console.log(`📊 Rate Limits: ${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY}/day per key, ${CONFIG.MAX_REQUESTS_PER_SECOND}/sec`);
        console.log(`📈 Total Daily Capacity: ${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length} requests`);
        console.log(`📚 Historical Range: ${CONFIG.HISTORICAL_START_BLOCK} to current`);
        
        this.initializeCSV();
        this.connectWebSocket();
        
        // Start processing after a short delay
        setTimeout(() => {
            this.startProcessing();
        }, 2000);
        
        // Print status every 5 minutes
        setInterval(() => {
            this.printStatus();
        }, 5 * 60 * 1000);
        
        // Save progress every 10 minutes
        setInterval(() => {
            this.saveBackfillProgress();
        }, 10 * 60 * 1000);

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down gracefully...');
            this.saveBackfillProgress();
            if (this.ws) this.ws.close();
            console.log('👋 Goodbye!');
            process.exit(0);
        });
    }
}

// Main execution
if (require.main === module) {
    console.log('📈 Bitmap Block Tracker v2.0 - Historical Backfill Edition');
    console.log('═══════════════════════════════════════════════════════════');
    
    if (CONFIG.API_KEYS.includes('142cf1b0-1ca7-11ee-bb5e-9d74c2e854ac')) {
        console.log('⚠️  WARNING: Using default API key from documentation.');
        console.log('⚠️  Contact bd@geniidata.com for valid keys and update your .env file');
    }

    const tracker = new BitmapTracker();
    tracker.start();
}

module.exports = BitmapTracker;
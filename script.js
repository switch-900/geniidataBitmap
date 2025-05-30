// Enhanced Bitmap Block Tracker with API Server
// Optimized for GeniiData Free Tier with Multi-API Key Support
// Includes Ordinals.com integration for sat numbers and additional data
// Provides REST API at https://switch-900.github.io/geniidataBitmap/
// Run with: node server.js

require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const cors = require('cors');

// Configuration
const CONFIG = {
    // Server Configuration
    PORT: process.env.PORT || 3000,
    HOST: process.env.HOST || '0.0.0.0',
    
    // External APIs
    MEMPOOL_WS_URL: 'wss://mempool.space/api/v1/ws',
    GENIIDATA_API_URL: 'https://api.geniidata.com/api/1/bitmap/bitmapInfo/bitmapNumber/',
    ORDINALS_API_URL: 'https://ordinals.com/r',
    
    // Multi-API key support from environment variables (filter out empty keys)
    API_KEYS: (process.env.GENIIDATA_API_KEYS || '142cf1b0-1ca7-11ee-bb5e-9d74c2e854ac')
        .split(',')
        .map(key => key.trim())
        .filter(key => key && key.length > 0 && !key.includes('your-')),
    USER_AGENTS: (process.env.USER_AGENTS || 'Enhanced-Bitmap-Tracker/2.0').split(',').map(ua => ua.trim()),
    
    // IP rotation settings
    USE_PROXY_ROTATION: process.env.USE_PROXY_ROTATION === 'true',
    PROXY_LIST: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',').map(p => p.trim()) : [],
    ROTATE_USER_AGENTS: process.env.ROTATE_USER_AGENTS !== 'false',
    ROTATE_REQUEST_HEADERS: process.env.ROTATE_REQUEST_HEADERS !== 'false',
    
    // File Configuration
    CSV_FILE: process.env.CSV_FILE || 'bitmap_data.csv',
    HISTORICAL_CSV_FILE: process.env.HISTORICAL_CSV_FILE || 'bitmap_historical.csv',
    REALTIME_CSV_FILE: process.env.REALTIME_CSV_FILE || 'bitmap_realtime.csv',
    PROGRESS_FILE: process.env.PROGRESS_FILE || 'backfill_progress.json',
    
    // Rate limits per API key
    MAX_REQUESTS_PER_DAY_PER_KEY: parseInt(process.env.MAX_REQUESTS_PER_DAY_PER_KEY) || 2000,
    MAX_REQUESTS_PER_SECOND: parseInt(process.env.MAX_REQUESTS_PER_SECOND) || 5,
    
    // Ordinals API rate limiting
    ORDINALS_REQUEST_INTERVAL: parseInt(process.env.ORDINALS_REQUEST_INTERVAL) || 1000, // 1 second between requests
    ORDINALS_MAX_RETRIES: parseInt(process.env.ORDINALS_MAX_RETRIES) || 3,
    
    // Historical backfill settings
    HISTORICAL_START_BLOCK: parseInt(process.env.HISTORICAL_START_BLOCK) || 840000,
    
    // Timing - optimized for safe operation under rate limits
    REQUEST_INTERVAL: parseInt(process.env.REQUEST_INTERVAL) || 220,
    RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 5000,
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 2,
    
    // Safety buffers
    DAILY_LIMIT_BUFFER: parseInt(process.env.DAILY_LIMIT_BUFFER) || 50,
    RATE_LIMIT_BUFFER: parseFloat(process.env.RATE_LIMIT_BUFFER) || 0.9,
    
    // Git Auto-Commit Settings
    AUTO_COMMIT_CSV: process.env.AUTO_COMMIT_CSV !== 'false',
    GIT_COMMIT_MESSAGE: process.env.GIT_COMMIT_MESSAGE || 'Update Bitcoin bitmap data - Block {blockNumber}',
    GIT_PUSH_TO_REMOTE: process.env.GIT_PUSH_TO_REMOTE !== 'false',
    GIT_BRANCH: process.env.GIT_BRANCH || 'main'
};

class EnhancedBitmapTracker {
    constructor() {
        this.app = express();
        this.ws = null;
        this.csvInitialized = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        
        // Multi-API key management
        this.apiKeys = CONFIG.API_KEYS;
        this.userAgents = CONFIG.USER_AGENTS;
        this.currentKeyIndex = 0;
        this.keyUsage = {};
        this.processedBlocks = new Set();
          // Data cache for API responses
        this.blockCache = new Map();
        this.cacheSize = 1000; // Keep last 1000 blocks in memory
        
        // Proxy management
        this.proxyList = CONFIG.PROXY_LIST;
        this.currentProxyIndex = 0;
        this.proxyFailures = new Map();
          // Initialize proxy configuration
        if (CONFIG.USE_PROXY_ROTATION && this.proxyList.length > 0) {
            console.log(`🔄 Proxy rotation enabled (${this.proxyList.length} proxies)`);
        } else if (CONFIG.USE_PROXY_ROTATION) {
            console.log('⚠️ Proxy rotation enabled but no proxies configured');
        }
        this.useProxy = process.env.USE_PROXY_ROTATION === 'true';
        
        // Initialize components
        this.initializeKeyUsage();
        this.setupExpressServer();
        
        // Rate limiting
        this.requestsToday = 0;
        this.lastRequestTime = 0;
        this.lastOrdinalsRequest = 0;
        this.dailyResetTime = this.getNextMidnight();
        
        // Queue management
        this.priorityQueue = [];
        this.backfillQueue = [];
        this.processing = false;
        
        // Progress tracking
        this.currentBlock = 0;
        this.backfillProgress = this.loadBackfillProgress();
        this.scheduledSortCheck = 0;
        
        this.initializeQueues();
    }

    // Setup Express server with API routes
    setupExpressServer() {
        // Middleware
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'public')));

        // API Routes
        this.app.get('/api/block/:blockNumber', this.getBlockData.bind(this));
        this.app.get('/api/blocks', this.getAllBlocks.bind(this));
        this.app.get('/api/stats', this.getStats.bind(this));
        this.app.get('/api/latest', this.getLatestBlocks.bind(this));
        this.app.get('/api/search/:query', this.searchBlocks.bind(this));
        
        // Direct block access (GitHub Pages style)
        this.app.get('/:blockNumber', this.getBlockData.bind(this));
        
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: process.uptime(),
                currentBlock: this.currentBlock,
                processedBlocks: this.processedBlocks.size,
                cacheSize: this.blockCache.size
            });
        });

        // Serve main page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
    }    // API endpoint to get block data
    async getBlockData(req, res) {
        try {
            const blockNumber = parseInt(req.params.blockNumber);
            const includeSat = req.query.sat === 'true'; // Optional query parameter to fetch sat numbers
            
            if (isNaN(blockNumber) || blockNumber < 0) {
                return res.status(400).json({
                    error: 'Invalid block number',
                    message: 'Block number must be a positive integer'
                });
            }

            // Check cache first
            if (this.blockCache.has(blockNumber)) {
                const cachedData = this.blockCache.get(blockNumber);
                
                // If sat numbers requested but not in cache, fetch them dynamically
                if (includeSat && !cachedData.satNumber && cachedData.inscriptionId) {
                    try {
                        const ordinalsData = await this.fetchOrdinalsData(cachedData.inscriptionId);
                        if (ordinalsData && ordinalsData.sat) {
                            const enrichedData = {
                                ...cachedData,
                                satNumber: ordinalsData.sat,
                                address: ordinalsData.address,
                                value: ordinalsData.value,
                                fee: ordinalsData.fee
                            };
                            return res.json(enrichedData);
                        }
                    } catch (error) {
                        console.log(`⚠️ Failed to fetch ordinals data for ${cachedData.inscriptionId}: ${error.message}`);
                    }
                }
                
                return res.json(cachedData);
            }

            // Try to get from CSV
            const csvData = await this.getBlockFromCSV(blockNumber);
            if (csvData) {
                // If sat numbers requested, fetch them dynamically from ordinals
                if (includeSat && csvData.inscriptionId) {
                    try {
                        const ordinalsData = await this.fetchOrdinalsData(csvData.inscriptionId);
                        if (ordinalsData && ordinalsData.sat) {
                            csvData.satNumber = ordinalsData.sat;
                            csvData.address = ordinalsData.address;
                            csvData.value = ordinalsData.value;
                            csvData.fee = ordinalsData.fee;
                        }
                    } catch (error) {
                        console.log(`⚠️ Failed to fetch ordinals data for ${csvData.inscriptionId}: ${error.message}`);
                    }
                }
                
                // Cache the result
                this.blockCache.set(blockNumber, csvData);
                this.trimCache();
                return res.json(csvData);
            }

            // If not found and block is recent, try to fetch it
            if (blockNumber >= this.currentBlock - 100) {
                try {
                    const blockData = await this.fetchCompleteBlockData(blockNumber);
                    if (blockData) {
                        // If sat numbers requested, fetch them dynamically
                        if (includeSat && blockData.inscriptionId) {
                            try {
                                const ordinalsData = await this.fetchOrdinalsData(blockData.inscriptionId);
                                if (ordinalsData && ordinalsData.sat) {
                                    blockData.satNumber = ordinalsData.sat;
                                    blockData.address = ordinalsData.address;
                                    blockData.value = ordinalsData.value;
                                    blockData.fee = ordinalsData.fee;
                                }
                            } catch (error) {
                                console.log(`⚠️ Failed to fetch ordinals data for ${blockData.inscriptionId}: ${error.message}`);
                            }
                        }
                        
                        this.blockCache.set(blockNumber, blockData);
                        this.trimCache();
                        return res.json(blockData);
                    }
                } catch (error) {
                    console.error(`Error fetching block ${blockNumber}:`, error.message);
                }
            }

            res.status(404).json({
                error: 'Block not found',
                message: `No bitmap data found for block ${blockNumber}`,
                blockNumber: blockNumber
            });

        } catch (error) {
            console.error('API Error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    // Get all blocks with pagination
    async getAllBlocks(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
            const offset = (page - 1) * limit;

            const blocks = await this.getBlocksFromCSV(offset, limit);
            const total = this.processedBlocks.size;

            res.json({
                blocks: blocks,
                pagination: {
                    page: page,
                    limit: limit,
                    total: total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Get tracker statistics
    async getStats(req, res) {
        try {
            const totalBlocks = this.currentBlock - CONFIG.HISTORICAL_START_BLOCK;
            const processedBlocks = this.processedBlocks.size;
            const percentage = totalBlocks > 0 ? ((processedBlocks / totalBlocks) * 100) : 0;

            res.json({
                currentBlock: this.currentBlock,
                historicalStartBlock: CONFIG.HISTORICAL_START_BLOCK,
                totalBlocksInRange: totalBlocks,
                processedBlocks: processedBlocks,
                completionPercentage: parseFloat(percentage.toFixed(2)),
                queueSizes: {
                    priority: this.priorityQueue.length,
                    backfill: this.backfillQueue.length
                },
                requestsToday: this.requestsToday,
                apiKeysCount: this.apiKeys.length,
                cacheSize: this.blockCache.size,
                uptime: process.uptime()
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Get latest blocks with bitmaps
    async getLatestBlocks(req, res) {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 10, 100);
            const latestBlocks = await this.getLatestBlocksFromCSV(limit);
            
            res.json({
                blocks: latestBlocks,
                count: latestBlocks.length
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Search blocks by inscription ID or sat number
    async searchBlocks(req, res) {
        try {
            const query = req.params.query;
            const results = await this.searchInCSV(query);
            
            res.json({
                query: query,
                results: results,
                count: results.length
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }    // Fetch complete block data - gets essential data from CSV, optionally fetches sat numbers dynamically
    async fetchCompleteBlockData(blockNumber) {
        try {
            // First check CSV for essential data
            const csvData = await this.getBlockFromCSV(blockNumber);
            if (csvData) {
                return csvData; // Return data including sat number if available
            }

            // If not in CSV, try to fetch fresh data from GeniiData
            const inscriptionId = await this.fetchBitmapData(blockNumber);
            if (inscriptionId) {
                let satNumber = '';
                
                // Try to fetch sat number from ordinals API when getting new data
                try {
                    const ordinalsData = await this.fetchOrdinalsData(inscriptionId);
                    if (ordinalsData && ordinalsData.sat) {
                        satNumber = ordinalsData.sat;
                        console.log(`🔢 Fetched sat number ${satNumber} for block ${blockNumber}`);
                    }
                } catch (error) {
                    console.log(`⚠️ Could not fetch sat number for ${inscriptionId}: ${error.message}`);
                }
                
                // Save to CSV with sat number (if available)
                await this.writeToCSV(blockNumber, inscriptionId, satNumber);
                
                return {
                    blockNumber: blockNumber,
                    inscriptionId: inscriptionId,
                    satNumber: satNumber || null,
                    dataSource: 'GeniiData',
                    timestamp: new Date().toISOString()
                };
            }

            return null;

        } catch (error) {
            console.error(`Error fetching complete data for block ${blockNumber}:`, error);
            return null;
        }
    }

    // Fetch data from Ordinals API
    async fetchOrdinalsData(inscriptionId) {
        if (!inscriptionId) return null;

        await this.waitForOrdinalsRateLimit();

        return new Promise((resolve, reject) => {
            const url = `${CONFIG.ORDINALS_API_URL}/inscription/${inscriptionId}`;
            const options = {
                headers: {
                    'User-Agent': 'Enhanced-Bitmap-Tracker/2.0',
                    'Accept': 'application/json'
                },
                timeout: 10000
            };

            const req = https.get(url, options, (res) => {
                this.lastOrdinalsRequest = Date.now();

                if (res.statusCode !== 200) {
                    console.log(`⚠️ Ordinals API returned ${res.statusCode} for ${inscriptionId}`);
                    resolve(null);
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (error) {
                        console.error(`JSON parse error for ${inscriptionId}:`, error.message);
                        resolve(null);
                    }
                });
            });

            req.on('error', (error) => {
                console.error(`Request error for ${inscriptionId}:`, error.message);
                resolve(null);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve(null);
            });
        });
    }

    // Fetch block info from Ordinals API
    async fetchBlockInfo(blockNumber) {
        await this.waitForOrdinalsRateLimit();

        return new Promise((resolve, reject) => {
            const url = `${CONFIG.ORDINALS_API_URL}/blockinfo/${blockNumber}`;
            const options = {
                headers: {
                    'User-Agent': 'Enhanced-Bitmap-Tracker/2.0',
                    'Accept': 'application/json'
                },
                timeout: 10000
            };

            const req = https.get(url, options, (res) => {
                this.lastOrdinalsRequest = Date.now();

                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (error) {
                        resolve(null);
                    }
                });
            });

            req.on('error', () => resolve(null));
            req.setTimeout(10000, () => {
                req.destroy();
                resolve(null);
            });
        });
    }

    // Wait for Ordinals API rate limit
    async waitForOrdinalsRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastOrdinalsRequest;
        const waitTime = CONFIG.ORDINALS_REQUEST_INTERVAL - timeSinceLastRequest;
        
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }    // Get block data from CSV
    async getBlockFromCSV(blockNumber) {
        try {
            if (!fs.existsSync(CONFIG.CSV_FILE)) {
                return null;
            }

            const content = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = content.split('\n');

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const parts = line.split(',');
                if (parseInt(parts[0]) === blockNumber) {
                    return {
                        blockNumber: blockNumber,
                        inscriptionId: parts[1] || null,
                        satNumber: parts[2] || null,
                        dataSource: 'CSV',
                        timestamp: new Date().toISOString()
                    };
                }
            }

            return null;
        } catch (error) {
            console.error('Error reading CSV:', error);
            return null;
        }
    }    // Get blocks from CSV with pagination
    async getBlocksFromCSV(offset, limit) {
        try {
            if (!fs.existsSync(CONFIG.CSV_FILE)) {
                return [];
            }

            const content = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = content.split('\n').slice(1).filter(line => line.trim());

            const startIndex = offset;
            const endIndex = Math.min(startIndex + limit, lines.length);
            const selectedLines = lines.slice(startIndex, endIndex);

            return selectedLines.map(line => {
                const parts = line.split(',');
                return {
                    blockNumber: parseInt(parts[0]),
                    inscriptionId: parts[1] || null,
                    satNumber: parts[2] || null,
                    dataSource: 'CSV',
                    timestamp: new Date().toISOString()
                };
            });
        } catch (error) {
            console.error('Error reading CSV for pagination:', error);
            return [];
        }
    }    // Get latest blocks from CSV
    async getLatestBlocksFromCSV(limit) {
        try {
            if (!fs.existsSync(CONFIG.CSV_FILE)) {
                return [];
            }

            const content = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = content.split('\n').slice(1).filter(line => line.trim());

            // Get the last N lines
            const latestLines = lines.slice(-limit).reverse();

            return latestLines.map(line => {
                const parts = line.split(',');
                return {
                    blockNumber: parseInt(parts[0]),
                    inscriptionId: parts[1] || null,
                    satNumber: parts[2] || null,
                    dataSource: 'CSV',
                    timestamp: new Date().toISOString()
                };
            });
        } catch (error) {
            console.error('Error reading latest blocks from CSV:', error);
            return [];
        }
    }    // Search in CSV
    async searchInCSV(query) {
        try {
            if (!fs.existsSync(CONFIG.CSV_FILE)) {
                return [];
            }

            const content = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = content.split('\n').slice(1).filter(line => line.trim());

            const results = [];
            for (const line of lines) {
                const parts = line.split(',');
                if (line.includes(query)) {
                    results.push({
                        blockNumber: parseInt(parts[0]),
                        inscriptionId: parts[1] || null,
                        satNumber: parts[2] || null,
                        dataSource: 'CSV',
                        timestamp: new Date().toISOString()
                    });
                }
            }

            return results.slice(0, 100); // Limit to 100 results
        } catch (error) {
            console.error('Error searching CSV:', error);
            return [];
        }
    }

    // Trim cache to maintain size limit
    trimCache() {
        if (this.blockCache.size > this.cacheSize) {
            const entries = Array.from(this.blockCache.entries());
            entries.sort((a, b) => b[0] - a[0]); // Sort by block number descending
            
            this.blockCache.clear();
            for (let i = 0; i < this.cacheSize; i++) {
                if (entries[i]) {
                    this.blockCache.set(entries[i][0], entries[i][1]);
                }
            }
        }
    }    // Initialize CSV with essential 3-column headers
    initializeCSV() {
        if (!this.csvInitialized) {
            const headers = 'block_number,inscription_id,sat_number\n';
            
            if (fs.existsSync(CONFIG.CSV_FILE) && fs.statSync(CONFIG.CSV_FILE).size > 0) {
                const existingContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
                const firstLine = existingContent.split('\n')[0];
                
                // Check if we need to update the CSV format to include sat_number
                if (firstLine.includes('address') || firstLine.includes('fee') || firstLine.includes('timestamp')) {
                    console.log('🔄 Simplifying CSV format to essential 3-column data...');
                    this.simplifyCSVFormat();
                } else if (!firstLine.includes('sat_number')) {
                    console.log('🔄 Updating CSV format to include sat_number...');
                    this.updateCSVToIncludeSat();
                } else {
                    this.loadProcessedBlocks();
                    if (!this.validateCSVOrder()) {
                        console.log('🔄 CSV order validation triggered sorting...');
                    }
                }
            } else {
                fs.writeFileSync(CONFIG.CSV_FILE, headers);
                console.log(`📄 Created 3-column CSV file: ${CONFIG.CSV_FILE}`);
                this.processedBlocks = new Set();
            }
            
            this.csvInitialized = true;
        }
    }    // Simplify CSV format to essential 3-column data only
    simplifyCSVFormat() {
        try {
            const csvContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = csvContent.split('\n');
            
            // Create backup
            const backupFile = CONFIG.CSV_FILE.replace('.csv', '_backup_simplify.csv');
            fs.writeFileSync(backupFile, csvContent);
            console.log(`📄 Backup created: ${backupFile}`);
            
            // Create new simplified CSV with 3 essential columns
            const simplifiedLines = ['block_number,inscription_id,sat_number'];
            this.processedBlocks = new Set();
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line) {
                    const parts = line.split(',');
                    const blockNumber = parts[0];
                    const inscriptionId = parts[1] || '';
                    const satNumber = parts[2] || ''; // Keep sat number if available
                    
                    if (inscriptionId && inscriptionId !== '""' && inscriptionId !== '') {
                        // Keep essential data: block number, inscription ID, and sat number
                        simplifiedLines.push(`${blockNumber},${inscriptionId},${satNumber}`);
                    }
                    
                    const blockNum = parseInt(blockNumber);
                    if (!isNaN(blockNum)) {
                        this.processedBlocks.add(blockNum);
                    }
                }
            }
            
            fs.writeFileSync(CONFIG.CSV_FILE, simplifiedLines.join('\n') + '\n');
            console.log(`✅ Simplified CSV format: ${simplifiedLines.length - 1} entries (3-column essential data)`);
            
        } catch (error) {
            this.logError('CSV_SIMPLIFY', 0, `Failed to simplify CSV format: ${error.message}`);
            this.loadProcessedBlocks();
        }
    }

    // Update CSV format to include sat_number column
    updateCSVToIncludeSat() {
        try {
            const csvContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = csvContent.split('\n');
            
            // Create backup
            const backupFile = CONFIG.CSV_FILE.replace('.csv', '_backup_add_sat.csv');
            fs.writeFileSync(backupFile, csvContent);
            console.log(`📄 Backup created: ${backupFile}`);
            
            // Update CSV to include sat_number column
            const updatedLines = ['block_number,inscription_id,sat_number'];
            this.processedBlocks = new Set();
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line) {
                    const parts = line.split(',');
                    const blockNumber = parts[0];
                    const inscriptionId = parts[1] || '';
                    
                    if (inscriptionId && inscriptionId !== '""' && inscriptionId !== '') {
                        // Add empty sat_number field - will be filled when data is fetched
                        updatedLines.push(`${blockNumber},${inscriptionId},`);
                    }
                    
                    const blockNum = parseInt(blockNumber);
                    if (!isNaN(blockNum)) {
                        this.processedBlocks.add(blockNum);
                    }
                }
            }
            
            fs.writeFileSync(CONFIG.CSV_FILE, updatedLines.join('\n') + '\n');
            console.log(`✅ Updated CSV format: ${updatedLines.length - 1} entries (added sat_number column)`);
            
        } catch (error) {
            this.logError('CSV_UPDATE', 0, `Failed to update CSV format: ${error.message}`);
            this.loadProcessedBlocks();
        }
    }    // Simplified writeToCSV with essential 3-column data
    async writeToCSV(blockNumber, inscriptionId, satNumber = '') {
        this.processedBlocks.add(blockNumber);
        
        if (inscriptionId) {
            // Write 3-column data: block number, inscription ID, and sat number (empty for now)
            const row = `${blockNumber},${inscriptionId},${satNumber}\n`;
            fs.appendFileSync(CONFIG.CSV_FILE, row);
              console.log(`📝 ✅ Block ${blockNumber}: ${inscriptionId}${satNumber ? ` (sat: ${satNumber})` : ''}`);
            
            // Cache the essential data (including sat number if available)
            const essentialData = {
                blockNumber: blockNumber,
                inscriptionId: inscriptionId,
                satNumber: satNumber || null,
                dataSource: 'CSV',
                timestamp: new Date().toISOString()
            };
            
            this.blockCache.set(blockNumber, essentialData);
            this.trimCache();
            
            // Auto-commit to Git
            this.autoCommitToGit(blockNumber, inscriptionId).catch(error => {
                console.log(`⚠️ Git auto-commit error: ${error.message.substring(0, 100)}...`);
            });
            
            this.scheduledSortCheck++;
            if (this.scheduledSortCheck >= 50) {
                this.scheduledSortCheck = 0;
                setTimeout(() => this.sortCSVFile(), 1000);
            }
        } else {
            // No bitmap found - this is a legitimate result, not an error
            console.log(`📝 📭 Block ${blockNumber}: no bitmap (confirmed empty)`);
        }
    }// Start the enhanced server
    async start() {
        console.log('🚀 Starting Enhanced Bitmap Block Tracker...');
        console.log(`📁 CSV: ${path.resolve(CONFIG.CSV_FILE)}`);
        console.log(`🔑 Keys: ${this.apiKeys.length} | Rate limit: ${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY}/day`);
        console.log(`📚 Range: ${CONFIG.HISTORICAL_START_BLOCK} to current`);
        
        this.initializeCSV();
        this.connectWebSocket();
        
        // Start the Express server with dynamic port selection
        const selectedPort = await this.startServerWithPortSelection();
        
        // Start processing after server is ready
        setTimeout(() => {
            this.startProcessing();
        }, 2000);
        
        // Status and save intervals
        setInterval(() => this.printStatus(), 5 * 60 * 1000);
        setInterval(() => this.saveBackfillProgress(), 10 * 60 * 1000);

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down gracefully...');
            this.saveBackfillProgress();
            if (this.ws) this.ws.close();
            console.log('👋 Goodbye!');
            process.exit(0);
        });
    }

    // Dynamic port selection to handle EADDRINUSE errors
    async startServerWithPortSelection() {
        const tryPorts = [CONFIG.PORT, 3001, 3002, 3003, 3004, 3005, 8080, 8081, 8082];
        let selectedPort = null;

        for (const port of tryPorts) {
            try {
                await new Promise((resolve, reject) => {
                    const server = this.app.listen(port, CONFIG.HOST, () => {
                        selectedPort = port;
                        console.log(`🌐 API Server successfully started on http://${CONFIG.HOST}:${port}`);
                        console.log(`📋 API Endpoints:`);
                        console.log(`   GET /api/block/:blockNumber - Get specific block data`);
                        console.log(`   GET /api/blocks?page=1&limit=50 - Get all blocks with pagination`);
                        console.log(`   GET /api/stats - Get tracker statistics`);
                        console.log(`   GET /api/latest?limit=10 - Get latest blocks`);
                        console.log(`   GET /api/search/:query - Search blocks`);
                        console.log(`   GET /:blockNumber - Direct block access`);
                        console.log(`   GET /health - Health check`);
                        
                        if (port !== CONFIG.PORT) {
                            console.log(`⚠️  Note: Using port ${port} instead of configured port ${CONFIG.PORT}`);
                            console.log(`💡 To use port ${CONFIG.PORT}, make sure it's not already in use`);
                        }
                        
                        resolve(server);
                    });

                    server.on('error', (error) => {
                        if (error.code === 'EADDRINUSE') {
                            console.log(`⚠️  Port ${port} is already in use, trying next port...`);
                            reject(error);
                        } else {
                            reject(error);
                        }
                    });
                });
                
                // If we get here, the server started successfully
                break;
                
            } catch (error) {
                if (error.code !== 'EADDRINUSE') {
                    throw error; // Re-throw non-port-conflict errors
                }
                // Continue to next port for EADDRINUSE errors
            }
        }

        if (!selectedPort) {
            throw new Error(`❌ Could not start server on any available port. Tried ports: ${tryPorts.join(', ')}`);
        }

        // Update the global CONFIG.PORT to reflect the actually used port
        CONFIG.PORT = selectedPort;
        
        return selectedPort;
    }

    // Copy all the other methods from the original class
    // [Previous methods remain the same: initializeKeyUsage, getNextAvailableKey, etc.]
    
    initializeKeyUsage() {
        const validKeys = this.apiKeys.filter(key => {
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
                 process.exit(1);
        }
        
        this.apiKeys = validKeys;
        
        this.apiKeys.forEach((key, index) => {
            this.keyUsage[key] = {
                requestsToday: 0,
                lastRequestTime: 0,
                dailyResetTime: this.getNextMidnight(),
                userAgent: this.userAgents[index % this.userAgents.length] || 'Enhanced-Bitmap-Tracker/2.0',
                headerRotation: index % 3
            };
        });
          console.log(`🔑 Loaded ${this.apiKeys.length} API key${this.apiKeys.length > 1 ? 's' : ''}`);
        console.log(`📈 Daily capacity: ${this.apiKeys.length * CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY} requests/day`);
    }

    getNextAvailableKey() {
        const now = Date.now();
        
        for (let i = 0; i < this.apiKeys.length; i++) {
            const keyIndex = (this.currentKeyIndex + i) % this.apiKeys.length;
            const key = this.apiKeys[keyIndex];
            const usage = this.keyUsage[key];
            
            if (now >= usage.dailyResetTime) {
                usage.requestsToday = 0;
                usage.dailyResetTime = this.getNextMidnight();
                console.log(`🔄 Daily limit reset for API key ${keyIndex + 1}`);
            }
            
            const canUseKey = usage.requestsToday < (CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY - CONFIG.DAILY_LIMIT_BUFFER);
            const rateLimitOk = (now - usage.lastRequestTime) >= CONFIG.REQUEST_INTERVAL;
            
            if (canUseKey && rateLimitOk) {
                this.currentKeyIndex = (keyIndex + 1) % this.apiKeys.length;
                return { key, userAgent: usage.userAgent, keyIndex };
            }
        }
        
        return null;
    }

    getRequestHeaders(keyInfo, usage) {
        const headers = {
            'Accept': 'application/json',
            'Api-Key': keyInfo.key,
            'User-Agent': keyInfo.userAgent
        };
        
        if (CONFIG.ROTATE_REQUEST_HEADERS) {
            const rotationHeaders = [
                { 'Accept-Language': 'en-US,en;q=0.9' },
                { 'Accept-Language': 'en-GB,en;q=0.8' },
                { 'Accept-Language': 'en-CA,en;q=0.7' }
            ];
            
            Object.assign(headers, rotationHeaders[usage.headerRotation]);
            
            if (Math.random() > 0.5) {
                headers['Accept-Encoding'] = 'gzip, deflate, br';
            }
        }
        
        return headers;
    }    // [Continue with all other methods from the original class...]
    // For brevity, I'm showing the key new methods. The complete implementation
    // would include all methods from the original BitmapTracker class.
    
    loadProcessedBlocks() {
        this.processedBlocks = new Set();
        try {
            const csvContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
            const lines = csvContent.split('\n');
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line) {
                    const parts = line.split(',');
                    const blockNumber = parseInt(parts[0]);
                    if (!isNaN(blockNumber)) {
                        this.processedBlocks.add(blockNumber);
                    }
                }
            }
            
            console.log(`📊 Loaded ${this.processedBlocks.size} processed blocks from 3-column CSV`);
        } catch (error) {
            this.logError('SYSTEM', 0, `Failed to load processed blocks: ${error.message}`);
            this.processedBlocks = new Set();
        }    }

    // Include all other original methods here...
    
    getNextMidnight() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow.getTime();
    }
    
    async fetchBitmapData(blockNumber) {
        // Check real-time usage first
        const keyInfo = await this.getNextAvailableKeyWithFallback();
        if (!keyInfo) {
            throw new Error('Rate limit exceeded - all API keys exhausted');
        }

        // Check real-time usage to avoid hitting limits
        const usageInfo = await this.checkRealTimeUsage(keyInfo.key);
        if (usageInfo && usageInfo.requestsLeft <= 5) {
            console.log(`⏸️ API Key has only ${usageInfo.requestsLeft} requests left - switching or waiting`);
            throw new Error('Rate limit exceeded - API response');
        }
        
        await this.waitForRateLimit();
        
        return new Promise((resolve, reject) => {
            const url = `${CONFIG.GENIIDATA_API_URL}${blockNumber}`;
            const usage = this.keyUsage[keyInfo.key];
            const proxy = this.getNextProxy();
            
            let options = {
                headers: this.getRequestHeaders(keyInfo, usage),
                timeout: 15000
            };

            // Add proxy configuration if available
            if (proxy) {
                const proxyUrl = new URL(proxy);
                options.agent = new (require('https').Agent)({
                    proxy: {
                        protocol: proxyUrl.protocol,
                        host: proxyUrl.hostname,
                        port: proxyUrl.port
                    }
                });
                console.log(`🔄 Using proxy: ${proxy} for block ${blockNumber}`);
            }

            const req = https.get(url, options, (res) => {
                const now = Date.now();
                usage.lastRequestTime = now;
                usage.requestsToday++;
                this.lastRequestTime = now;
                this.requestsToday++;
                
                // Enhanced rate limit detection for HTTP status codes
                if (res.statusCode === 429) {
                    if (proxy) {
                        this.markProxyFailed(proxy);
                        console.log(`🔄 Rate limit hit with proxy ${proxy} - will try next proxy`);
                    }
                    reject(new Error('Rate limit exceeded - HTTP 429'));
                    return;
                } else if (res.statusCode === 403) {
                    if (proxy) {
                        this.markProxyFailed(proxy);
                        console.log(`🔄 Forbidden with proxy ${proxy} - will try next proxy`);
                    }
                    reject(new Error('Rate limit exceeded - HTTP 403 (Forbidden)'));
                    return;
                } else if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }
                
                const contentType = res.headers['content-type'];
                if (!contentType || !contentType.includes('application/json')) {
                    reject(new Error(`Invalid content type: ${contentType || 'unknown'}`));
                    return;
                }
                
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
                stream.on('data', chunk => data += chunk.toString('utf8'));
                stream.on('end', () => {
                    if (!data || data.trim().length === 0) {
                        reject(new Error('Empty response received'));
                        return;
                    }
                    
                    try {
                        const jsonData = JSON.parse(data);
                        
                        if (typeof jsonData !== 'object' || jsonData === null) {
                            reject(new Error('Invalid JSON structure'));
                            return;
                        }
                        
                        // Enhanced rate limit detection for API response codes
                        if (jsonData.code === 429 || 
                            jsonData.code === 1003 || 
                            (jsonData.message && jsonData.message.toLowerCase().includes('rate limit')) ||
                            (jsonData.message && jsonData.message.toLowerCase().includes('too many requests')) ||
                            (jsonData.message && jsonData.message.toLowerCase().includes('quota exceeded')) ||
                            (jsonData.error && jsonData.error.toLowerCase().includes('rate limit'))) {
                            
                            if (proxy) {
                                console.log(`🔄 Rate limit detected with proxy ${proxy} - rotating to next proxy`);
                                // Don't mark as failed immediately for rate limits, just rotate
                            }
                            reject(new Error('Rate limit exceeded - API response'));
                            return;
                        }
                        
                        if (jsonData.code === 0 && jsonData.data && jsonData.data.length > 0) {
                            resolve(jsonData.data[0].inscription_id);
                        } else if (jsonData.code === 1001) {
                            reject(new Error(`Invalid API key (Key ${keyInfo.keyIndex + 1})`));
                        } else if (jsonData.code === 0 && (!jsonData.data || jsonData.data.length === 0)) {
                            // This is a legitimate "no bitmap found" response
                            resolve(null);
                        } else {
                            // Log unexpected response structure for debugging
                            console.log(`🔍 Unexpected API response for block ${blockNumber}:`, jsonData);
                            resolve(null);
                        }
                    } catch (error) {
                        reject(new Error(`JSON Parse Error: ${error.message}`));
                    }
                });
                
                stream.on('error', (error) => {
                    reject(new Error(`Decompression Error: ${error.message}`));
                });
            });

            req.on('error', (error) => {
                if (proxy) {
                    this.markProxyFailed(proxy);
                }
                reject(new Error(`Request Error: ${error.message}`));
            });
            
            req.setTimeout(15000, () => {
                req.destroy();
                if (proxy) {
                    this.markProxyFailed(proxy);
                }
                reject(new Error('Request timeout (15s)'));
            });
        });
    }

    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const waitTime = CONFIG.REQUEST_INTERVAL - timeSinceLastRequest;
        
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    async getNextAvailableKeyWithFallback() {
        return this.getNextAvailableKey();
    }

    logError(level, blockNumber, message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level}] [Block ${blockNumber}] ${message}\n`;
        
        try {
            fs.appendFileSync('error.log', logEntry);
        } catch (err) {
            console.error('Failed to write to error log:', err.message);
        }
        
        console.error(`❌ ${level}: Block ${blockNumber} - ${message}`);
    }

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

    saveBackfillProgress() {
        try {
            fs.writeFileSync(CONFIG.PROGRESS_FILE, JSON.stringify(this.backfillProgress, null, 2));
        } catch (error) {
            console.error('❌ Could not save backfill progress:', error.message);
        }
    }

    async initializeQueues() {
        try {
            const currentBlock = await this.getCurrentBlockHeight();
            this.currentBlock = currentBlock;
            console.log(`📊 Current block height: ${currentBlock}`);
            this.queueHistoricalBlocks();
        } catch (error) {
            console.error('❌ Could not get current block height:', error.message);
        }
    }

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
    }

    queueHistoricalBlocks() {
        const startBlock = this.backfillProgress.lastProcessedBlock + 1;
        const endBlock = Math.min(startBlock + 1000, this.currentBlock);
        
        console.log(`📚 Analyzing blocks ${startBlock} to ${endBlock} for gaps...`);
        this.detectAndQueueGaps();
        
        const newBlocks = [];
        for (let block = startBlock; block <= endBlock; block++) {
            if (!this.processedBlocks.has(block)) {
                newBlocks.push(block);
            }
        }
        
        this.backfillQueue.push(...newBlocks);
        this.backfillQueue.sort((a, b) => a - b);
        
        console.log(`📋 Backfill queue: ${this.backfillQueue.length} blocks`);
    }

    detectAndQueueGaps() {
        const gapsFound = [];
        
        for (let block = CONFIG.HISTORICAL_START_BLOCK; block <= this.backfillProgress.lastProcessedBlock; block++) {
            if (!this.processedBlocks.has(block)) {
                gapsFound.push(block);
            }
        }
        
        gapsFound.sort((a, b) => a - b);
        
        for (let i = gapsFound.length - 1; i >= 0; i--) {
            this.backfillQueue.unshift(gapsFound[i]);
        }
        
        if (gapsFound.length > 0) {
            console.log(`🔍 Found ${gapsFound.length} gaps to backfill`);
        }
    }

    async processBlock(blockNumber, isPriority = false) {
        const prefix = isPriority ? '🔥' : '📚';
        
        if (this.processedBlocks.has(blockNumber)) {
            console.log(`⏭️ ${prefix} Block ${blockNumber}: already processed`);
            return true;
        }
        
        let retries = 0;
        while (retries < CONFIG.MAX_RETRIES) {
            try {
                if (!this.canMakeRequest()) {
                    const totalDailyLimit = CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length;
                    if (this.requestsToday >= totalDailyLimit) {
                        console.log(`⏸️ All API keys exhausted (${totalDailyLimit} total requests)`);
                        return false;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_INTERVAL));
                    continue;
                }
                
                const inscriptionId = await this.fetchBitmapData(blockNumber);
                await this.writeToCSV(blockNumber, inscriptionId);
                
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
                const backoffDelay = Math.min(CONFIG.RETRY_DELAY * Math.pow(2, retries - 1), 30000);
                
                // Enhanced rate limit handling
                if (error.message.includes('Rate limit exceeded')) {
                    console.log(`⏸️ ${prefix} Block ${blockNumber}: Rate limit hit - waiting 5 minutes`);
                    await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
                    retries--; // Don't count rate limit errors as retry attempts
                    continue;
                } else if (error.message.includes('HTTP 429') || error.message.includes('HTTP 403')) {
                    console.log(`⏸️ ${prefix} Block ${blockNumber}: Rate limit (${error.message}) - waiting 10 minutes`);
                    await new Promise(resolve => setTimeout(resolve, 600000)); // 10 minutes
                    retries--; // Don't count rate limit errors as retry attempts
                    continue;
                } else if (error.message.includes('Invalid API key')) {
                    this.logError('API_KEY_ERROR', blockNumber, error.message);
                    return true; // Skip this block due to API key issue
                } else {
                    this.logError('FETCH_ERROR', blockNumber, `${error.message} - attempt ${retries}/${CONFIG.MAX_RETRIES}`);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                }
                
                if (retries >= CONFIG.MAX_RETRIES) {
                    this.logError('FAILED', blockNumber, `Failed after ${CONFIG.MAX_RETRIES} attempts`);
                    return true;
                }
            }
        }
        
        return true;
    }

    canMakeRequest() {
        return this.getNextAvailableKey() !== null;
    }

    async sortCSVFile() {
        try {
            console.log('🔄 Sorting CSV to maintain sequential order...');
            
            const csvFile = CONFIG.CSV_FILE;
            if (!fs.existsSync(csvFile)) return;

            const content = fs.readFileSync(csvFile, 'utf8');
            const lines = content.split('\n');
            
            if (lines.length < 3) return;

            const header = lines[0];
            const dataLines = lines.slice(1).filter(line => line.trim() !== '');
            
            const parsedData = dataLines.map(line => {
                const parts = line.split(',');
                return {
                    blockNumber: parseInt(parts[0]),
                    line: line
                };
            }).filter(entry => !isNaN(entry.blockNumber));

            parsedData.sort((a, b) => a.blockNumber - b.blockNumber);

            const uniqueData = [];
            const seenBlocks = new Set();
            
            for (const entry of parsedData) {
                if (!seenBlocks.has(entry.blockNumber)) {
                    uniqueData.push(entry.line);
                    seenBlocks.add(entry.blockNumber);
                }
            }

            const sortedLines = [header, ...uniqueData];
            fs.writeFileSync(csvFile, sortedLines.join('\n') + '\n');
            
            console.log(`📊 CSV sorted: ${uniqueData.length} entries in sequential order`);
            
        } catch (error) {
            this.logError('CSV_SORT', 0, `Failed to sort CSV: ${error.message}`);
        }
    }

    validateCSVOrder() {
        try {
            const csvFile = CONFIG.CSV_FILE;
            if (!fs.existsSync(csvFile)) return true;

            const content = fs.readFileSync(csvFile, 'utf8');
            const lines = content.split('\n').slice(1).filter(line => line.trim() !== '');
            
            if (lines.length <= 1) return true;
            
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

            return true;
        } catch (error) {
            this.logError('CSV_VALIDATION', 0, `Failed to validate CSV order: ${error.message}`);
            return false;
        }
    }

    async autoCommitToGit(blockNumber, inscriptionId) {
        if (!CONFIG.AUTO_COMMIT_CSV) return;

        try {
            execSync('git add bitmap_data.csv', { cwd: process.cwd(), stdio: 'pipe' });
            
            const commitMessage = CONFIG.GIT_COMMIT_MESSAGE.replace('{blockNumber}', blockNumber);
            const hasChanges = execSync('git diff --cached --quiet || echo "changes"', { 
                cwd: process.cwd(), 
                stdio: 'pipe' 
            }).toString().trim();
            
            if (hasChanges === 'changes') {
                execSync(`git commit -m "${commitMessage}"`, { 
                    cwd: process.cwd(), 
                    stdio: 'pipe' 
                });
                
                console.log(`📤 ✅ Git commit: Block ${blockNumber}`);
                
                if (CONFIG.GIT_PUSH_TO_REMOTE) {
                    try {
                        execSync(`git push origin ${CONFIG.GIT_BRANCH}`, { 
                            cwd: process.cwd(), 
                            stdio: 'pipe',
                            timeout: 10000
                        });
                        console.log(`📤 🌐 Pushed to remote: Block ${blockNumber}`);
                    } catch (pushError) {
                        console.log(`⚠️ Git push failed: ${pushError.message.substring(0, 100)}...`);
                    }
                }
            }
            
        } catch (error) {
            console.log(`⚠️ Git auto-commit failed: ${error.message.substring(0, 100)}...`);
        }
    }
    
    async startProcessing() {
        if (this.processing) return;
        this.processing = true;
        
        console.log('🔄 Starting optimized processing loop...');
        this.displayRateLimitStatus();
        
        while (true) {
            try {
                const currentUsage = this.getTotalDailyUsage();
                const dailyLimit = CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length;
                
                if (currentUsage >= dailyLimit - CONFIG.DAILY_LIMIT_BUFFER) {
                    console.log(`⏸️ Approaching daily limit: ${currentUsage}/${dailyLimit} requests`);
                    await new Promise(resolve => setTimeout(resolve, 3600000));
                    continue;
                }
                
                const pauseInfo = this.shouldPauseForRateLimit();
                if (pauseInfo.shouldPause) {
                    console.log(pauseInfo.message);
                    await new Promise(resolve => setTimeout(resolve, pauseInfo.waitTime));
                    continue;
                }
                
                if (this.priorityQueue.length > 0) {
                    const blockNumber = this.priorityQueue.shift();
                    await this.processBlock(blockNumber, true);
                    continue;
                }
                
                if (this.backfillQueue.length > 0) {
                    const blockNumber = this.backfillQueue.shift();
                    const success = await this.processBlock(blockNumber, false);
                    
                    if (success) {
                        this.backfillProgress.lastProcessedBlock = blockNumber;
                        this.backfillProgress.totalProcessed++;
                        
                        if (this.backfillQueue.length < 100) {
                            this.queueHistoricalBlocks();
                        }
                    } else {
                        this.backfillQueue.unshift(blockNumber);
                        await new Promise(resolve => setTimeout(resolve, 30000));
                    }
                    continue;
                }
                
                if (this.backfillProgress.lastProcessedBlock < this.currentBlock - 1000) {
                    this.queueHistoricalBlocks();
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error('❌ Processing loop error:', error.message);
                this.logError('PROCESSING_LOOP', 0, `Processing error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    
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
    
    reconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            console.log(`🔄 Reconnecting WebSocket in ${delay/1000}s`);
            
            setTimeout(() => this.connectWebSocket(), delay);
        } else {
            console.error('❌ Max reconnection attempts reached');
            this.logError('WEBSOCKET', 0, 'Max reconnection attempts reached');
        }
    }

    getTotalDailyUsage() {
        return Object.values(this.keyUsage).reduce((total, usage) => total + usage.requestsToday, 0);
    }

    // Check if we should pause due to likely rate limit situation
    shouldPauseForRateLimit() {
        const now = Date.now();
        const currentUsage = this.getTotalDailyUsage();
        const dailyLimit = CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length;
        
        // If we're close to daily limit, pause
        if (currentUsage >= dailyLimit * 0.95) {
            return {
                shouldPause: true,
                reason: 'Approaching daily limit',
                waitTime: 3600000, // 1 hour
                message: `⏸️ Approaching daily limit: ${currentUsage}/${dailyLimit} requests - pausing for 1 hour`
            };
        }
        
        // If we're using requests too quickly (safety buffer)
        const requestsInLastHour = this.getRequestsInLastHour();
        const hourlyRateLimit = CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY / 24 * this.apiKeys.length;
        
        if (requestsInLastHour >= hourlyRateLimit * 0.9) {
            return {
                shouldPause: true,
                reason: 'High hourly usage rate',
                waitTime: 1800000, // 30 minutes
                message: `⏸️ High usage rate: ${requestsInLastHour} requests in last hour - pausing for 30 minutes`
            };
        }
        
        return { shouldPause: false };
    }
    
    // Get requests made in the last hour
    getRequestsInLastHour() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        let requestsInLastHour = 0;
        
        for (const key of this.apiKeys) {
            const usage = this.keyUsage[key];
            if (usage.lastRequestTime >= oneHourAgo) {
                // Estimate based on current daily usage (rough approximation)
                requestsInLastHour += Math.min(usage.requestsToday, usage.requestsToday / 24);
            }
        }
        
        return requestsInLastHour;
    }

    printStatus() {
        const totalBlocks = this.currentBlock - CONFIG.HISTORICAL_START_BLOCK;
        const processedBlocks = this.backfillProgress.totalProcessed;
        const percentage = totalBlocks > 0 ? ((processedBlocks / totalBlocks) * 100).toFixed(1) : 0;
          console.log(`\n📊 STATUS: ${processedBlocks}/${totalBlocks} (${percentage}%) | Queue: ${this.priorityQueue.length}+${this.backfillQueue.length} | Requests: ${this.requestsToday}/${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length}`);
    }

    // Display current rate limit status
    displayRateLimitStatus() {
        const currentUsage = this.getTotalDailyUsage();
        const dailyLimit = CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * this.apiKeys.length;
        const percentage = (currentUsage / dailyLimit * 100).toFixed(1);
        
        console.log(`\n📊 RATE LIMIT STATUS`);
        console.log(`─────────────────────────────────────`);
        console.log(`🔑 API Keys: ${this.apiKeys.length}`);
        console.log(`📈 Daily Usage: ${currentUsage}/${dailyLimit} (${percentage}%)`);
        console.log(`⏰ Next Reset: ${new Date(this.dailyResetTime).toLocaleString()}`);
        
        // Show per-key usage
        this.apiKeys.forEach((key, index) => {
            const usage = this.keyUsage[key];
            const keyPercentage = (usage.requestsToday / CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY * 100).toFixed(1);
            console.log(`   Key ${index + 1}: ${usage.requestsToday}/${CONFIG.MAX_REQUESTS_PER_DAY_PER_KEY} (${keyPercentage}%)`);
        });
        
        if (currentUsage >= dailyLimit * 0.9) {
            console.log(`⚠️ WARNING: Approaching daily limit!`);
        }
        
        console.log(`─────────────────────────────────────\n`);
    }

    // Check real-time API key usage from GeniiData
    async checkRealTimeUsage(apiKey) {
        return new Promise((resolve, reject) => {
            const url = 'https://api.geniidata.com/api/1/key/info';
            const options = {
                headers: {
                    'Accept': 'application/json',
                    'Api-Key': apiKey,
                    'User-Agent': 'Enhanced-Bitmap-Tracker/2.0'
                },
                timeout: 10000
            };

            const req = https.get(url, options, (res) => {
                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        if (jsonData.code === 0 && jsonData.data && jsonData.data.usage) {
                            resolve({
                                plan: jsonData.data.plan,
                                planStatus: jsonData.data.plan_status,
                                requestsMade: jsonData.data.usage.current_day.requests_made,
                                requestsLeft: jsonData.data.usage.current_day.requests_left
                            });
                        } else {
                            resolve(null);
                        }
                    } catch (error) {
                        resolve(null);
                    }
                });
            });

            req.on('error', () => resolve(null));
            req.setTimeout(10000, () => {
                req.destroy();
                resolve(null);
            });
        });
    }

    // Get next available proxy
    getNextProxy() {
        if (!this.useProxy || this.proxyList.length === 0) {
            return null;
        }

        // Find a working proxy
        for (let i = 0; i < this.proxyList.length; i++) {
            const proxyIndex = (this.currentProxyIndex + i) % this.proxyList.length;
            const proxy = this.proxyList[proxyIndex];
            
            const failures = this.proxyFailures.get(proxy) || 0;
            if (failures < 3) { // Allow up to 3 failures before blacklisting
                this.currentProxyIndex = (proxyIndex + 1) % this.proxyList.length;
                return proxy;
            }
        }

        return null; // All proxies failed
    }

    // Mark proxy as failed
    markProxyFailed(proxy) {
        if (proxy) {
            const failures = this.proxyFailures.get(proxy) || 0;
            this.proxyFailures.set(proxy, failures + 1);
            console.log(`⚠️ Proxy ${proxy} failed (${failures + 1}/3 failures)`);
        }
    }

    // Reset proxy failures (call periodically)
    resetProxyFailures() {
        this.proxyFailures.clear();
        console.log('🔄 Proxy failure counters reset');
    }
}

// Main execution
if (require.main === module) {
    console.log('📈 Enhanced Bitmap Block Tracker v3.0 - API Edition');
    console.log('═══════════════════════════════════════════════════════════');
    
    if (CONFIG.API_KEYS.includes('142cf1b0-1ca7-11ee-bb5e-9d74c2e854ac')) {
        console.log('⚠️  WARNING: Using default API key from documentation.');
         }

    const tracker = new EnhancedBitmapTracker();
    tracker.start();
}

module.exports = EnhancedBitmapTracker;
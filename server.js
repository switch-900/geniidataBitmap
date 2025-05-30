#!/usr/bin/env node
/**
 * Bitcoin Bitmap Tracker API Server
 * Production entry point for the Enhanced Bitmap Tracker
 * 
 * This server provides both REST API endpoints and static file serving
 * for the Bitcoin Bitmap Tracker application.
 * 
 * Features:
 * - REST API for bitmap data access
 * - Real-time WebSocket integration with mempool.space
 * - CSV data management with auto-commit
 * - Multi-API key support for rate limiting
 * - Cross-origin resource sharing (CORS) enabled
 * 
 * Usage:
 *   npm start         - Start the server
 *   npm run dev       - Start with nodemon for development
 *   node server.js    - Direct node execution
 * 
 * Environment Variables:
 *   PORT                    - Server port (default: 3000)
 *   HOST                    - Server host (default: 0.0.0.0)
 *   GENIIDATA_API_KEYS      - Comma-separated API keys
 *   HISTORICAL_START_BLOCK  - Starting block for historical data
 *   
 * API Endpoints:
 *   GET /api/block/:blockNumber  - Get specific block data
 *   GET /api/blocks              - Get all blocks with pagination
 *   GET /api/stats               - Get tracker statistics
 *   GET /api/latest              - Get latest blocks with bitmaps
 *   GET /api/search/:query       - Search blocks by inscription ID or sat
 *   GET /:blockNumber            - Direct block access (GitHub Pages style)
 *   GET /health                  - Health check endpoint
 */

const EnhancedBitmapTracker = require('./script.js');

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

async function startServer() {
    try {
        console.log('🚀 Initializing Bitcoin Bitmap Tracker API Server...');
        console.log(`📅 Started at: ${new Date().toISOString()}`);
        console.log(`🔧 Node.js version: ${process.version}`);
        console.log(`📂 Working directory: ${process.cwd()}`);
        
        // Create and start the tracker
        const tracker = new EnhancedBitmapTracker();
        await tracker.start();
        
        console.log('✅ Server initialization complete!');
        console.log('🌐 API Server is ready to accept requests');
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Start the server
startServer();
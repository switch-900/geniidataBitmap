# Bitcoin Bitmap Tracker API

A high-performance Bitcoin block bitmap data tracker with both **static web interface** and **dynamic API server** capabilities. Optimized for GeniiData's free tier API with intelligent sequential processing and gap detection.

## 🚀 Deployment Modes

### 1. Static Web Interface (GitHub Pages)
- **Client-side API detection** in `index.html`
- **JSON responses** for programmatic access
- **Zero server costs** - perfect for GitHub Pages
- **CSV data integration** with OCI (On-Chain Index) fallback

### 2. Dynamic API Server (Express.js)
- **Full REST API** with Express.js
- **Real-time WebSocket** integration with mempool.space
- **Enhanced CSV format** with ordinals.com data
- **Auto-commit and backup** functionality

## ✨ Features

- **Dual API Architecture**: Both static (GitHub Pages) and dynamic (Express.js) API support
- **Sequential Block Processing**: Maintains chronological order (blocks 840000+)
- **Intelligent Gap Detection**: Automatically identifies and queues missing blocks
- **Enhanced CSV Format**: Includes sat numbers, addresses, fees, and timestamps
- **Multi-API Key Support**: Load balancing across multiple GeniiData API keys
- **Real-time Integration**: WebSocket connection to mempool.space for new blocks
- **CORS Enabled**: Cross-origin requests supported for web applications
- **Auto-commit**: Git integration with automatic data commits
- **Free Tier Optimized**: Efficient quota usage for GeniiData API limits

## 🏁 Quick Start

### Option 1: Static Deployment (GitHub Pages)

1. **Fork and Enable GitHub Pages**:
   ```bash
   # Fork the repository on GitHub
   # Go to Settings > Pages > Source: Deploy from branch (main)
   ```

2. **Access the API**:
   ```bash
   # Web Interface
   https://yourusername.github.io/geniidataBitmap/
   
   # API Endpoints
   https://yourusername.github.io/geniidataBitmap/177700
   https://yourusername.github.io/geniidataBitmap/?block=177700&format=json
   ```

### Option 2: Dynamic Server Deployment

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run Locally**:
   ```bash
   npm start        # Production mode
   npm run dev      # Development mode
   npm run server   # Use server.js entry point
   ```

4. **Deploy to Cloud**:
   - Use the `Procfile` for Heroku deployment
   - Set environment variables on your hosting platform
   - Push to GitHub and connect to your cloud provider

## 📊 API Endpoints

### REST API (Express.js Server)
- `GET /api/block/:blockNumber` - Get specific block data
- `GET /api/blocks?page=1&limit=50` - Get all blocks with pagination  
- `GET /api/stats` - Get tracker statistics
- `GET /api/latest?limit=10` - Get latest blocks with bitmaps
- `GET /api/search/:query` - Search blocks by inscription ID or sat number
- `GET /health` - Health check endpoint

### GitHub Pages Compatible API
- `GET /:blockNumber` - Direct block lookup (e.g., `/177700`)
- `GET /?block=:blockNumber&format=json` - Query parameter format
- `GET /?search=:query&format=json` - Search functionality
- `GET /?format=json` - API documentation

## 📁 File Structure

```
├── script.js                    # Enhanced server with API endpoints
├── server.js                    # Production entry point
├── index.html                   # Web interface with client-side API
├── bitmap_data.csv             # Enhanced CSV with ordinals data
├── backfill_progress.json      # Progress tracking
├── package.json                # Dependencies and scripts
├── Procfile                    # Heroku deployment config
├── README.md                   # Main documentation
├── fetch-proxies.js            # Proxy fetching utility
├── .env.example                # Environment configuration template
└── public/                     # Static files for Express server
    ├── index.html              # Copy for static serving
    ├── test-api.html           # API testing interface
    └── API.md                  # API documentation
```

## 🌐 Data Sources Integration

### Historical Data (Blocks 0-839,999)
- **OCI (On-Chain Index)** from ordinals.com  
- Real-time lookup via JavaScript module import
- Cached in browser sessionStorage for performance

### Recent Data (Blocks 840,000+)
- **GeniiData API** with multi-key load balancing
- **CSV storage** with enhanced format including:
  - Block number and inscription ID
  - Sat numbers and addresses  
  - Transaction values and fees
  - Timestamps for tracking

### Real-time Updates
- **WebSocket integration** with mempool.space
- Automatic detection of new blocks
- Priority queue for immediate processing

## Web Search Interface

The repository includes a modern web interface (`index.html`) for searching Bitcoin bitmap data:

### Features
- **🔍 Dual Search**: Search by block number or inscription ID
- **📱 Responsive Design**: Works on desktop and mobile devices
- **📊 Live Statistics**: Shows total bitmaps, block range, and last update
- **🔗 External Links**: Direct links to Ordinals.com and Mempool.space
- **📋 Copy Functions**: One-click copy for block numbers and inscription IDs
- **⌨️ Keyboard Shortcuts**: Ctrl+K to focus search, Escape to clear

### GitHub Pages Deployment
1. **Enable GitHub Pages** in repository settings
2. **Set source** to "Deploy from a branch" → `main` branch → `/ (root)`
3. **Access** your search interface at: `https://switch-900.github.io/geniidataBitmap`

### Local Testing
```bash
# Open the HTML file directly in a browser
open index.html
# Or serve with a simple HTTP server
python -m http.server 8000
# Then visit: http://localhost:8000
```

The web interface automatically loads the CSV data and provides:
- Real-time search functionality
- Statistics about the dataset
- Professional UI with smooth animations
- Mobile-responsive design
- Copy-to-clipboard functionality

## Current Status

- **Blocks Processed**: 477+ blocks (840000-840476+)
- **Data Quality**: Sequential ordering maintained
- **API Efficiency**: 100% success rate, optimized compression handling
- **Gap Management**: Automatic detection and sequential backfilling

## CSV Data Format

The output CSV contains Bitcoin block bitmap data with the following optimized structure:
- **Essential data only**: `block_number,inscription_id`
- Block numbers in sequential order
- Automatic duplicate removal and gap detection
- **Dynamic sat number fetching**: Additional data (sat numbers, addresses, values, fees) fetched on-demand from ordinals API when needed

### API Endpoints

#### Get Block Data
- `GET /api/block/:blockNumber` - Get essential block data from CSV
- `GET /api/block/:blockNumber?sat=true` - Get block data with sat numbers dynamically fetched from ordinals API

#### Other Endpoints
- `GET /api/blocks` - Get all blocks with pagination
- `GET /api/latest` - Get latest blocks with bitmaps
- `GET /api/search/:query` - Search blocks by inscription ID
- `GET /api/stats` - Get tracker statistics

## Utilities

### CSV Sorter
Run the standalone CSV sorting utility:
```bash
node csv_sorter.js
```

This tool can:
- Sort CSV files by block number
- Remove duplicates
- Detect and report gaps
- Validate sequential ordering

## Monitoring

The application provides real-time monitoring through:
- Console output with progress indicators
- `output.log` for runtime information
- `error.log` for error tracking (should be empty in production)
- `backfill_progress.json` for gap filling progress

## API Optimization

The tracker includes several optimizations for GeniiData's free tier:
- **Compression Handling**: Automatic gzip/deflate/brotli decompression
- **Error Recovery**: Intelligent retry logic with exponential backoff
- **Quota Management**: Efficient request usage tracking
- **False Positive Prevention**: Optimized corruption detection

## Architecture

The system uses a sophisticated gap detection and sequential processing approach:

1. **Primary Loop**: Processes latest blocks sequentially
2. **Gap Detection**: Identifies missing blocks in the range
3. **Backfill Queue**: Maintains sorted queue of missing blocks
4. **CSV Management**: Periodic sorting and validation
5. **Progress Tracking**: JSON-based state persistence

Built for reliability and efficiency with GeniiData's Bitcoin API.

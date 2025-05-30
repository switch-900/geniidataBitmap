# Bitcoin Bitmap Tracker

A high-performance Bitcoin block bitmap data tracker optimized for GeniiData's free tier API with intelligent sequential processing and gap detection.

## Features

- **Sequential Block Processing**: Maintains chronological order (blocks 840000+)
- **Intelligent Gap Detection**: Automatically identifies and queues missing blocks
- **CSV Auto-Sorting**: Ensures data integrity with periodic sorting
- **API Optimization**: Handles compression, retries, and error recovery
- **Free Tier Optimized**: Efficient quota usage (~5% daily on 1000 requests/day)
- **Progress Tracking**: JSON-based backfill progress monitoring
- **Web Search Interface**: HTML interface for searching bitmap data
- **GitHub Pages Ready**: Deploy-ready web interface for public access

## Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   - Copy `.env.example` to `.env`
   - Add your GeniiData API key:
     ```
     GENIIDA_API_KEY=your_api_key_here
     ```

3. **Run the Tracker**:
   ```bash
   node script.js
   ```

## File Structure

```
├── script.js              # Main application
├── csv_sorter.js          # Standalone CSV sorting utility
├── bitmap_data.csv        # Output data (sequential block order)
├── backfill_progress.json # Progress tracking
├── index.html             # Web search interface for GitHub Pages
├── error.log              # Error logging
├── output.log             # Runtime logging
└── archive/               # Archived files (tests, docs, old versions)
```

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
3. **Access** your search interface at: `https://yourusername.github.io/repositoryname`

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

The output CSV contains Bitcoin block bitmap data with the following structure:
- Block numbers in sequential order
- Bitmap hash data for each block
- Automatic duplicate removal and gap detection

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

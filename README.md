# Bitcoin Bitmap Tracker

A high-performance Bitcoin block bitmap data tracker optimized for GeniiData's free tier API with intelligent sequential processing and gap detection.

## Features

- **Sequential Block Processing**: Maintains chronological order (blocks 840000+)
- **Intelligent Gap Detection**: Automatically identifies and queues missing blocks
- **CSV Auto-Sorting**: Ensures data integrity with periodic sorting
- **API Optimization**: Handles compression, retries, and error recovery
- **Free Tier Optimized**: Efficient quota usage (~5% daily on 1000 requests/day)
- **Progress Tracking**: JSON-based backfill progress monitoring

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
├── error.log              # Error logging
├── output.log             # Runtime logging
└── archive/               # Archived files (tests, docs, old versions)
```

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

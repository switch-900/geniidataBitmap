# Bitcoin Bitmap Tracker API Documentation

The Bitcoin Bitmap Tracker has been enhanced to serve as a RESTful API endpoint while maintaining its web interface functionality.

## 🚀 Base URL
```
https://switch-900.github.io/geniidataBitmap/
```

## 📋 API Endpoints

### 1. Get Bitmap by Block Number

**Direct URL Pattern:**
```
GET /{blockNumber}
```

**Query Parameter Pattern:**
```
GET /?block={blockNumber}&format=json
```

**Examples:**
```bash
# Get bitmap for block 177700
curl https://switch-900.github.io/geniidataBitmap/177700

# Alternative format
curl "https://switch-900.github.io/geniidataBitmap/?block=177700&format=json"

# Legacy bitmap (OCI lookup)
curl https://switch-900.github.io/geniidataBitmap/500000
```

**Response (Success):**
```json
{
  "blockNumber": 177700,
  "inscriptionId": "abc123...",
  "dataSource": "CSV",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Response (OCI - Legacy Bitmap):**
```json
{
  "blockNumber": 500000,
  "inscriptionId": "def456...",
  "sat": 123456789,
  "dataSource": "OCI",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Response (Not Found):**
```json
{
  "error": "Block not found",
  "message": "No bitmap found for block 999999",
  "blockNumber": 999999,
  "availableRange": "0-839,999 (OCI), 840000-870000 (CSV)",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 2. Search Bitmaps

**Endpoint:**
```
GET /?search={query}&format=json
```

**Examples:**
```bash
# Search by block number
curl "https://switch-900.github.io/geniidataBitmap/?search=840000&format=json"

# Search by inscription ID (partial)
curl "https://switch-900.github.io/geniidataBitmap/?search=abc123&format=json"
```

**Response:**
```json
{
  "query": "840000",
  "resultsCount": 1,
  "results": [
    {
      "blockNumber": 840000,
      "inscriptionId": "abc123...",
      "dataSource": "CSV",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 3. API Documentation

**Endpoint:**
```
GET /?format=json
```

**Example:**
```bash
curl "https://switch-900.github.io/geniidataBitmap/?format=json"
```

Returns comprehensive API documentation in JSON format.

## 📊 Data Sources

### Legacy Bitmaps (0-839,999)
- **Source:** On-Chain Index (OCI) from ordinals.com
- **Method:** Real-time lookup via imported OCI module
- **Data:** Block number, inscription ID, sat number
- **Availability:** Real-time (dependent on ordinals.com)

### Recent Bitmaps (840,000+)
- **Source:** Local CSV data updated via GeniiData API
- **Method:** Pre-loaded CSV file
- **Data:** Block number, inscription ID
- **Update Frequency:** Automatically updated via background tracker

## 🔧 Technical Details

### CORS Support
All API endpoints include CORS headers allowing cross-origin requests from any domain.

### Rate Limiting
Currently no rate limiting is implemented. Use responsibly.

### Response Format
All responses are in JSON format with appropriate HTTP status codes:
- `200` - Success
- `404` - Block/data not found
- `500` - Internal server error

### Caching
- OCI lookups are cached in browser session storage
- CSV data is loaded once per session

## 💡 Integration Examples

### JavaScript (Browser)
```javascript
// Fetch bitmap data for block 177700
fetch('https://switch-900.github.io/geniidataBitmap/177700')
  .then(response => response.json())
  .then(data => {
    if (data.error) {
      console.error('Error:', data.message);
    } else {
      console.log('Bitmap found:', data.inscriptionId);
    }
  });
```

### Python
```python
import requests

# Get bitmap data
response = requests.get('https://switch-900.github.io/geniidataBitmap/177700')
data = response.json()

if 'error' in data:
    print(f"Error: {data['message']}")
else:
    print(f"Block {data['blockNumber']}: {data['inscriptionId']}")
```

### cURL
```bash
# Simple block lookup
curl -s https://switch-900.github.io/geniidataBitmap/177700 | jq '.'

# Search with formatting
curl -s "https://switch-900.github.io/geniidataBitmap/?search=840000&format=json" | jq '.results[]'
```

## 🌐 Web Interface

The API maintains full backward compatibility with the existing web interface. Accessing the base URL without API parameters will show the normal web interface:

```
https://switch-900.github.io/geniidataBitmap/
```

## 🔄 Migration from Web to API

Existing functionality remains unchanged. The API layer detects request patterns and responds accordingly:

- **Web Interface:** Normal browser access shows the HTML interface
- **API Access:** URLs with block numbers or `format=json` parameter return JSON
- **Hybrid:** Both can coexist on the same URL structure

## ⚠️ Important Notes

1. **GitHub Pages Limitation:** This is a client-side API implementation. True server-side features (custom headers, advanced caching) are limited.

2. **OCI Dependency:** Legacy bitmap lookups (0-839,999) depend on ordinals.com availability.

3. **Data Freshness:** CSV data freshness depends on the background tracker updating the repository.

4. **Browser Compatibility:** API functionality requires modern browser support for ES6+ features.

## 📧 Support

For API support or feature requests, please open an issue on the [GitHub repository](https://github.com/switch-900/geniidataBitmap).

# Bitcoin Bitmap Search Interface

This repository includes a web search interface for exploring Bitcoin bitmap data collected by the GeniiData tracker.

## 🌐 Live Demo

Visit the search interface at: **[Your GitHub Pages URL]**

## 🔍 Search Capabilities

- **Block Number Search**: Find bitmap inscription for any block (e.g., 840000)
- **Inscription ID Search**: Find block number for any inscription ID
- **Partial Matching**: Works with partial inscription IDs
- **Case Insensitive**: Search is not case sensitive

## 📊 Features

- **Live Statistics**: Real-time data about total bitmaps and block range
- **External Links**: Direct access to Ordinals.com and Mempool.space
- **Copy Functions**: One-click copy for all data fields
- **Mobile Responsive**: Works perfectly on all device sizes
- **Keyboard Shortcuts**: 
  - `Ctrl+K` (or `Cmd+K`) to focus search
  - `Escape` to clear search

## 🚀 Data Updates

The search interface automatically loads data from `bitmap_data.csv`, which is:
- ✅ Automatically updated by the Bitcoin bitmap tracker
- ✅ Committed to Git after each new bitmap discovery
- ✅ Always up-to-date with the latest blockchain data
- ✅ Maintained in perfect sequential order

## 🛠 For Developers

### Local Development
```bash
# Clone the repository
git clone https://github.com/switch-900/geniidataBitmap.git

# Open the HTML file directly
open index.html

# Or serve with Python
python -m http.server 8000
```

### Data Format
The interface reads CSV data with the following structure:
```csv
block_number,inscription_id
840000,05f8584cf4dbe34ef677f8f316fcac9e6e4ccb0e298d53fd21edaac7787660eei0
840001,24bf555b0423c3cc3ba3eb4f76b8b48494724342dff8be0be4dccc7945a5f76ei0
```

### GitHub Pages Setup
1. Go to repository Settings → Pages
2. Set source to "Deploy from a branch"
3. Select `main` branch and `/ (root)` folder
4. Your interface will be available at `https://yourusername.github.io/repositoryname`

---

**🔗 Links:**
- [Main Repository](https://github.com/yourusername/geniidataBitmap)
- [GeniiData API](https://geniidata.com)
- [Bitcoin Ordinals](https://ordinals.com)

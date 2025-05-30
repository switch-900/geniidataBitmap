// CSV Sorting Tool for Bitmap Tracker
// Sorts the CSV file by block number to maintain sequential order

const fs = require('fs');
const path = require('path');

class CSVSorter {
    constructor(csvFile = 'bitmap_data.csv') {
        this.csvFile = csvFile;
    }

    // Sort the CSV file by block number
    sortCSV() {
        try {
            console.log(`📄 Reading CSV file: ${this.csvFile}`);
            
            if (!fs.existsSync(this.csvFile)) {
                console.error(`❌ CSV file not found: ${this.csvFile}`);
                return false;
            }

            const content = fs.readFileSync(this.csvFile, 'utf8');
            const lines = content.split('\n');
            
            if (lines.length < 2) {
                console.log('📭 CSV file is empty or has no data');
                return true;
            }

            // Extract header and data
            const header = lines[0];
            const dataLines = lines.slice(1).filter(line => line.trim() !== '');
            
            console.log(`📊 Found ${dataLines.length} data entries to sort`);

            // Parse and sort data by block number
            const parsedData = dataLines.map(line => {
                const parts = line.split(',');
                const blockNumber = parseInt(parts[0]);
                const inscriptionId = parts[1] || '';
                
                return {
                    blockNumber,
                    inscriptionId,
                    originalLine: line
                };
            }).filter(entry => !isNaN(entry.blockNumber));

            // Sort by block number
            parsedData.sort((a, b) => a.blockNumber - b.blockNumber);

            // Check for duplicates
            const duplicates = [];
            for (let i = 1; i < parsedData.length; i++) {
                if (parsedData[i].blockNumber === parsedData[i-1].blockNumber) {
                    duplicates.push(parsedData[i].blockNumber);
                }
            }

            if (duplicates.length > 0) {
                console.log(`⚠️  Found ${duplicates.length} duplicate blocks: ${duplicates.slice(0, 10).join(', ')}${duplicates.length > 10 ? '...' : ''}`);
                
                // Remove duplicates (keep first occurrence)
                const uniqueData = [];
                const seenBlocks = new Set();
                
                for (const entry of parsedData) {
                    if (!seenBlocks.has(entry.blockNumber)) {
                        uniqueData.push(entry);
                        seenBlocks.add(entry.blockNumber);
                    }
                }
                
                console.log(`🧹 Removed duplicates: ${parsedData.length} -> ${uniqueData.length} entries`);
                parsedData.length = 0;
                parsedData.push(...uniqueData);
            }

            // Create backup before sorting
            const backupFile = this.csvFile.replace('.csv', '_unsorted_backup.csv');
            fs.writeFileSync(backupFile, content);
            console.log(`💾 Created backup: ${backupFile}`);

            // Write sorted data
            const sortedLines = [header];
            parsedData.forEach(entry => {
                sortedLines.push(`${entry.blockNumber},${entry.inscriptionId}`);
            });

            fs.writeFileSync(this.csvFile, sortedLines.join('\n') + '\n');
            
            console.log(`✅ CSV sorted successfully!`);
            console.log(`📊 Range: Block ${parsedData[0].blockNumber} to ${parsedData[parsedData.length-1].blockNumber}`);
            console.log(`📝 Total entries: ${parsedData.length}`);
            
            // Show gaps
            this.showGaps(parsedData);
            
            return true;

        } catch (error) {
            console.error(`❌ Error sorting CSV: ${error.message}`);
            return false;
        }
    }

    // Show gaps in the sorted data
    showGaps(parsedData) {
        if (parsedData.length < 2) return;

        const gaps = [];
        
        for (let i = 1; i < parsedData.length; i++) {
            const currentBlock = parsedData[i].blockNumber;
            const previousBlock = parsedData[i-1].blockNumber;
            
            if (currentBlock - previousBlock > 1) {
                for (let block = previousBlock + 1; block < currentBlock; block++) {
                    gaps.push(block);
                }
            }
        }

        if (gaps.length > 0) {
            console.log(`🔍 Found ${gaps.length} gaps in sequence:`);
            if (gaps.length <= 20) {
                console.log(`   Missing blocks: ${gaps.join(', ')}`);
            } else {
                console.log(`   Missing blocks: ${gaps.slice(0, 10).join(', ')}...${gaps.slice(-10).join(', ')}`);
                console.log(`   First gap: ${gaps[0]}, Last gap: ${gaps[gaps.length-1]}`);
            }
        } else {
            console.log(`✅ No gaps found - sequence is complete!`);
        }
    }

    // Validate CSV order
    validateOrder() {
        try {
            const content = fs.readFileSync(this.csvFile, 'utf8');
            const lines = content.split('\n').slice(1).filter(line => line.trim() !== '');
            
            let isOrdered = true;
            let previousBlock = -1;
            
            for (const line of lines) {
                const blockNumber = parseInt(line.split(',')[0]);
                if (!isNaN(blockNumber)) {
                    if (blockNumber <= previousBlock) {
                        isOrdered = false;
                        console.log(`❌ Order violation: Block ${blockNumber} after ${previousBlock}`);
                        break;
                    }
                    previousBlock = blockNumber;
                }
            }

            if (isOrdered) {
                console.log(`✅ CSV is properly ordered`);
            } else {
                console.log(`❌ CSV is not properly ordered`);
            }

            return isOrdered;

        } catch (error) {
            console.error(`❌ Error validating order: ${error.message}`);
            return false;
        }
    }
}

// Command line usage
if (require.main === module) {
    const csvFile = process.argv[2] || 'bitmap_data.csv';
    const action = process.argv[3] || 'sort';
    
    const sorter = new CSVSorter(csvFile);
    
    if (action === 'validate') {
        console.log('🔍 Validating CSV order...');
        sorter.validateOrder();
    } else {
        console.log('🔄 Sorting CSV file...');
        sorter.sortCSV();
    }
}

module.exports = CSVSorter;

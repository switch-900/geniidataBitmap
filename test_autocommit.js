#!/usr/bin/env node
// Test script for Git Auto-Commit functionality
// This script directly tests the auto-commit feature by simulating CSV write

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');

async function testAutoCommit() {
    console.log('🧪 Testing Git Auto-Commit Functionality...\n');
    
    // Get CONFIG from environment
    const CONFIG = {
        CSV_FILE: process.env.CSV_FILE || 'bitmap_data.csv',
        AUTO_COMMIT_CSV: process.env.AUTO_COMMIT_CSV !== 'false',
        GIT_COMMIT_MESSAGE: process.env.GIT_COMMIT_MESSAGE || 'Update Bitcoin bitmap data - Block {blockNumber}',
        GIT_PUSH_TO_REMOTE: process.env.GIT_PUSH_TO_REMOTE === 'true',
        GIT_BRANCH: process.env.GIT_BRANCH || 'main'
    };
    
    // Simulate adding a test block (use a future block number to avoid conflicts)
    const testBlockNumber = 999999;
    const testInscriptionId = 'test123456789abcdef0123456789abcdef01234567890123456789abcdef012345i0';
    
    console.log(`📝 Simulating block processing: ${testBlockNumber}`);
    console.log(`🔗 Test inscription ID: ${testInscriptionId}`);
    
    try {
        // Add test entry to CSV
        const row = `${testBlockNumber},${testInscriptionId}\n`;
        fs.appendFileSync(CONFIG.CSV_FILE, row);
        console.log(`📝 ✅ Added test entry to CSV`);
        
        // Test the auto-commit functionality directly
        await autoCommitToGit(testBlockNumber, testInscriptionId, CONFIG);
        
        console.log('\n✅ Auto-commit test completed!');
        console.log('📋 Check Git log to verify the commit was created');
        console.log('📤 Check remote repository to verify push (if enabled)');
        
        // Clean up test entry
        console.log('\n🧹 Cleaning up test entry...');
        const csvContent = fs.readFileSync(CONFIG.CSV_FILE, 'utf8');
        const lines = csvContent.split('\n');
        const filteredLines = lines.filter(line => !line.startsWith(testBlockNumber.toString()));
        fs.writeFileSync(CONFIG.CSV_FILE, filteredLines.join('\n'));
        console.log('✅ Test entry removed from CSV');
        
    } catch (error) {
        console.error('❌ Auto-commit test failed:', error.message);
    }
}

// Auto-commit function (copied from main script for testing)
async function autoCommitToGit(blockNumber, inscriptionId, CONFIG) {
    if (!CONFIG.AUTO_COMMIT_CSV) {
        console.log('⚠️ Auto-commit disabled in configuration');
        return; // Auto-commit disabled
    }

    try {
        // Ensure CSV file is tracked by git
        execSync(`git add ${CONFIG.CSV_FILE}`, { cwd: process.cwd(), stdio: 'pipe' });
        
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
        } else {
            console.log(`📤 ℹ️ No changes to commit for block ${blockNumber}`);
        }
        
    } catch (error) {
        console.log(`⚠️ Git auto-commit failed: ${error.message.substring(0, 100)}...`);
        // Don't stop operation for Git failures
    }
}

// Run test if called directly
if (require.main === module) {
    testAutoCommit();
}

module.exports = testAutoCommit;

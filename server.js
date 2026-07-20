const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store uploads in memory temporarily so we can safely read full paths
const upload = multer({ storage: multer.memoryStorage() });

app.post('/convert', upload.array('folderFiles'), async (req, res) => {
    let sessionFolder = null;
    let browser = null;

    try {
        const { pdfFormat, pdfName, filePaths } = req.body;
        const sessionId = crypto.randomUUID();
        sessionFolder = path.join(__dirname, 'uploads', sessionId);

        // Standardize filePaths to an array (handles single vs multiple files)
        const pathsArray = Array.isArray(filePaths) ? filePaths : [filePaths];

        // 1. Write files into session directory maintaining exact folder paths
        req.files.forEach((file, index) => {
            const relPath = pathsArray[index] || file.originalname;
            
            // Split path parts (e.g., ["my-folder", "images", "prashant.png"])
            const pathParts = relPath.split('/');

            // Drop the top-level folder name if it's a folder upload
            if (pathParts.length > 1) {
                pathParts.shift();
            }

            const relativeFilePath = pathParts.join('/');
            const fullFilePath = path.join(sessionFolder, relativeFilePath);
            const targetDir = path.dirname(fullFilePath);

            // Ensure subdirectories like /images/ exist
            fs.mkdirSync(targetDir, { recursive: true });

            // Write file buffer to disk
            fs.writeFileSync(fullFilePath, file.buffer);
            console.log(`Saved: ${relativeFilePath}`);
        });

        // 2. Find the primary index.html file in the root session directory
        const rootFiles = fs.readdirSync(sessionFolder);
        const htmlFileName = rootFiles.find(f => f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'));

        if (!htmlFileName) {
            return res.status(400).json({ error: 'No HTML file found in root of directory.' });
        }

        const htmlPath = path.join(sessionFolder, htmlFileName);
        const outputFilename = (pdfName && pdfName.trim() ? pdfName.trim() : 'document') + '.pdf';
        const pdfOutputPath = path.join(sessionFolder, outputFilename);

        // 3. Launch Puppeteer with local file access enabled
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--allow-file-access-from-files']
        });
        const page = await browser.newPage();

        // Load HTML via file:// protocol
        await page.goto(`file://${htmlPath}`, { 
            waitUntil: ['load', 'networkidle0'] 
        });

        let pdfOptions = {
            path: pdfOutputPath,
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        };

        if (pdfFormat === 'Original') {
            pdfOptions.preferCSSPageSize = true;
        } else {
            pdfOptions.format = pdfFormat || 'A4';
        }

        await page.pdf(pdfOptions);
        await browser.close();
        browser = null;

        // 4. Send PDF and clean up temporary folder
        res.download(pdfOutputPath, outputFilename, () => {
            if (sessionFolder && fs.existsSync(sessionFolder)) {
                fs.rmSync(sessionFolder, { recursive: true, force: true });
            }
        });

    } catch (error) {
        console.error('Conversion Error:', error);
        if (browser) await browser.close();
        if (sessionFolder && fs.existsSync(sessionFolder)) {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
        }
        res.status(500).json({ error: 'Failed to convert file to PDF.' });
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
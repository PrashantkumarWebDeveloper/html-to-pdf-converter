const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configure diskStorage so Multer recreates the relative path structure
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // req.body.sessionFolder will contain a unique timestamp id per upload
        const uploadDir = path.join(__dirname, 'temp_uploads', req.body.sessionFolder);
        
        // Extract the directory structure sent by the client (e.g., "mycv/images")
        const relativeDir = path.dirname(file.originalname);
        const targetDir = path.join(uploadDir, relativeDir);

        // Ensure the full folder path exists locally before saving the file
        fs.mkdirSync(targetDir, { recursive: true });
        cb(null, targetDir);
    },
    filename: (req, file, cb) => {
        // Retain the actual filename (e.g., index.html, profile.jpg)
        cb(null, path.basename(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Serve our basic UI frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Convert Endpoint
app.post('/convert', upload.array('folderFiles'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files were uploaded.');
    }

    const { sessionFolder, pdfFormat } = req.body;
    const baseUploadPath = path.join(__dirname, 'temp_uploads', sessionFolder);

    // Look for the main HTML entry point inside the uploaded folder
    const files = req.files;
    const htmlFile = files.find(f => f.originalname.endsWith('.html'));

    if (!htmlFile) {
        // Clean up folder if it's invalid
        fs.rmSync(baseUploadPath, { recursive: true, force: true });
        return res.status(400).send('Could not find any .html file inside the selected folder.');
    }

    // Determine the exact physical path to the primary HTML file
    const absoluteHtmlPath = path.join(baseUploadPath, htmlFile.originalname);
    const pdfOutputPath = path.join(baseUploadPath, 'output.pdf');

    let browser;
    try {
        // Fire up headless Chromium
        browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();

        // networkidle0 forces Puppeteer to wait until images/css are fully parsed and fetched
        await page.goto(`file://${absoluteHtmlPath}`, { waitUntil: 'networkidle0' });

        // Print to PDF exactly as seen on screen
        let pdfOptions = {
            path: pdfOutputPath,
            printBackground: true, // Safeguards your cyber themes and accent styling blocks
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' } // Prevents default margin squishing
        };

        if (pdfFormat === 'Original') {
            // Tells Puppeteer to scale pages cleanly directly from your CSS declarations
            pdfOptions.preferCSSPageSize = true;
        } else {
            // Injects explicit sheet standard profiles ('A4', 'Letter', etc.)
            pdfOptions.format = pdfFormat;
        }

        await page.pdf(pdfOptions);

        await browser.close();

        // Stream the PDF directly back to the client for download
        res.download(pdfOutputPath, 'converted_page.pdf', (err) => {
            // Asynchronous cleanup: wipe the temporary folder out of existence once downloaded
            fs.rmSync(baseUploadPath, { recursive: true, force: true });
        });

    } catch (error) {
        console.error(error);
        if (browser) await browser.close();
        fs.rmSync(baseUploadPath, { recursive: true, force: true });
        res.status(500).send('An error occurred during PDF rendering.');
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
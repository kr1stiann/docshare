const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { BlobServiceClient } = require('@azure/storage-blob');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Azure Blob Storage setup
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = 'documents';

function getBlobClient() {
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(containerName);
}

// Multer - store in memory
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// GET /api/files - list all files
app.get('/api/files', async (req, res) => {
  try {
    const containerClient = getBlobClient();
    const files = [];
    
    for await (const blob of containerClient.listBlobsFlat()) {
      files.push({
        id: blob.name,
        name: blob.name,
        size: formatSize(blob.properties.contentLength),
        uploaded: blob.properties.lastModified,
        type: blob.name.split('.').pop().toLowerCase()
      });
    }
    
    res.json({ success: true, files });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/upload - upload a file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Ingen fil vald' });

    const containerClient = getBlobClient();
    const blobName = `${Date.now()}_${req.file.originalname}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype }
    });

    res.json({ 
      success: true, 
      message: 'Fil uppladdad till Azure Blob Storage!',
      file: { name: req.file.originalname, blobName }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/files/:name - delete a file
app.delete('/api/files/:name', async (req, res) => {
  try {
    const containerClient = getBlobClient();
    const blockBlobClient = containerClient.getBlockBlobClient(req.params.name);
    await blockBlobClient.delete();
    res.json({ success: true, message: 'Fil borttagen' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/files/:name/download - get download URL
app.get('/api/files/:name/download', async (req, res) => {
  try {
    const containerClient = getBlobClient();
    const blockBlobClient = containerClient.getBlockBlobClient(req.params.name);
    
    // Generate SAS URL valid for 1 hour
    const { generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } = require('@azure/storage-blob');
    
    const downloadResponse = await blockBlobClient.download();
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
    downloadResponse.readableStreamBody.pipe(res);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

app.listen(PORT, () => {
  console.log(`DocShare server running on port ${PORT}`);
});

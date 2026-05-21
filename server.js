const express = require('express');
const path = require('path');

// simple static file server for llms web build
const app = express();
const port = process.env.PORT || 5053;

// serve everything from dist folder
app.use(express.static(path.join(__dirname, 'dist')));

// fallback to index.html for single-page application routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`llms server listening on port ${port}`);
});

const fs = require('fs');
const js = fs.readFileSync('/home/house/llms/script.js', 'utf8');
const html = fs.readFileSync('/home/house/llms/index.html', 'utf8');
const jsIds = [...js.matchAll(/getElementById\((?:'|")([^)]+)(?:'|")\)/g)].map(m => m[1]);
const htmlIds = [...html.matchAll(/id=(?:'|")([^'"]+)(?:'|")/g)].map(m => m[1]);
const missing = jsIds.filter(id => !htmlIds.includes(id));
console.log('Missing:', missing);

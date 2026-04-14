const fs = require('fs');
let mainContent = fs.readFileSync('src/main.js', 'utf8');
console.log(mainContent.includes('chairlifts: chairlifts.lines.map'));

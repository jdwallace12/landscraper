// Read physics.worker.js to see if there are syntax errors
const fs = require('fs');
try {
  const code = fs.readFileSync('src/engine/physics.worker.js', 'utf8');
  console.log("File read successfully, size:", code.length);
  // Just executing it without 'self' or 'import' to see if anything crashes
  let mockSelf = {};
  const mockCode = `
    const self = {};
    ${code.replace(/self\.onmessage/g, 'self.onmessage_worker')}
    module.exports = self;
  `;
  fs.writeFileSync('temp_worker_eval.js', mockCode);
  const worker = require('./temp_worker_eval.js');
  console.log("Worker exported setup successfully");
} catch(e) {
  console.log("Syntax or runtime error: ", e);
}

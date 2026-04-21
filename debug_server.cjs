const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try {
      console.log("BROWSER LOG:", JSON.parse(body));
    } catch(e) {
      console.log("BROWSER LOG:", body);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end('ok');
  });
}).listen(9999, () => console.log('Debug server running on port 9999'));

const fs = require('fs');

if (fs.existsSync('landscraper_map.json')) {
  const content = fs.readFileSync('landscraper_map.json', 'utf8');
  const data = JSON.parse(content);
  console.log("Found saved map!");
  console.log("Trees count:", data.trees?.length);
  console.log("Chairlifts count:", data.chairlifts?.length);
} else {
  console.log("No landscraper_map.json found. Check Downloads folder?");
}

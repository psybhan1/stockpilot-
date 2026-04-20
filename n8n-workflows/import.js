const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = path.join(__dirname);
const FILES = [
  '01-order-approval.json',
  '02-daily-stock-report.json',
  '03-supplier-email.json',
  '04-pos-sale-depletion.json',
];

const COOKIE = process.argv[2]; // pass session cookie as arg

async function importWorkflow(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(BASE, file), 'utf8'));
  delete raw.tags;
  const body = JSON.stringify(raw);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'n8n-production-cc71.up.railway.app',
      path: '/rest/workflows',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Cookie': COOKIE,
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.id) resolve(`OK id=${r.id} name="${r.name}"`);
          else resolve(`ERR: ${data.slice(0, 200)}`);
        } catch(e) { resolve(`ERR parse: ${data.slice(0,200)}`); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const file of FILES) {
    process.stdout.write(`Importing ${file}... `);
    const result = await importWorkflow(file);
    console.log(result);
  }
})();

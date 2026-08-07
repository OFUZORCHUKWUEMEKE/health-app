const jwt = require('./node_modules/.pnpm/jsonwebtoken@9.0.2/node_modules/jsonwebtoken');
const email = process.argv[2] || 'emeka.okafor@mediapp.com';
const sub = process.argv[3] || '69b82d9272e8901244a93546';
const role = process.argv[4] || 'doctor';
const token = jwt.sign({ sub, email, role }, 'secret', { expiresIn: '1h' });
console.log(token);
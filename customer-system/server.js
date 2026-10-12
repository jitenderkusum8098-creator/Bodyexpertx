const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const app = express();
const db = new Database(process.env.DB_FILE || path.join(__dirname, 'bodyexpertx.sqlite'));
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD_HASH = ADMIN_PASSWORD ? bcrypt.hashSync(ADMIN_PASSWORD, 12) : null;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
  console.error('Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and SESSION_SECRET before starting.');
  process.exit(1);
}
if (SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !process.env.TRUST_PROXY) {
  console.error('Set TRUST_PROXY=1 behind a trusted HTTPS reverse proxy in production.');
  process.exit(1);
}
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  service_name TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Booked' CHECK(status IN ('Booked','Completed','Cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } }));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  name: 'bex.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const cleanMobile = value => String(value || '').replace(/[\s()-]/g, '');
const validMobile = value => /^\+?[0-9]{10,15}$/.test(value);
const customer = req => req.session.customerId ? db.prepare('SELECT id,name,mobile,created_at,last_login FROM customers WHERE id=?').get(req.session.customerId) : null;
function requireCustomer(req,res,next){ if(!customer(req)) return res.status(401).json({error:'Please log in.'}); next(); }
function requireAdmin(req,res,next){ if(!req.session.isAdmin) return res.status(401).json({error:'Admin login required.'}); next(); }

app.post('/api/register', rateLimit({windowMs:60*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}), async (req,res) => {
  const name = String(req.body.name || '').trim().slice(0,80);
  const mobile = cleanMobile(req.body.mobile);
  const password = String(req.body.password || '');
  if(name.length < 2 || !validMobile(mobile) || password.length < 10 || password.length > 128)
    return res.status(400).json({error:'Name, valid mobile number and password (10–128 characters) are required.'});
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO customers(name,mobile,password_hash) VALUES(?,?,?)').run(name,mobile,hash);
    req.session.customerId = Number(result.lastInsertRowid);
    req.session.isAdmin = false;
    res.json({ok:true,customer:{name,mobile}});
  } catch(e) {
    if(String(e.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({error:'This mobile number already has an account. Please log in.'});
    console.error(e); res.status(500).json({error:'Could not create account.'});
  }
});
app.post('/api/login', rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:true,legacyHeaders:false}), async (req,res) => {
  const mobile=cleanMobile(req.body.mobile), password=String(req.body.password||'');
  const row=db.prepare('SELECT id,name,mobile,password_hash FROM customers WHERE mobile=?').get(mobile);
  if(!row || !(await bcrypt.compare(password,row.password_hash))) return res.status(401).json({error:'Mobile number or password is incorrect.'});
  req.session.regenerate(err=> {
    if(err) return res.status(500).json({error:'Login failed.'});
    req.session.customerId=row.id;
    db.prepare("UPDATE customers SET last_login=datetime('now') WHERE id=?").run(row.id);
    res.json({ok:true,customer:{name:row.name,mobile:row.mobile}});
  });
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',requireCustomer,(req,res)=>{
  const c=customer(req);
  const bookings=db.prepare('SELECT id,service_name,booking_date,status,created_at FROM bookings WHERE customer_id=? ORDER BY id DESC').all(c.id);
  res.json({customer:c,bookings,completedCount:bookings.filter(b=>b.status==='Completed').length});
});
app.post('/api/bookings',requireCustomer,(req,res)=>{
  const service=String(req.body.serviceName||'').trim().slice(0,100);
  const date=String(req.body.bookingDate||'').trim();
  if(!service || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:'Service and booking date are required.'});
  const result=db.prepare('INSERT INTO bookings(customer_id,service_name,booking_date) VALUES(?,?,?)').run(req.session.customerId,service,date);
  res.json({ok:true,id:Number(result.lastInsertRowid)});
});
app.post('/api/admin/login',rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:true,legacyHeaders:false}),async(req,res)=>{
  const username=String(req.body.username||'');
  const password=String(req.body.password||'');
  if(username!==ADMIN_USERNAME || !(await bcrypt.compare(password,ADMIN_PASSWORD_HASH))) return res.status(401).json({error:'Admin username or password is incorrect.'});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Login failed.'});req.session.isAdmin=true;res.json({ok:true});});
});
app.post('/api/admin/logout',requireAdmin,(req,res)=>{req.session.destroy(()=>res.json({ok:true}));});
app.get('/api/admin/customers',requireAdmin,(req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,80);
  const rows=q
    ? db.prepare(`SELECT c.id,c.name,c.mobile,c.created_at,c.last_login,
       (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id AND b.status='Completed') AS completed_count,
       (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id AND b.status='Booked') AS upcoming_count
       FROM customers c WHERE c.mobile LIKE ? OR c.name LIKE ? ORDER BY c.id DESC LIMIT 200`).all('%'+q+'%','%'+q+'%')
    : db.prepare(`SELECT c.id,c.name,c.mobile,c.created_at,c.last_login,
       (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id AND b.status='Completed') AS completed_count,
       (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id AND b.status='Booked') AS upcoming_count
       FROM customers c ORDER BY c.id DESC LIMIT 200`).all();
  res.json({customers:rows});
});
app.get('/api/admin/customers/:id/bookings',requireAdmin,(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'Invalid customer.'});
  const c=db.prepare('SELECT id,name,mobile FROM customers WHERE id=?').get(id);
  if(!c) return res.status(404).json({error:'Customer not found.'});
  const bookings=db.prepare('SELECT id,service_name,booking_date,status,created_at FROM bookings WHERE customer_id=? ORDER BY id DESC').all(id);
  res.json({customer:c,bookings});
});
// Admin can reset a forgotten password, but cannot view/recover the old password.
app.post('/api/admin/customers/:id/reset-password',requireAdmin,async(req,res)=>{
  const id=Number(req.params.id);
  const exists=db.prepare('SELECT id FROM customers WHERE id=?').get(id);
  if(!exists) return res.status(404).json({error:'Customer not found.'});
  const temporaryPassword=crypto.randomBytes(9).toString('base64url')+'A7!';
  const hash=await bcrypt.hash(temporaryPassword,12);
  db.prepare('UPDATE customers SET password_hash=? WHERE id=?').run(hash,id);
  res.json({ok:true,temporaryPassword,message:'Show this temporary password only once, tell it to the caller, and ask them to change it after login.'});
});
app.patch('/api/admin/bookings/:id/status',requireAdmin,(req,res)=>{
  const status=String(req.body.status||'');
  if(!['Booked','Completed','Cancelled'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  const result=db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,Number(req.params.id));
  if(!result.changes) return res.status(404).json({error:'Booking not found.'});
  res.json({ok:true});
});
app.get('/health',(req,res)=>res.json({ok:true,service:'BodyExpertX Customer System'}));
app.listen(PORT,()=>console.log('BodyExpertX customer system listening on port '+PORT));

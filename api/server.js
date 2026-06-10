const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'spp-tabungan-secret-' + Date.now();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const USE_REST = !!(SUPABASE_URL && SUPABASE_KEY);

if (USE_REST) {
  console.log('Using Supabase REST API');
} else if (process.env.DATABASE_URL) {
  console.log('Using pg direct connection');
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => console.error('Pool error:', err.message));
  global.__pool = pool;
} else {
  console.error('No database configuration found');
}

function escapeLiteral(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

async function query(text, params = []) {
  if (USE_REST) {
    let sql = text;
    for (let i = 0; i < params.length; i++) {
      sql = sql.replace(`$${i + 1}`, escapeLiteral(params[i]));
    }
    const body = JSON.stringify({ sql_text: sql });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_query`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      if (errBody.message && errBody.message.includes('syntax error') || errBody.code === '42P01') {
        throw new Error(errBody.message);
      }
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_dml`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body,
      });
      if (!res2.ok) {
        const err2 = await res2.json().catch(() => ({}));
        throw new Error(err2.message || `Query failed: ${res2.status}`);
      }
      return { rows: [] };
    }
    const data = await res.json();
    return { rows: data || [] };
  }
  const pool = global.__pool;
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

function fmtRp(n) { return (n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function parseRp(s) { return parseInt(String(s||'0').replace(/\./g,'').replace(/[^0-9]/g,'')) || 0; }

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, nama: user.nama }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token expired atau invalid' });
  }
}

function errorHandler(res, err, msg = 'Terjadi kesalahan') {
  console.error(err);
  res.status(500).json({ error: msg + ': ' + (err.message || err) });
}

const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    const token = signToken(user);
    res.json({ success: true, user: { id: user.id, username: user.username, nama: user.nama }, token });
  } catch (err) { errorHandler(res, err, 'Login gagal'); }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT id, username, nama FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.status(401).json({ error: 'User tidak ditemukan' });
    res.json({ ...result.rows[0], token: signToken(result.rows[0]) });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const tahun = req.query.tahun || String(new Date().getFullYear());
    const r = await query("SELECT COUNT(*) as total FROM siswa WHERE status = 'Aktif' AND tahun_ajaran = $1", [tahun]);
    const siswaAktif = parseInt(r.rows[0].total);
    const r2 = await query("SELECT COALESCE(SUM(tagihan_awal),0) as total FROM siswa WHERE status = 'Aktif' AND tahun_ajaran = $1", [tahun]);
    const totalTagihan = parseFloat(r2.rows[0].total);
    const r3 = await query("SELECT COALESCE(SUM(tp.jumlah),0) as total FROM tagihan_payments tp JOIN siswa s ON s.id=tp.siswa_id WHERE s.status='Aktif' AND tp.tahun_ajaran=$1", [tahun]);
    const bayarTagihan = parseFloat(r3.rows[0].total);
    const r4 = await query("SELECT COALESCE(SUM(s.spp_bulanan*12),0) as total FROM siswa s WHERE s.status='Aktif' AND s.tahun_ajaran=$1", [tahun]);
    const totalSPP = parseFloat(r4.rows[0].total);
    const r5 = await query("SELECT COALESCE(SUM(sp.jumlah),0) as total FROM spp_payments sp JOIN siswa s ON s.id=sp.siswa_id WHERE s.status='Aktif' AND sp.tahun_ajaran=$1", [tahun]);
    const bayarSPP = parseFloat(r5.rows[0].total);
    const r6 = await query("SELECT COALESCE(SUM(saldo),0) as total FROM nasabah");
    const totalTabungan = parseFloat(r6.rows[0].total);
    const r7 = await query("SELECT COUNT(*) as total FROM nasabah");
    const totalNasabah = parseInt(r7.rows[0].total);
    const r8 = await query("SELECT COUNT(*) as total FROM nasabah WHERE role='siswa'");
    const siswaTab = parseInt(r8.rows[0].total);
    const r9 = await query("SELECT COUNT(*) as total FROM nasabah WHERE role='guru'");
    const guruTab = parseInt(r9.rows[0].total);
    const r10 = await query("SELECT COUNT(*) as total FROM tabungan_transaksi WHERE TO_CHAR(tanggal,'YYYY-MM')=$1", [new Date().toISOString().slice(0,7)]);
    const trxBulanIni = parseInt(r10.rows[0].total);
    const r11 = await query("SELECT k.id,k.nama,COUNT(s.id) as jml,COALESCE(SUM(s.tagihan_awal),0) as total_tag,COALESCE(SUM(s.spp_bulanan*12),0) as total_spp FROM kelas k LEFT JOIN siswa s ON s.kelas_id=k.id AND s.status='Aktif' AND s.tahun_ajaran=$1 GROUP BY k.id,k.nama ORDER BY k.nama", [tahun]);
    const r12 = await query("SELECT id,nama,kelas,role,saldo FROM nasabah ORDER BY saldo DESC LIMIT 5");
    const r13 = await query("SELECT t.*,n.nama,n.kelas FROM tabungan_transaksi t JOIN nasabah n ON n.id=t.nasabah_id ORDER BY t.created_at DESC LIMIT 10");
    res.json({
      spp: { siswa_aktif: siswaAktif, total_tagihan_awal: totalTagihan, bayar_tagihan_awal: bayarTagihan, total_spp: totalSPP, bayar_spp: bayarSPP, per_kelas: r11.rows },
      tabungan: { total_saldo: totalTabungan, total_nasabah: totalNasabah, siswa: siswaTab, guru: guruTab, transaksi_bulan_ini: trxBulanIni, top_nasabah: r12.rows, transaksi_terbaru: r13.rows },
    });
  } catch (err) { errorHandler(res, err, 'Dashboard gagal'); }
});

app.get('/api/kelas', authMiddleware, async (req, res) => {
  try {
    const r = await query("SELECT k.id,k.nama,COUNT(s.id) as jumlah_siswa FROM kelas k LEFT JOIN siswa s ON s.kelas_id=k.id GROUP BY k.id,k.nama ORDER BY k.nama");
    res.json(r.rows);
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/kelas', authMiddleware, async (req, res) => {
  try {
    const nama = (req.body.nama || '').trim();
    if (!nama) return res.status(400).json({ error: 'Nama kelas wajib diisi' });
    const r = await query('INSERT INTO kelas (nama) VALUES ($1) ON CONFLICT (nama) DO NOTHING RETURNING id', [nama]);
    if (!r.rows.length) return res.status(400).json({ error: 'Nama kelas sudah ada' });
    res.status(201).json({ success: true, id: r.rows[0].id, nama });
  } catch (err) { errorHandler(res, err); }
});

app.delete('/api/kelas', authMiddleware, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID diperlukan' });
    const c = await query('SELECT COUNT(*) as total FROM siswa WHERE kelas_id=$1', [id]);
    if (parseInt(c.rows[0].total) > 0) return res.status(400).json({ error: 'Kelas masih memiliki siswa' });
    await query('DELETE FROM kelas WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/siswa', authMiddleware, async (req, res) => {
  try {
    const { search, kelas_id, tahun } = req.query;
    let sql = "SELECT s.*,k.nama as kelas_nama FROM siswa s JOIN kelas k ON k.id=s.kelas_id WHERE 1=1";
    const params = [];
    if (search) { params.push(`%${search}%`); sql += ` AND (s.nama ILIKE $${params.length} OR s.nis ILIKE $${params.length})`; }
    if (kelas_id) { params.push(kelas_id); sql += ` AND s.kelas_id=$${params.length}`; }
    if (tahun) { params.push(tahun); sql += ` AND s.tahun_ajaran=$${params.length}`; }
    sql += ' ORDER BY k.nama,s.nama';
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/siswa', authMiddleware, async (req, res) => {
  try {
    const { id, nis, nama, kelas_id, tahun_ajaran, tagihan_awal, spp_bulanan, status } = req.body;
    if (!nis || !nama || !kelas_id || !tahun_ajaran) return res.status(400).json({ error: 'Data tidak lengkap' });
    if (id) {
      const dup = await query('SELECT id FROM siswa WHERE nis=$1 AND tahun_ajaran=$2 AND id!=$3', [nis, tahun_ajaran, id]);
      if (dup.rows.length) return res.status(400).json({ error: 'NIS sudah terdaftar' });
      await query('UPDATE siswa SET nis=$1,nama=$2,kelas_id=$3,tahun_ajaran=$4,tagihan_awal=$5,spp_bulanan=$6,status=$7 WHERE id=$8', [nis, nama, kelas_id, tahun_ajaran, tagihan_awal||0, spp_bulanan||0, status||'Aktif', id]);
      res.json({ success: true, id });
    } else {
      const dup = await query('SELECT id FROM siswa WHERE nis=$1 AND tahun_ajaran=$2', [nis, tahun_ajaran]);
      if (dup.rows.length) return res.status(400).json({ error: 'NIS sudah terdaftar' });
      const r = await query('INSERT INTO siswa (nis,nama,kelas_id,tahun_ajaran,tagihan_awal,spp_bulanan,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [nis, nama, kelas_id, tahun_ajaran, tagihan_awal||0, spp_bulanan||0, status||'Aktif']);
      res.status(201).json({ success: true, id: r.rows[0].id });
    }
  } catch (err) { errorHandler(res, err); }
});

app.delete('/api/siswa', authMiddleware, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID diperlukan' });
    await query('DELETE FROM spp_payments WHERE siswa_id=$1', [id]);
    await query('DELETE FROM tagihan_payments WHERE siswa_id=$1', [id]);
    await query('DELETE FROM siswa WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/spp', authMiddleware, async (req, res) => {
  try {
    const { tahun, bulan, kelas_id, search } = req.query;
    const t = tahun || String(new Date().getFullYear());
    const b = bulan || 'Juli';
    let sql = "SELECT s.*,k.nama as kelas_nama FROM siswa s JOIN kelas k ON k.id=s.kelas_id WHERE s.status='Aktif' AND s.tahun_ajaran=$1";
    const params = [t];
    if (kelas_id) { params.push(kelas_id); sql += ` AND s.kelas_id=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (s.nama ILIKE $${params.length} OR s.nis ILIKE $${params.length})`; }
    sql += ' ORDER BY k.nama,s.nama';
    const siswa = (await query(sql, params)).rows;
    const result = [];
    for (const s of siswa) {
      const p = await query("SELECT id FROM spp_payments WHERE siswa_id=$1 AND tahun_ajaran=$2 AND bulan=$3", [s.id, t, b]);
      const tot = await query("SELECT COALESCE(SUM(jumlah),0) as total FROM spp_payments WHERE siswa_id=$1 AND tahun_ajaran=$2", [s.id, t]);
      const totalBayar = parseFloat(tot.rows[0].total);
      const kewajiban = parseFloat(s.spp_bulanan) * 12;
      result.push({ id: s.id, nis: s.nis, nama: s.nama, kelas_id: s.kelas_id, kelas_nama: s.kelas_nama, tahun_ajaran: s.tahun_ajaran, spp_bulanan: parseFloat(s.spp_bulanan), lunas_bulan_ini: p.rows.length > 0, total_bayar: totalBayar, kewajiban, sisa: kewajiban - totalBayar });
    }
    res.json(result);
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/spp', authMiddleware, async (req, res) => {
  try {
    const { siswa_id, tahun_ajaran, bulan, jumlah, tanggal, keterangan } = req.body;
    if (!siswa_id || !tahun_ajaran || !bulan || !jumlah || !tanggal) return res.status(400).json({ error: 'Data tidak lengkap' });
    const dup = await query("SELECT id FROM spp_payments WHERE siswa_id=$1 AND tahun_ajaran=$2 AND bulan=$3", [siswa_id, tahun_ajaran, bulan]);
    if (dup.rows.length) return res.status(400).json({ error: 'SPP bulan ini sudah dibayar' });
    const r = await query("INSERT INTO spp_payments (siswa_id,tahun_ajaran,bulan,jumlah,tanggal,keterangan) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [siswa_id, tahun_ajaran, bulan, jumlah, tanggal, keterangan||'']);
    res.status(201).json({ success: true, id: r.rows[0].id });
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/spp/cancel', authMiddleware, async (req, res) => {
  try {
    const { siswa_id, tahun_ajaran, bulan } = req.body;
    await query("DELETE FROM spp_payments WHERE siswa_id=$1 AND tahun_ajaran=$2 AND bulan=$3", [siswa_id, tahun_ajaran, bulan]);
    res.json({ success: true });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/tagihan', authMiddleware, async (req, res) => {
  try {
    const { tahun, kelas_id, search } = req.query;
    const t = tahun || String(new Date().getFullYear());
    let sql = "SELECT s.*,k.nama as kelas_nama FROM siswa s JOIN kelas k ON k.id=s.kelas_id WHERE s.status='Aktif' AND s.tahun_ajaran=$1";
    const params = [t];
    if (kelas_id) { params.push(kelas_id); sql += ` AND s.kelas_id=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (s.nama ILIKE $${params.length} OR s.nis ILIKE $${params.length})`; }
    sql += ' ORDER BY k.nama,s.nama';
    const siswa = (await query(sql, params)).rows;
    const result = [];
    for (const s of siswa) {
      const cic = await query("SELECT * FROM tagihan_payments WHERE siswa_id=$1 AND tahun_ajaran=$2 ORDER BY seri", [s.id, t]);
      const totalBayar = cic.rows.reduce((a, c) => a + parseFloat(c.jumlah), 0);
      const sisa = parseFloat(s.tagihan_awal) - totalBayar;
      result.push({ id: s.id, nis: s.nis, nama: s.nama, kelas_id: s.kelas_id, kelas_nama: s.kelas_nama, tagihan_awal: parseFloat(s.tagihan_awal), cicilan: cic.rows.map(c => ({ seri: c.seri, jumlah: parseFloat(c.jumlah), tanggal: c.tanggal })), total_bayar: totalBayar, sisa, lunas: sisa <= 0, jumlah_cicilan: cic.rows.length });
    }
    res.json(result);
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/tagihan', authMiddleware, async (req, res) => {
  try {
    const { siswa_id, tahun_ajaran, jumlah, tanggal, keterangan } = req.body;
    if (!siswa_id || !tahun_ajaran || !jumlah || !tanggal) return res.status(400).json({ error: 'Data tidak lengkap' });
    const sis = await query('SELECT * FROM siswa WHERE id=$1', [siswa_id]);
    if (!sis.rows.length) return res.status(400).json({ error: 'Siswa tidak ditemukan' });
    const tot = await query("SELECT COALESCE(SUM(jumlah),0) as total, COUNT(*) as cnt FROM tagihan_payments WHERE siswa_id=$1 AND tahun_ajaran=$2", [siswa_id, tahun_ajaran]);
    const totalBayar = parseFloat(tot.rows[0].total);
    const jumlahCicilan = parseInt(tot.rows[0].cnt);
    const sisa = parseFloat(sis.rows[0].tagihan_awal) - totalBayar;
    if (jumlahCicilan >= 4 && parseFloat(jumlah) < sisa) return res.status(400).json({ error: 'Maksimal 4x cicilan. Lunasi sisa Rp ' + fmtRp(sisa) });
    if (parseFloat(jumlah) > sisa) return res.status(400).json({ error: 'Melebihi sisa tagihan Rp ' + fmtRp(sisa) });
    const r = await query("INSERT INTO tagihan_payments (siswa_id,tahun_ajaran,jumlah,seri,tanggal,keterangan) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [siswa_id, tahun_ajaran, jumlah, jumlahCicilan + 1, tanggal, keterangan||('Cicilan ke-'+(jumlahCicilan+1))]);
    res.status(201).json({ success: true, id: r.rows[0].id, seri: jumlahCicilan + 1 });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/pembukuan', authMiddleware, async (req, res) => {
  try {
    const { tahun, kelas_id } = req.query;
    const t = tahun || String(new Date().getFullYear());
    let sql = "SELECT s.*,k.nama as kelas_nama FROM siswa s JOIN kelas k ON k.id=s.kelas_id WHERE s.status='Aktif' AND s.tahun_ajaran=$1";
    const params = [t];
    if (kelas_id) { params.push(kelas_id); sql += ` AND s.kelas_id=$${params.length}`; }
    sql += ' ORDER BY k.nama,s.nama';
    const siswa = (await query(sql, params)).rows;
    const kelasMap = {};
    for (const s of siswa) {
      const kn = s.kelas_nama;
      if (!kelasMap[kn]) kelasMap[kn] = [];
      const cic = await query("SELECT * FROM tagihan_payments WHERE siswa_id=$1 AND tahun_ajaran=$2 ORDER BY seri", [s.id, t]);
      const bayarTag = cic.rows.reduce((a, c) => a + parseFloat(c.jumlah), 0);
      const sppTot = await query("SELECT COALESCE(SUM(jumlah),0) as total FROM spp_payments WHERE siswa_id=$1 AND tahun_ajaran=$2", [s.id, t]);
      const bayarSpp = parseFloat(sppTot.rows[0].total);
      const sppKew = parseFloat(s.spp_bulanan) * 12;
      const cicCols = ['','','',''];
      cic.rows.forEach((c, i) => { if (i < 4) cicCols[i] = parseFloat(c.jumlah); });
      kelasMap[kn].push({ id: s.id, nis: s.nis, nama: s.nama, kelas: kn, tagihan_awal: parseFloat(s.tagihan_awal), cicilan: cicCols, bayar_tagihan: bayarTag, sisa_tagihan: parseFloat(s.tagihan_awal) - bayarTag, kewajiban_spp: sppKew, bayar_spp: bayarSpp, sisa_spp: sppKew - bayarSpp, total_kewajiban: parseFloat(s.tagihan_awal) + sppKew, total_dibayar: bayarTag + bayarSpp, grand_sisa: (parseFloat(s.tagihan_awal) + sppKew) - (bayarTag + bayarSpp) });
    }
    res.json({ kelas: kelasMap, tahun: t });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/nasabah', authMiddleware, async (req, res) => {
  try {
    const { search, role, kelas } = req.query;
    let sql = 'SELECT * FROM nasabah WHERE 1=1';
    const params = [];
    if (search) { params.push(`%${search}%`); sql += ` AND nama ILIKE $${params.length}`; }
    if (role) { params.push(role); sql += ` AND role=$${params.length}`; }
    if (kelas) { params.push(kelas); sql += ` AND kelas=$${params.length}`; }
    sql += ' ORDER BY nama';
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/nasabah', authMiddleware, async (req, res) => {
  try {
    const { id, nama, role, kelas } = req.body;
    if (!nama) return res.status(400).json({ error: 'Nama wajib diisi' });
    if (id) {
      const old = await query('SELECT * FROM nasabah WHERE id=$1', [id]);
      if (!old.rows.length) return res.status(400).json({ error: 'Nasabah tidak ditemukan' });
      const rl = role || 'siswa';
      const kl = rl === 'siswa' ? (kelas || '') : '';
      await query('UPDATE nasabah SET nama=$1,role=$2,kelas=$3 WHERE id=$4', [nama, rl, kl, id]);
      await query("UPDATE tabungan_transaksi SET nama=$1,role=$2,kelas=$3 WHERE nasabah_id=$4", [nama, rl, kl, id]);
      res.json({ success: true, id });
    } else {
      const dup = await query('SELECT id FROM nasabah WHERE nama=$1', [nama]);
      if (dup.rows.length) return res.status(400).json({ error: 'Nama sudah terdaftar' });
      const rl = role || 'siswa';
      const kl = rl === 'siswa' ? (kelas || '') : '';
      const r = await query('INSERT INTO nasabah (nama,role,kelas,saldo,total_setor,total_tarik) VALUES ($1,$2,$3,0,0,0) RETURNING id', [nama, rl, kl]);
      res.status(201).json({ success: true, id: r.rows[0].id });
    }
  } catch (err) { errorHandler(res, err); }
});

app.delete('/api/nasabah', authMiddleware, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID diperlukan' });
    await query('DELETE FROM tabungan_transaksi WHERE nasabah_id=$1', [id]);
    await query('DELETE FROM nasabah WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/tabungan', authMiddleware, async (req, res) => {
  try {
    const nasabahId = req.query.nasabah_id || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const offset = (page - 1) * limit;
    let where = '';
    const params = [];
    if (nasabahId) { params.push(nasabahId); where = ` WHERE t.nasabah_id=$${params.length}`; }
    const cnt = await query(`SELECT COUNT(*) as total FROM tabungan_transaksi t${where ? ' JOIN nasabah n ON n.id=t.nasabah_id' : ''}${where}`, params);
    const total = parseInt(cnt.rows[0].total);
    const r = await query(`SELECT t.*,n.nama,n.kelas,n.role FROM tabungan_transaksi t JOIN nasabah n ON n.id=t.nasabah_id${where} ORDER BY t.tanggal DESC,t.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ transaksi: r.rows, total, page, total_pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/tabungan', authMiddleware, async (req, res) => {
  try {
    const { nasabah_id, jenis, jumlah, tanggal, keterangan } = req.body;
    if (!nasabah_id || !jenis || !jumlah || !tanggal) return res.status(400).json({ error: 'Data tidak lengkap' });
    const jml = parseFloat(jumlah);
    if (jml <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0' });
    const nas = await query('SELECT * FROM nasabah WHERE id=$1', [nasabah_id]);
    if (!nas.rows.length) return res.status(400).json({ error: 'Nasabah tidak ditemukan' });
    const saldo = parseFloat(nas.rows[0].saldo);
    if (jenis === 'tarik' && saldo < jml) return res.status(400).json({ error: 'Saldo tidak mencukupi. Saldo: Rp ' + fmtRp(saldo) });
    const nominal = jenis === 'setor' ? jml : -jml;
    const newSaldo = saldo + nominal;
    await query('UPDATE nasabah SET saldo=$1, total_setor=total_setor+$2, total_tarik=total_tarik+$3 WHERE id=$4', [newSaldo, jenis === 'setor' ? jml : 0, jenis === 'tarik' ? jml : 0, nasabah_id]);
    const r = await query("INSERT INTO tabungan_transaksi (nasabah_id,jenis,jumlah,tanggal,keterangan) VALUES ($1,$2,$3,$4,$5) RETURNING id", [nasabah_id, jenis, jml, tanggal, keterangan||(jenis==='setor'?'Setor tunai':'Penarikan tunai')]);
    res.status(201).json({ success: true, id: r.rows[0].id, saldo_baru: newSaldo });
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/laporan', authMiddleware, async (req, res) => {
  try {
    const { role, kelas } = req.query;
    let sql = 'SELECT * FROM nasabah WHERE 1=1';
    const params = [];
    if (role) { params.push(role); sql += ` AND role=$${params.length}`; }
    if (kelas) { params.push(kelas); sql += ` AND kelas=$${params.length}`; }
    sql += ' ORDER BY nama';
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { errorHandler(res, err); }
});

app.get('/api/backup', authMiddleware, async (req, res) => {
  try {
    const tables = ['users','kelas','siswa','spp_payments','tagihan_payments','nasabah','tabungan_transaksi'];
    const data = { backup_date: new Date().toISOString() };
    for (const t of tables) {
      const r = await query(`SELECT * FROM ${t}`);
      data[t] = r.rows;
    }
    res.json(data);
  } catch (err) { errorHandler(res, err); }
});

app.post('/api/restore', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    if (!data.siswa || !data.nasabah) return res.status(400).json({ error: 'Format backup tidak valid' });
    const tables = ['spp_payments','tagihan_payments','siswa','tabungan_transaksi','nasabah','kelas','users'];
    await query('BEGIN');
    for (const t of tables) {
      if (data[t] && data[t].length > 0) {
        await query(`DELETE FROM ${t}`);
        for (const row of data[t]) {
          const cols = Object.keys(row);
          const vals = Object.values(row);
          const placeholders = cols.map((_, i) => `$${i + 1}`);
          await query(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals);
        }
      }
    }
    await query('COMMIT');
    res.json({ success: true });
  } catch (err) { await query('ROLLBACK').catch(()=>{}); errorHandler(res, err, 'Restore gagal'); }
});

app.get('*', (req, res) => {
  const filePath = path.join(publicPath, req.path === '/' ? 'index.html' : req.path);
  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    return res.sendFile(filePath);
  }
  res.status(404).json({ error: 'Not found' });
});

module.exports = app;

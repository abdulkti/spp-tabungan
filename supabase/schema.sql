-- Jalankan SQL ini di Supabase SQL Editor
-- Settings > Database > SQL Editor

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nama VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kelas (
    id SERIAL PRIMARY KEY,
    nama VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS siswa (
    id SERIAL PRIMARY KEY,
    nis VARCHAR(50) NOT NULL,
    nama VARCHAR(100) NOT NULL,
    kelas_id INTEGER NOT NULL REFERENCES kelas(id) ON DELETE RESTRICT,
    tahun_ajaran VARCHAR(20) NOT NULL,
    tagihan_awal NUMERIC(15,0) DEFAULT 0,
    spp_bulanan NUMERIC(15,0) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'Aktif' CHECK (status IN ('Aktif','Nonaktif','Lulus')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(nis, tahun_ajaran)
);

CREATE TABLE IF NOT EXISTS spp_payments (
    id SERIAL PRIMARY KEY,
    siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
    tahun_ajaran VARCHAR(20) NOT NULL,
    bulan VARCHAR(20) NOT NULL,
    jumlah NUMERIC(15,0) NOT NULL,
    tanggal DATE NOT NULL,
    keterangan TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(siswa_id, tahun_ajaran, bulan)
);

CREATE TABLE IF NOT EXISTS tagihan_payments (
    id SERIAL PRIMARY KEY,
    siswa_id INTEGER NOT NULL REFERENCES siswa(id) ON DELETE CASCADE,
    tahun_ajaran VARCHAR(20) NOT NULL,
    jumlah NUMERIC(15,0) NOT NULL,
    seri INTEGER DEFAULT 1,
    tanggal DATE NOT NULL,
    keterangan TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nasabah (
    id SERIAL PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    role VARCHAR(10) DEFAULT 'siswa' CHECK (role IN ('siswa','guru')),
    kelas VARCHAR(100) DEFAULT '',
    saldo NUMERIC(15,0) DEFAULT 0,
    total_setor NUMERIC(15,0) DEFAULT 0,
    total_tarik NUMERIC(15,0) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tabungan_transaksi (
    id SERIAL PRIMARY KEY,
    nasabah_id INTEGER NOT NULL REFERENCES nasabah(id) ON DELETE CASCADE,
    jenis VARCHAR(10) NOT NULL CHECK (jenis IN ('setor','tarik')),
    jumlah NUMERIC(15,0) NOT NULL,
    tanggal DATE NOT NULL,
    keterangan TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default admin (password: admin123)
INSERT INTO users (username, password, nama)
SELECT 'admin', '$2a$10$xJZQGNCw68mcNJpsuf8Uvu75UXPAyyE1SSFE3NfVw7cXz50WCo6Aq', 'Administrator'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');

-- Seed default kelas
INSERT INTO kelas (nama) VALUES ('A Sakura'), ('B Melati'), ('A Mawar'), ('B Anggrek')
ON CONFLICT (nama) DO NOTHING;

-- RPC functions for REST API access (used by Vercel IPv4)
CREATE OR REPLACE FUNCTION exec_query(sql_text TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r JSON;
BEGIN
  EXECUTE format('SELECT json_agg(row_to_json(t)) FROM (%s) t', sql_text) INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION exec_dml(sql_text TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE sql_text;
  RETURN '[]'::JSON;
END;
$$;

-- Seed Data: 100 Siswa + 100 Nasabah + 1000+ Transaksi
-- Jalankan di Supabase SQL Editor

-- Hapus data lama
DELETE FROM tabungan_transaksi WHERE 1=1;
DELETE FROM spp_payments WHERE 1=1;
DELETE FROM tagihan_payments WHERE 1=1;
DELETE FROM nasabah WHERE 1=1;
DELETE FROM siswa WHERE 1=1;

ALTER SEQUENCE IF EXISTS siswa_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS spp_payments_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS tagihan_payments_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS nasabah_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS tabungan_transaksi_id_seq RESTART WITH 1;

-- Insert 100 Siswa
INSERT INTO siswa (nis, nama, kelas_id, tahun_ajaran, tagihan_awal, spp_bulanan, status)
SELECT
  LPAD((10000 + i)::text, 5, '0'),
  (ARRAY['Ahmad','Budi','Citra','Dewi','Eko','Fitri','Gilang','Hana','Indra','Joko',
         'Kartika','Lutfi','Maya','Nurul','Omar','Putri','Rizky','Sari','Teguh','Umi',
         'Vina','Wahyu','Intan','Yusuf','Zahra','Adi','Bayu','Cinta','Dian','Eka',
         'Farhan','Gita','Hendra','Ines','Jafar','Kiki','Lintang','Mila','Novi','Opik',
         'Purnama','Qori','Ratna','Slamet','Tari','Usman','Vera','Wawan','Xena','Yanti',
         'Zulkifli','Agus','Betty','Cahyo','Dinda','Endang','Fajar','Galuh','Hamid','Irma',
         'Jamilah','Khadijah','Lukman','Murni','Nani','Okta','Paulus','Queen','Rudi','Sinta',
         'Tino','Ulfa','Vicky','Winda','Xavier','Yoga','Zainab','Arif','Bunga','Candra',
         'Dwi','Elisa','Fauzi','Gina','Hasan','Iis','Juli','Kamil','Leni','Maman',
         'Nadia','Oki','Pipit','Rina','Soni','Tuti','Ujang','Vivi','Wildan','Yani'])[i] || ' ' ||
  (ARRAY['Pratama','Wijaya','Kusuma','Sari','Hidayat','Rahman','Susanto','Ningsih',
         'Utami','Wulandari','Santoso','Anggraini','Gunawan','Setiawan','Permata',
         'Handayani','Siregar','Nasution','Harahap','Lubis'])[1 + ((i * 7) % 20)],
  1 + (i % 4),
  2025,
  CASE WHEN i % 5 < 3 THEN 1624000 ELSE 0 END,
  250000,
  'Aktif'
FROM generate_series(1, 100) i;

-- SPP Payments (~960 transaksi)
INSERT INTO spp_payments (siswa_id, tahun_ajaran, bulan, jumlah, tanggal, keterangan)
SELECT
  s.id,
  2025,
  (ARRAY['Juli','Agustus','September','Oktober','November','Desember',
         'Januari','Februari','Maret','April','Mei','Juni'])[m],
  s.spp_bulanan,
  make_date(2025 + CASE WHEN m >= 7 THEN 1 ELSE 0 END, ((m + 5) % 12) + 1, 8 + (s.id % 18)),
  'SPP ' || (ARRAY['Juli','Agustus','September','Oktober','November','Desember',
            'Januari','Februari','Maret','April','Mei','Juni'])[m] || ' 2025/2026'
FROM siswa s
CROSS JOIN generate_series(1, 12) m
WHERE (s.id * 7 + m * 13) % 10 < 8;

-- Tagihan Payments (~120 transaksi)
INSERT INTO tagihan_payments (siswa_id, tahun_ajaran, jumlah, seri, tanggal, keterangan)
SELECT
  s.id,
  2025,
  s.tagihan_awal / GREATEST((s.id % 3) + 1, 1),
  seri + 1,
  make_date(2025, 7 + ((s.id + seri) % 5), 5 + ((s.id * 3 + seri * 7) % 22)),
  'Cicilan tagihan awal ke-' || (seri + 1)
FROM siswa s
CROSS JOIN generate_series(0, (s.id % 3)) seri
WHERE s.tagihan_awal > 0;

-- Insert 100 Nasabah (80 siswa + 20 guru)
INSERT INTO nasabah (nama, role, kelas, saldo, total_setor, total_tarik)
SELECT
  CASE WHEN i <= 80 THEN (SELECT nama FROM siswa WHERE id = i)
       ELSE (ARRAY['Siti Muflihah','Abdul Rochim','Maimunah','Syahrul Gunawan','Halimah Sa''diyah',
                   'Nur Azizah','Muhammad Yasin','Khoirun Nisa','Ahmad Zahid','Fauziah Hanum',
                   'Rohmatillah','Zainal Arifin','Masitoh','Mahfudz Siddiq','Aisyah Rahma',
                   'M. Idris','Khodijah Nasution','Hasan Basri','Rukayah','Burhanuddin'])[i - 80] END,
  CASE WHEN i <= 80 THEN 'siswa' ELSE 'guru' END,
  CASE WHEN i <= 80 THEN (SELECT k.nama FROM siswa si JOIN kelas k ON k.id = si.kelas_id WHERE si.id = i) ELSE '' END,
  0, 0, 0
FROM generate_series(1, 100) i;

-- Update saldo awal nasabah (simulasi saldo existing)
UPDATE nasabah SET
  total_setor = (random() * 5000000 + 50000)::numeric(15,0),
  total_tarik = (random() * 2000000)::numeric(15,0),
  saldo = total_setor - total_tarik
WHERE 1=1;

-- Setoran Tabungan (~800 transaksi)
INSERT INTO tabungan_transaksi (nasabah_id, jenis, jumlah, tanggal, keterangan)
SELECT
  n.id,
  'setor',
  (50000 + (random() * 500000)::int / 1000 * 1000)::numeric(15,0),
  make_date(2025 + CASE WHEN m >= 7 THEN 1 ELSE 0 END, ((m + 5) % 12) + 1, 1 + (random() * 27)::int),
  (ARRAY['Setoran bulanan','Setoran sukarela','Tabungan harian','Tabungan rutin'])[1 + (i % 4)]
FROM nasabah n
CROSS JOIN generate_series(1, 8) i
CROSS JOIN generate_series(1, 12) m
WHERE n.id <= 80 AND (n.id * 3 + i * 7 + m * 5) % 10 < 6;

-- Penarikan Tabungan (~400 transaksi)
INSERT INTO tabungan_transaksi (nasabah_id, jenis, jumlah, tanggal, keterangan)
SELECT
  n.id,
  'tarik',
  (25000 + (random() * 300000)::int / 1000 * 1000)::numeric(15,0),
  make_date(2025 + CASE WHEN m >= 7 THEN 1 ELSE 0 END, ((m + 5) % 12) + 1, 1 + (random() * 27)::int),
  (ARRAY['Ambil uang','Pembayaran','Beli buku','Keperluan pribadi','Keperluan sekolah'])[1 + (i % 5)]
FROM nasabah n
CROSS JOIN generate_series(1, 5) i
CROSS JOIN generate_series(1, 12) m
WHERE n.id <= 80 AND (n.id * 11 + i * 3 + m * 7) % 10 < 4;

-- Setoran Guru (~150 transaksi)
INSERT INTO tabungan_transaksi (nasabah_id, jenis, jumlah, tanggal, keterangan)
SELECT
  n.id,
  'setor',
  (100000 + (random() * 1000000)::int / 1000 * 1000)::numeric(15,0),
  make_date(2025 + CASE WHEN m >= 7 THEN 1 ELSE 0 END, ((m + 5) % 12) + 1, 1 + (random() * 27)::int),
  'Setoran guru'
FROM nasabah n
CROSS JOIN generate_series(1, 6) i
CROSS JOIN generate_series(1, 12) m
WHERE n.id > 80 AND (n.id * 5 + i * 13 + m * 3) % 10 < 5;

-- Update saldo nasabah berdasarkan transaksi nyata
UPDATE nasabah n SET
  total_setor = COALESCE((SELECT SUM(jumlah) FROM tabungan_transaksi WHERE nasabah_id = n.id AND jenis = 'setor'), 0),
  total_tarik = COALESCE((SELECT SUM(jumlah) FROM tabungan_transaksi WHERE nasabah_id = n.id AND jenis = 'tarik'), 0),
  saldo = COALESCE((SELECT SUM(CASE WHEN jenis='setor' THEN jumlah ELSE -jumlah END) FROM tabungan_transaksi WHERE nasabah_id = n.id), 0)
WHERE 1=1;

-- Verifikasi
SELECT 'Siswa' as entity, COUNT(*)::text as total FROM siswa
UNION ALL SELECT 'SPP Payments', COUNT(*)::text FROM spp_payments
UNION ALL SELECT 'Tagihan Payments', COUNT(*)::text FROM tagihan_payments
UNION ALL SELECT 'Nasabah', COUNT(*)::text FROM nasabah
UNION ALL SELECT 'Tabungan Transaksi', COUNT(*)::text FROM tabungan_transaksi;

# 🎮 DEADLINE DASH — Full Game Design Document
**Versi:** 3.2 | **Status:** Design Locked ✅ | **Bahasa:** Indonesia

> *"Naik jabatan itu soal strategi, bukan keberuntungan. Tapi kadang atasanmu nyebelin banget — dan kamu tidak tahu siapa dia."*

---

## 1. OVERVIEW

### Konsep Inti
**Deadline Dash** adalah board game multiplayer bertema satir kehidupan korporat. Pemain bersaing menaiki jenjang karier dari **Intern** hingga **Director** — tapi tidak semua pemain adalah karyawan biasa. Beberapa adalah **Manajemen** yang tugasnya menghalangi siapapun dari kursi Director.

### Filosofi Desain
```
MEKANIK   → Token system, decision-based, skill-heavy
TEMA      → Satir korporat, humor relatable, absurdist
KOALISI   → Pure behavioral, tidak ada mechanic eksplisit
IDENTITAS → Asymmetric hidden role (Pekerja vs Manajemen)
DURASI    → Fleksibel (Mode Cepat & Mode Marathon)
BALANCE   → 70% Skill / 30% Luck
```

### Spesifikasi Dasar
| Atribut | Detail |
|---------|--------|
| Platform | Web browser (desktop-first) + versi cetak fisik |
| Jumlah Pemain | 2–6 orang |
| Durasi | Mode Cepat: 20-30 menit / Mode Marathon: 60-120 menit |
| Skill/Luck | 70% strategi / 30% keberuntungan |
| Rating Usia | 15+ |

---

## 2. STRUKTUR PEMAIN — ASYMMETRIC ROLES

### Rasio Pekerja vs Manajemen
```
Rasio: 3 Pekerja : 1 Manajemen

Contoh:
2 pemain → 1 Pekerja,  1 Manajemen  (tidak direkomendasikan)
3 pemain → 2 Pekerja,  1 Manajemen
4 pemain → 3 Pekerja,  1 Manajemen
5 pemain → 4 Pekerja,  1 Manajemen  (tidak ada rasio sempurna — dibulatkan)
6 pemain → 4 Pekerja,  2 Manajemen  ← OPTIMAL
```

### Tim Pekerja
- Identitas: Diketahui publik sebagai Pekerja
- Tujuan: Jadi satu-satunya pemain yang mencapai Director
- Boleh: Koalisi, sabotase sesama, bantu orang lain (sebagai taktik)
- Tidak ada kemenangan kolektif — hanya **satu individu** yang menang

### Tim Manajemen
- Identitas: **Hidden** — tidak ada yang tahu siapa Manajemen
- Manajemen tidak saling tahu satu sama lain
- Bisa naik jabatan sebagai cover (pura-pura jadi Pekerja)
- Tujuan: Semua card deck habis sebelum siapapun jadi Director
- Kemampuan khusus: **Shuffle Deck** + **Block Promosi**

---

## 3. WIN CONDITIONS

```
╔══════════════════════════════════════════════════════╗
║  INDIVIDU MENANG                                     ║
║  → Siapapun yang pertama jadi Director               ║
║  → Bisa Pekerja ATAU Manajemen (termasuk yg revealed)║
║  → Game selesai saat itu juga                        ╠══╗
╠══════════════════════════════════════════════════════╣  ║
║  MANAJEMEN MENANG (kolektif)                         ║  ║
║  → Semua card deck habis                             ║  ║
║  → Tidak ada satu pun yang jadi Director             ║  ║
║  → Semua Manajemen menang (walau tidak saling tahu)  ║  ║
╚══════════════════════════════════════════════════════╝  ║
                                                          ║
CATATAN PENTING ══════════════════════════════════════════╝
Tidak ada "tim Pekerja menang secara kolektif."
Pekerja bersaing satu sama lain.
Koalisi hanyalah taktik sementara.
Pada akhirnya hanya satu orang yang menang — atau Manajemen.
```

### Satir yang Tersirat
> *Pekerja tidak berjuang untuk "tim pekerja." Mereka berjuang untuk diri sendiri. Koalisi hanyalah alat. Manajemen menang bukan karena lebih pintar — tapi karena pekerja terlalu sibuk sikut-sikutan.*

---

## 4. PAPAN PERMAINAN (BOARD)

### Layout
- Gaya **Monopoly** — jalur persegi mengelilingi area tengah
- **44 kotak total**: 4 Corner + 10 kotak per sisi × 4 sisi
- Arah gerak: **searah jarum jam**
- **Receptionist (START)** fixed di pojok **kanan bawah**
- **Company Annual Event** fixed di pojok **kanan atas**
- **AUDIT** fixed di pojok **kiri atas**
- **Board Meeting** fixed di pojok **kiri bawah**
- Lewat Receptionist (bukan berhenti) = terima **Gaji** sesuai jabatan

### 4 Corner Tiles

| Corner | Posisi | Efek |
|--------|--------|------|
| 🟦 **Board Meeting** | Kiri Bawah | Tarik 1 Kartu Board Meeting — efek global (semua pemain) |
| 🔴 **AUDIT** | Kiri Atas | Pemain terjebak: throw doubles ATAU bayar denda $500 untuk bebas |
| 🟡 **Company Annual Event** | Kanan Atas | Tarik 1 Kartu Annual Event — efek bisa global |
| 🟢 **Receptionist (START)** | Kanan Bawah | Stop = terima Gaji + free roll; Lewat = terima Gaji saja |

> **Audit Rule:** Pemain yang terkena Audit tidak bisa bergerak sampai berhasil roll **true doubles** (kedua dadu menunjukkan angka yang sama — contoh: 1-1, 2-2, 3-3, dst) di giliran berikutnya, atau memilih membayar denda $500 langsung untuk bebas.

### Distribusi Kotak (40 kotak regular, 10 per sisi)

#### Sisi Bawah — Board Meeting → Receptionist
| No | Tile | Efek Singkat |
|----|------|-------------|
| 1 | 📚 Training | Roll 2d6: 2-6 = +1 Rep; 7-12 = +2 Rep |
| 2 | 💼 Work | -1 Energy + draw 1 Kartu Work; 5x akumulatif = +1 Rep |
| 3 | 💼 Work | -1 Energy + draw 1 Kartu Work; 5x akumulatif = +1 Rep |
| 4 | ☕ Coffee Machine | Tarik 1 Kartu Networking |
| 5 | 👔 HR | Roll 2d6: Doubles = aman; selain itu = -1 Rep |
| 6 | 💼 Work | -1 Energy + draw 1 Kartu Work; 5x akumulatif = +1 Rep |
| 7 | 💼 Work | -1 Energy + draw 1 Kartu Work; 5x akumulatif = +1 Rep |
| 8 | 📋 Meeting | Tarik 1 Kartu Meeting |
| 9 | 🍽️ Pantry | Restore Energy ke **MAX** |
| 10 | 💸 Finance | Bayar $300 (potongan tak terduga) |

#### Sisi Kanan — Receptionist → Company Annual Event
| No | Tile | Efek Singkat |
|----|------|-------------|
| 1 | 💼 Work | -1 Energy + draw 1 Kartu Work; 5x akumulatif = +1 Rep |
| 2 | 💼 Work | -1 Energy + draw 1 Kartu Work; 5x akumulatif = +1 Rep |
| 3 | 📋 Meeting | Tarik 1 Kartu Meeting |
| 4 | 🖥️ IT | Ignore energy cost pada Work tile berikutnya |
| 5 | 🎉 Event | Tarik 1 Kartu Event |
| 6 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |
| 7 | 📣 Marketing | +1 Reputasi instan |
| 8 | 🍱 Lunch Break | Restore Energy ke **MAX** |
| 9 | 💬 Office Gossip | Tarik 1 Kartu Networking |
| 10 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |

#### Sisi Atas — Company Annual Event → Audit
| No | Tile | Efek Singkat |
|----|------|-------------|
| 1 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |
| 2 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |
| 3 | 📋 Meeting | Tarik 1 Kartu Meeting |
| 4 | 🎉 Event | Tarik 1 Kartu Event |
| 5 | ⚖️ Legal | Skip efek kotak berikutnya (diabaikan) |
| 6 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |
| 7 | 🎓 Seminar | Tarik 1 Kartu Networking |
| 8 | 🛋️ Employee Lounge | Restore Energy ke **MAX** |
| 9 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |
| 10 | ⚙️ Operation | +2 extra space pada roll berikutnya |

#### Sisi Kiri — Audit → Board Meeting
| No | Tile | Efek Singkat |
|----|------|-------------|
| 1 | 🏆 Best Employee | +$500 + +3 Reputasi instan |
| 2 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |
| 3 | 📋 Meeting | Tarik 1 Kartu Meeting |
| 4 | 💰 Sales | Roll 2d6: 2-9 = 1.5× gaji berikutnya; 10-12 = 2× gaji |
| 5 | ⭐ CEO's Favorite | +2 Reputasi instan |
| 6 | 🎉 Event | Tarik 1 Kartu Event |
| 7 | 🚬 Smoking Area | Restore Energy ke **MAX** |
| 8 | 🏢 CEO's Office | Attempt promosi jabatan (jika memenuhi syarat) |
| 9 | 💼 Work | -1 Energy; 5x akumulatif = +1 Rep |
| 10 | 😵 Burnout | **Skip 2 turn** (berbeda dari status Burnout biasa) |

### Ringkasan Tile Types
| Tipe | Jumlah | Trigger |
|------|--------|---------|
| Work | 14 | Efek langsung (-Energy, rep counter) |
| Meeting | 4 | Tarik Kartu Meeting |
| Event | 3 | Tarik Kartu Event |
| Networking (Coffee/Gossip/Seminar) | 3 | Tarik Kartu Networking |
| Energy Restore | 4 | Full restore (Pantry, Lunch Break, Employee Lounge, Smoking Area) |
| Special Effect | 7 | Finance, IT, Legal, Operation, Best Employee, Sales, CEO's Favorite |
| Training | 1 | Dice check untuk Rep |
| HR | 1 | Dice check — safe atau -1 Rep |
| CEO's Office | 1 | Attempt promosi |
| Burnout tile | 1 | Skip 2 turn |
| **Corners** | **4** | Board Meeting, Audit, Annual Event, Receptionist |
| **Total** | **44** | |

### Kotak CEO's Office
- Pemain bisa attempt promosi kapan saja mendarat di sini
- Tidak perlu berhenti tepat (bisa dari roll berapa pun)
- Harus memenuhi syarat Money + Reputasi untuk tier berikutnya
- Jika Manajemen melakukan Block → promosi gagal, identitas Manajemen terbuka

---

## 5. SUMBER DAYA (RESOURCES)

### Empat Resource Utama

#### 💰 UANG (Money)
- Modal awal: $1.000 (Mode Cepat) / $1.500 (Mode Marathon)
- Digunakan untuk: Biaya promosi, bayar denda Punishment, Audit fine
- Didapat dari: Gaji (lewat Receptionist), kartu positif, token MONEY, Best Employee tile

#### 🌟 REPUTASI (Reputation)
- Modal awal: 0
- Digunakan untuk: Syarat promosi minimum
- Tidak berkurang saat promosi — hanya sebagai syarat
- Didapat dari: Training, Marketing, CEO's Favorite, Best Employee, Work akumulatif
- Berkurang dari: HR tile (gagal), kartu negatif

#### ⚡ ENERGI (Energy) — Stamina Kerja
- Modal awal: 5 | Max default: 8 (Supervisor +2 slot → max 10)
- **Work tile menguras 1 Energy setiap kali landing**
- **Energy = 0 → Burnout Status: WAJIB skip 1 turn (refill otomatis ke full setelahnya)**
- Refill FULL di: Pantry, Lunch Break, Employee Lounge, Smoking Area
- Cara lain refill: Energy restore kartu, beberapa role ability

#### 🧮 WORK COUNTER
- Tracker akumulasi berapa kali landing di Work tile
- Setiap **5 kali** landing di Work tile → otomatis +1 Reputasi
- Counter **akumulatif sepanjang game** — TIDAK reset setelah promosi maupun setelah mendapat Rep
- Contoh: ke-5 landing = +1 Rep, ke-10 landing = +1 Rep lagi, ke-15 = +1 Rep lagi, dst
- Makin lama game, makin banyak Rep gratis dari grinding Work tiles

### Sistem Gaji (Salary)
Setiap kali pemain **melewati** Receptionist (corner START), terima gaji sesuai jabatan:

| Jabatan | Gaji per Lap |
|---------|-------------|
| Intern | $200 |
| Staff | $400 |
| Senior Staff | $600 |
| Supervisor | $800 |
| Assistant Manager | $1.000 |
| Manager | $1.200 |
| Senior Manager | $1.400 |
| General Manager | $1.600 |
| Director | $2.000 |

**Bonus Stop:** Jika berhenti tepat di Receptionist → terima gaji + free roll tambahan.

---

## 6. TOKEN SYSTEM

Token adalah **modifikasi dice roll** — sumber utama skill expression dalam game. Pemain yang pintar tahu kapan harus spend dan kapan harus hoard.

### 4 Jenis Token

| Token | Earn dari | Spend untuk | Max carry |
|-------|----------|-------------|-----------|
| 🟦 MOVE | Reward kartu, event positif | +1 extra space per token | 3 (Cepat) / 5 (Marathon) |
| 🟩 MOMENTUM | Training, Coffee, HR tile | Mundur 1 space (dodge) ATAU re-roll (2 token) | 3 / 5 |
| 🟥 REP | Marketing success, event kartu | Instant +1 Rep ATAU -1 req promosi (2 token) | 2 / 3 |
| 💰 MONEY | Bonus kartu, Finance tile bypass | Instant +$200 | 2 / 4 |

### Cara Earn Token
- Landing di tile tertentu (Best Employee, CEO's Favorite)
- Kartu positif (Meeting, Event, Networking)
- Role ability (The Workaholic, Finance Bro)
- Setelah berhasil promosi (karakter tertentu)

### Skill Expression via Token
```
Pertanyaan strategis setiap turn:
- Spend MOVE token untuk skip Audit / Finance tile?
  Atau simpan untuk rush ke CEO's Office?
- Re-roll (2 MOMENTUM) karena dice jelek?
  Atau terima nasib dan hemat token?
- Kapan timing terbaik pakai REP token untuk promosi?
```

---

## 7. JENJANG KARIER & PROMOSI

### 9 Jabatan (8 Promosi)
```
🎓 INTERN → 📋 STAFF → 👔 SENIOR STAFF → 🏢 SUPERVISOR
→ 📊 ASST. MANAGER → 💼 MANAGER → 🚀 SENIOR MANAGER
→ 🏆 GENERAL MANAGER → 👑 DIRECTOR
```

### Biaya & Benefit Promosi

| Tier | Jabatan | Uang | Reputasi | Salary | Benefit Promosi |
|------|---------|------|---------|--------|----------------|
| Base | Intern | — | — | $200 | — |
| 1 | Staff | $500 | Rep 3 | $400 | Terima +$100 extra setiap lewat Receptionist |
| 2 | Senior Staff | $1.200 | Rep 5 | $600 | Work tile ke-5 beri +1 Rep extra (double reward) |
| 3 | Supervisor | $2.000 | Rep 7 | $800 | Max Energy slot +2 (max jadi 10) |
| 4 | Asst. Manager | $3.000 | Rep 9 | $1.000 | 1× per lap: tolak hasil roll dan re-roll |
| 5 | Manager | $4.500 | Rep 11 | $1.200 | Landing di Meeting tile → +1 Reputasi bonus |
| 6 | Senior Manager | $6.000 | Rep 13 | $1.400 | Receive double reward dari Company Annual Event |
| 7 | General Manager | $8.000 | Rep 15 | $1.600 | 1× per lap: ignore efek negatif tile / kartu |
| 8 | **Director ★** | $10.000 | Rep 17 | $2.000 | **Menang — game selesai** |

> **Mode Cepat:** Gunakan 50% dari biaya di atas (contoh: Staff = $250, Director = $5.000)

### Aturan Promosi
1. Bisa attempt promosi kapan saja mendarat di **CEO's Office**
2. Bayar biaya Money → uang langsung berkurang
3. Reputasi **tidak berkurang** — hanya syarat minimum
4. Gagal syarat → tidak bisa attempt, turn berakhir normal
5. Manajemen bisa **Block** attempt promosi (1× per game, reveal identity)
6. The Social Butterfly (role): 1× per game bisa teleport ke CEO's Office

---

## 8. SISTEM KARTU

### Konsep Multi-Deck
Game menggunakan **6 jenis deck kartu** berbeda, masing-masing dipicu oleh tile-nya sendiri.

**Total kartu fisik: 247 kartu** (50 Work + 50 Meeting + 50 Event + 47 Networking + 25 Board Meeting + 25 Annual Event)

### Timer Mechanic — "Clock Deck"
**Meeting Deck + Event Deck** secara kolektif membentuk **Clock Deck** — timer game untuk kondisi menang Manajemen.

```
Clock Deck (Mode Cepat):   50 kartu (25 Meeting + 25 Event)
Clock Deck (Mode Marathon): 100 kartu (50 Meeting + 50 Event)

Saat Clock Deck (Meeting + Event gabungan) habis → Manajemen menang
```

Deck lainnya (Work, Networking, Board Meeting, Annual Event) **dikocok ulang dan tidak habis** — tidak mempengaruhi timer.

### 6 Deck Kartu

| Deck | Total Kartu | Mode Cepat | Mode Marathon | Trigger Tile | Bagian Timer? |
|------|-------------|-----------|--------------|-------------|--------------|
| 💼 Work Cards | 50 | 25 (shuffle ulang) | 50 (shuffle ulang) | Work tile (14 tiles) | ❌ Tidak |
| 📋 Meeting Cards | 50 | 25 | 50 | Meeting tile (4 tiles) | ✅ **Ya** |
| 🎉 Event Cards | 50 | 25 | 50 | Event tile (3 tiles) | ✅ **Ya** |
| 💬 Networking Cards | 47 | 24 (shuffle ulang) | 47 (shuffle ulang) | Coffee Machine, Office Gossip, Seminar | ❌ Tidak |
| 🏛️ Board Meeting Cards | 25 | 13 (shuffle ulang) | 25 (shuffle ulang) | Board Meeting corner | ❌ Tidak |
| 🎊 Annual Event Cards | 25 | 13 (shuffle ulang) | 25 (shuffle ulang) | Company Annual Event corner | ❌ Tidak |

> **Work tile update:** Landing di Work tile → draw 1 Work Card (selain efek -1 Energy). Work Card bisa positif, negatif, atau stored.

### Deck Visibility
- **3 kartu teratas Meeting Deck selalu visible** ke semua pemain (face-up)
- **Jumlah sisa kartu di SEMUA deck terlihat** — pemain bisa track Clock Deck secara akurat
- Manajemen bisa **Shuffle** salah satu deck → 3 kartu teratas Meeting Deck berubah, count tetap terlihat

### Kategori Kartu (Berlaku di Semua Deck)

| Kategori | Cara Main | Contoh |
|---------|----------|--------|
| **Immediate** | Efek langsung saat ditarik, discard | +$100, -1 Rep |
| **Stored / Consumable** | Simpan di tangan, mainkan kapan saja (termasuk sebagai Reaction) | Expense Claim, Coffee Voucher |
| **Duration** | Efek berlaku sampai trigger berikutnya | "Next Work tile: ignore energy cost" |
| **Global** | Efek mengenai SEMUA pemain | Budget Cut: semua bayar $300 |
| **Target Player** | Kamu pilih 1 pemain yang terkena efek | Office Prank: pilih pemain, -1 Rep |
| **Choice** | Pilih salah satu dari 2+ efek | Career Opportunity: +$300 ATAU +2 Rep |
| **[REACTION]** | Stored cards yang bisa dimainkan di akhir giliran orang lain | PR Statement, Insurance Claim |

### Work Cards (50 kartu)
Ditarik saat landing di Work tile. Campuran reward kerja, penalty, dan stored consumable.

| Sub-kategori | Jumlah | Contoh |
|-------------|--------|--------|
| Reward Money | 10 | Complete Daily Task (+$100), Annual Bonus (+$800) |
| Reward Reputation | 9 | Quality Work (+1 Rep), Client Compliment (+2 Rep) |
| Reward Combo | 5 | Process Improvement (+$100 +1 Rep), Outstanding Achievement (+$300 +2 Rep) |
| Energy | 3 | Coffee Break (+1 Energy), Efficient Workflow (negate energy cost) |
| Penalty | 5 | Workload Spike (-1 Energy), Burnout (-3 Energy), Performance Warning (-2 Rep) |
| Stored / Consumable | 13 | Expense Claim, Coffee Voucher, Promotion Portfolio, Productivity Toolkit |

**Contoh Stored Work Cards (dimainkan dari tangan):**

| Nama | Efek Saat Dimainkan |
|------|-------------------|
| Expense Claim | Cancel 1 kerugian Money yang akan datang |
| Coffee Voucher | Recover 2 Energy |
| Recognition Letter | +2 Reputation |
| Project Template | Double Money reward dari Work card berikutnya |
| Promotion Portfolio | -1 Rep requirement promosi berikutnya |
| Employee Assistance Program [REACTION] | Remove semua efek negatif Work card aktif padamu |

### Meeting Cards (50 kartu) — BAGIAN CLOCK DECK
Ditarik saat landing di Meeting tile. Timer utama game bersama Event cards.

| Sub-kategori | Jumlah | Contoh |
|-------------|--------|--------|
| Reward Reputation | 18 | Productive Meeting (+1 Rep), Executive Praise (+2 Rep) |
| Reward Money | 5 | Client Approval (+$200), Approved Budget (+$300) |
| Reward Energy | 4 | Decision Made (+1 Energy), Meeting Ends Early (+1 Energy) |
| Penalty | 10 | Endless Discussion (-1 Energy), Proposal Rejected (-2 Rep) |
| Neutral | 2 | Decision Deferred (no effect), Reschedule (no effect) |
| Stored / Consumable | 7 | Approval Letter, Meeting Minutes, Budget Approval Memo |

**Contoh Stored Meeting Cards:**

| Nama | Efek Saat Dimainkan |
|------|-------------------|
| Approval Letter | +2 Reputation |
| Meeting Minutes [REACTION] | Cancel 1 Reputation loss |
| Executive Endorsement | Double Reputation gain dari Meeting card berikutnya |
| Calendar Priority [REACTION] | Skip Energy loss dari Meeting berikutnya |
| Budget Approval Memo | +$300 |

### Event Cards (50 kartu) — BAGIAN CLOCK DECK
Ditarik saat landing di Event tile. Campuran efek diri sendiri, target, dan global.

| Sub-kategori | Jumlah | Contoh |
|-------------|--------|--------|
| Self Positive | 10 | Lucky Day (+$300), Side Hustle (+$400), Lucky Draw Winner (+$500) |
| Self Negative | 8 | Laptop Crash (-2 Energy), Payroll Error (-$300), Surprise Audit (-$200 -1 Rep) |
| Target Player | 9 | Buy Coffee, Office Prank, Credit Taken (steal 1 Rep), Office Bet (roll duel) |
| Global | 7 | Birthday Celebration (everyone pays you), Profit Sharing (everyone +$300), Charity Donation |
| Choice | 3 | Career Opportunity (+$300 OR +2 Rep), Work-Life Balance (3 Energy OR +$200) |
| Stored / Defensive | 8 | Lucky Coin, Insurance Claim, PR Statement, Skip Queue Pass (ignore Audit) |
| Legendary | 2 | Jackpot! (+$800 +2 Rep), Secret Investor (+$500 + draw another Event card) |

**Contoh Target Player Event Cards:**

| Nama | Efek |
|------|------|
| Buy Coffee | Pilih pemain: mereka +2 Energy. Kamu bayar $100. |
| Credit Taken | Steal 1 Reputation dari pemain pilihan |
| Office Bet | Kamu dan target masing-masing roll dadu. Higher roll menang $200 dari yang kalah. |
| Birthday Celebration | Semua pemain lain masing-masing bayar $100 ke kamu |

**Defensive Stored Cards [REACTION]:**

| Nama | Efek |
|------|------|
| Insurance Claim | Cancel 1 Money loss apapun |
| PR Statement | Cancel 1 Reputation loss apapun |
| Energy Booster | Ignore semua Energy loss dalam 1 turn |
| Skip Queue Pass | Ignore efek 1 Audit corner |

### Networking Cards (47 kartu)
Ditarik di Coffee Machine, Office Gossip, Seminar. Kartu-kartu ini memiliki **Card Wording** — teks humor yang dibacakan keras saat kartu ditarik.

| Sub-kategori | Jumlah | Contoh |
|-------------|--------|--------|
| Self Positive | 15 | LinkedIn Influencer (+2 Rep), Networking Jackpot (+$300 +2 Rep) |
| Self Negative | 7 | Office Gossip (-2 Rep), Endless Small Talk (-2 Energy), Ghosted on LinkedIn (-1 Rep) |
| Target Player | 10 | Coffee Spill (target -1 Energy), Stolen Spotlight (steal 1 Rep), Recruiter Poached (target -$300) |
| Global | 4 | Conference Selfie (semua +1 Rep), Networking Overload (semua -1 Energy) |
| Mixed / Choice | 5 | Buzzword Overload (+1 Rep OR -1 Energy), Open to Work (+$200 OR +2 Rep) |
| Stored / Consumable | 3 | Recruiter Notice (stored: +$300), VIP Pass (ignore 1 Networking card) |

**Contoh Card Wording Networking (dibaca keras):**

> *"Let's Circle Back"* — "The meeting has been successfully postponed to another meeting." → Draw another Networking card.

> *"Can Everyone Hear Me?"* — "After five minutes, someone finally says, 'You're on mute.'" → Choose a player, they lose 1 Energy.

> *Reply All* — "The entire company really didn't need to read that." → Choose a player, they lose 1 Reputation.

### Board Meeting Cards (25 kartu)
Ditarik saat berhenti di Board Meeting corner. **Semua efeknya mempengaruhi SEMUA pemain.** Mayoritas negatif — mewakili kebijakan perusahaan yang merugikan.

| Sub-kategori | Jumlah | Contoh |
|-------------|--------|--------|
| Global Positive ⭐ | 5 | Annual Bonus Approved (+$700 semua), Promotion Season (+2 Rep semua), Company Trip (+3 Energy semua) |
| Global Negative | 20 | Cost Optimization (-$300 semua), Mandatory Overtime (-3 Energy semua), Return to Office (-2 Energy semua) |

**Contoh Board Meeting Cards:**

| Nama | Efek Global |
|------|------------|
| Annual Bonus Approved ⭐ | Semua pemain +$700 |
| Extra Leave Approved ⭐ | Semua pemain +3 Energy |
| Record Profit Sharing ⭐ | Semua pemain +$500 +1 Rep |
| Cost Optimization | Semua pemain bayar $300 |
| Mandatory Overtime | Semua pemain -3 Energy |
| Company Restructuring | Semua pemain -2 Reputation |
| Return to Office | Semua pemain -2 Energy |
| AI Transformation | Semua pemain -1 Energy |

> Board Meeting cards punya Card Wording satir. Contoh: *"Can we buy a mouse?" "No budget."*

### Annual Event Cards (25 kartu)
Ditarik saat berhenti di Company Annual Event corner. Mayoritas positif — tapi ada beberapa bencana tak terduga.

| Sub-kategori | Jumlah | Contoh |
|-------------|--------|--------|
| Global Positive | 19 | Grand Lucky Draw (+$500 semua), Performance Bonus (1× salary semua), Company Trip (+3 Energy semua) |
| Global Negative | 5 | Buffet Food Poisoning (-2 Energy semua), Karaoke Disaster (-1 Rep semua), Budget Overrun (semua bayar $200) |
| Special | 1 | Raffle Jackpot: setiap pemain roll dadu, dapat $100 × angka hasil dadu |

**Contoh Annual Event Cards:**

| Nama | Efek |
|------|------|
| Performance Bonus ⭐ | Semua pemain dapat 1× jumlah gaji jabatan mereka saat ini |
| Company Trip ⭐ | Semua pemain +3 Energy |
| Holiday Bonus ⭐ | Semua pemain +$500 +1 Energy |
| Raffle Jackpot | Semua pemain roll dadu → dapat $100 × angka hasil |
| Buffet Food Poisoning | Semua pemain -2 Energy |
| Karaoke Disaster | Semua pemain -1 Reputation |

---

## 9. KEMAMPUAN MANAJEMEN

### Dua Kemampuan Eksklusif

#### 🔀 SHUFFLE DECK
```
Frekuensi:  3× per game PER MANAJEMEN (total 6× jika ada 2 Manajemen)
Target:     Pilih salah satu dari 5 deck untuk di-shuffle
Visibility: Semua pemain lihat deck berubah — tapi TIDAK tahu siapa yang shuffle
Efek:       Reset urutan deck, 3 kartu teratas Meeting deck berubah
Cost:       Gratis, kapan saja di giliran Manajemen
Exposure:   ZERO — identitas tetap aman
```

**Dilema Shuffle:**
- Terlalu sering shuffle → pemain mulai curiga pola
- Tidak pernah shuffle saat deck jelek → juga suspicious
- Timing terbaik: shuffle Meeting deck saat 3 kartu teratas semuanya bagus untuk Pekerja

#### 🚫 BLOCK PROMOSI
```
Frekuensi:  1× per game per Manajemen (total 2× jika 2 Manajemen)
Visibility: Semua pemain tau ada block — identitas Manajemen LANGSUNG TERBUKA
Efek:       Batalkan 1 attempt promosi siapapun, 100% efektif
Cost:       Gratis, tapi taruhan identitas
Exposure:   TOTAL — tidak bisa disembunyikan lagi setelah block
```

**Dilema Block:**
- Block terlalu awal → Card Pool masih tebal, Pekerja masih banyak kesempatan
- Block terlalu telat → Pekerja sudah jadi Director, sudah kalah
- Setelah block: identitas terbuka, Manajemen ke-2 masih hidden dan bisa "pura-pura marah"

### Manajemen yang Sudah Ketahuan
Setelah menggunakan Block dan identitas terbuka:
- Masih bisa main normal (gerak, ambil resource, naik jabatan)
- **Masih bisa shuffle** (kalau jatah belum habis) — tapi sekarang semua pemain tahu siapa yang shuffle
- Konsekuensi shuffle post-reveal: pemain lain bisa **langsung counter-strategi** (misalnya tidak masuk ke Meeting tile karena tahu deck baru dikocok jelek)
- Ini menciptakan dilema baru: shuffle = helpful untuk Manajemen tapi memperburuk posisi bluff
- Strategi: bisa bertahan sebagai "kambing hitam" yang visible untuk lindungi Manajemen ke-2 yang masih hidden

---

## 10. KOALISI & SOCIAL DECEPTION

### Filosofi
**Game tidak track siapa koalisi dengan siapa.** Koalisi adalah urusan pemain, bukan sistem. Terbentuk dari keputusan bebas, bisa berubah kapan saja, tidak ada kontrak formal.

### Apa yang Bisa Dilakukan Bersama
Semua ini bisa jadi sinyal koalisi — atau bisa juga kebetulan:

| Action | Bisa Jadi Koalisi | Bisa Juga Kebetulan |
|--------|------------------|---------------------|
| Kasih kartu negatif ke target yang sama | ✓ | "Dia memang lagi leading" |
| Skip action padahal bisa serang leader | ✓ | "Belum waktunya" |
| Kasih token ke pemain lain | ✓ | "Dia hampir kena Audit" |
| Tidak serang pemain tertentu | ✓ | "Dia bukan ancaman terbesar" |

### Prisoner's Dilemma Berlapis
```
Layer 1 — Individu vs Individu:
Semua orang race ke Director. Tidak ada yang mau orang lain menang.

Layer 2 — Semua vs Manajemen (informal):
Secara kolektif perlu cegah Card Pool habis.
Tapi tidak ada insentif formal untuk kooperasi.

Layer 3 — Manajemen vs Dirinya Sendiri:
Sabotase Card Pool atau kejar Director sendiri?
Dua Manajemen yang tidak saling tahu bisa ambil strategi berlawanan.
```

---

## 11. KARAKTER (CHARACTER ROLES)

Setiap pemain dapat 1 karakter rahasia di awal game. Karakter menentukan playstyle dan ability unik.

### 6 Karakter Tersedia

#### 💪 THE WORKAHOLIC
**Lore:** *"Dia tidak punya kehidupan di luar kantor. Dan bangga dengan itu."*
- **Passive:** Setiap landing di Work tile → +$50 bonus (di atas efek normal)
- **Active (Cooldown: 2 lap):** Bayar $100 untuk refill Energy instan ke full (hindari burnout skip turn)

#### 🦋 THE SOCIAL BUTTERFLY
**Lore:** *"Semua orang kenal dia, tapi tidak ada yang tahu dia kerja apa."*
- **Passive:** +1 Reputasi setiap landing di Meeting tile
- **Active (Cooldown: 3 lap):** Tukar posisi di board dengan pemain mana pun

#### 💼 SALES STAR
**Lore:** *"Targetnya selalu terpenuhi. Dengan cara apa pun."*
- **Passive:** Gaji 20% lebih tinggi dari tarif normal setiap lewat Receptionist
- **Active (Cooldown: 3 lap):** Terima double gaji pada saat berikutnya melewati Receptionist

#### 🖥️ TECH GENIUS
**Lore:** *"Bisa fix semua sistem. Kecuali sistem manajemennya."*
- **Passive:** 1× per lap, boleh ignore 1 efek negatif (tile atau kartu)
- **Active (Cooldown: 3 lap):** Teleport ke tile mana pun di board

#### 🤝 OFFICE POLITICIAN
**Lore:** *"Hafal semua pasal peraturan perusahaan. Terutama yang menguntungkannya."*
- **Passive:** Butuh -1 Rep requirement untuk setiap promosi
- **Active (Cooldown: 3 lap):** Steal 2 Reputasi dari pemain lain mana pun

#### 🎲 LUCKY EMPLOYEE
**Lore:** *"Selalu ada di tempat yang tepat pada waktu yang tepat. Atau itu kebetulan?"*
- **Passive:** Setiap roll dadu kembar (doubles) → +$100 bonus
- **Active (Cooldown: 5 turn):** Setelah melihat hasil roll, boleh reroll kedua dadu

### Balance Summary
| Karakter | Strength | Playstyle |
|---------|---------|----------|
| The Workaholic | Economy | Grinding money lewat Work tiles |
| The Social Butterfly | Positioning | Kontrol posisi di board |
| Sales Star | Economy | Income scaling dari gaji |
| Tech Genius | Survival/Mobility | Avoid negatif + mobilitas tinggi |
| Office Politician | Promotion | Promosi lebih murah + steal Rep |
| Lucky Employee | Variance | Leverage luck untuk snowball |

---

## 12. TURN STRUCTURE

### Urutan Setiap Giliran

```
FASE 1 — START OF TURN
  └─ Check burnout: Energy = 0? → WAJIB skip turn (Energy refill ke full)
  └─ Jika terkena Audit: roll doubles untuk bebas ATAU bayar $500

FASE 2 — PRE-ROLL DECISION
  └─ Mainkan kartu dari tangan? (opsional — ini waktu utama)
  └─ Aktifkan character ability? (opsional, sesuai cooldown)
  └─ Jika Manajemen: Shuffle salah satu deck? (opsional)

FASE 3 — ROLL & MOVE
  └─ Roll 1d6
  └─ Putuskan: move normal / spend MOVE token / spend MOMENTUM token
  └─ Gerak piece ke kotak tujuan

FASE 4 — TILE RESOLUTION
  └─ Work: -1 Energy, update Work Counter (setiap 5× = +1 Rep)
  └─ Meeting/Event/Networking: tarik kartu dari deck yang sesuai
  └─ Board Meeting / Annual Event: kartu ini (jika berhenti di corner)
  └─ Training/HR/Sales: roll dice untuk outcome
  └─ Special tiles: resolve efek langsung
  └─ CEO's Office: attempt promosi (jika memenuhi syarat)
  └─ Burnout tile: skip 2 turn
  └─ Receptionist: terima gaji

FASE 5 — END OF TURN
  └─ Update resource & token
  └─ Pemain lain boleh mainkan kartu REACTION dari tangan (1 kartu max)
  └─ Cek: apakah semua Card Pool habis? → Manajemen menang
  └─ Cek: apakah ada yang jadi Director? → Individu menang
  └─ Giliran berikutnya

TOTAL PER TURN: 20-30 detik

ATURAN KARTU DARI TANGAN:
  └─ Waktu utama mainkan kartu: FASE 2 (pre-roll, giliran sendiri)
  └─ Reaction window: FASE 5 (end of turn orang lain) — max 1 kartu
  └─ Tidak semua kartu bisa jadi reaction — kartu bertag [REACTION] saja
  └─ Contoh [REACTION]: kartu yang counter efek negatif, atau kasih debuff ke pemain aktif
```

### Turn Timer
- Mode Cepat: 20 detik per turn
- Mode Marathon: 30 detik per turn
- Timer habis → auto-resolve pilihan paling konservatif

---

## 13. MODE PERMAINAN

### Mode Cepat ⚡
| Aspek | Detail |
|-------|--------|
| Durasi target | 20-30 menit |
| Card Pool | 30 kartu total |
| Hand size | 1 kartu di tangan |
| Token max | 3 per jenis |
| Promotion curve | $250 → $5.000 (50% dari biaya marathon) |
| Endgame | First to Director wins, langsung selesai |
| Turn timer | 20 detik |

### Mode Marathon 🏆
| Aspek | Detail |
|-------|--------|
| Durasi target | 60-120 menit |
| Card Pool | 60 kartu total |
| Hand size | 3 kartu di tangan |
| Token max | 5 per jenis |
| Promotion curve | $500 → $10.000 (full cost) |
| Endgame | 3 putaran tambahan setelah Director pertama |
| Turn timer | 30 detik |

### Endgame Marathon — Scoring Akhir
Setelah seseorang jadi Director, **3 putaran tambahan** berjalan. Pemenang dari skor:
```
TIER JABATAN × 1.000 poin  (Director = 9.000, GM = 8.000, dst)
+ UANG sisa × 0.1 poin     ($2.000 sisa = 200 poin)
+ REPUTASI × 50 poin       (Rep 17 = 850 poin)
```

---

## 14. CATCH-UP MECHANICS

### Trailing Bonus
Jika pemain tertinggal 2+ tier dari leader:
- Earn +1 Rep per turn (hingga gap menyempit)
- Earn +$100 bonus per turn

### Mitigasi Pile-On
Jika 2+ kartu negatif menarget pemain yang sama dalam 1 putaran:
- Kartu kedua dan seterusnya: efeknya berkurang 50%
- Mencegah pile-on yang terasa unfair

### Natural Rebalancing via Kartu Global
- **Restrukturisasi** (Event Card): semua pemain dengan 3+ token kehilangan 1
- **Town Hall** (Board Meeting Card): transparansi posisi semua pemain
- Kedua kartu ini secara natural memperlambat pemain yang paling ahead

---

## 15. THREE CHAPTER NATURAL GAME ARC

### Chapter 1 — Semua Hidden
```
Semua identitas tersembunyi. Card Pool masih tebal.
Pemain fokus naik jabatan dan kumpul resource.
Manajemen main normal sebagai cover, grinding Work tiles.
Shuffle terjadi tapi tidak ada yang tahu siapa.
Pekerja baca pola behavior — tapi semua masih ambigu.

"Siapa yang Manajemen? Semua kelihatan niat kerja."
```

### Chapter 2 — Block Terjadi
```
Satu Manajemen menggunakan Block Promosi.
Identitas terbuka. Semua pemain rewind pola sebelumnya.
Manajemen ke-2 masih hidden — bisa pura-pura ikut marah.
Pekerja sekarang punya 1 musuh yang diketahui.
Tapi masih ada 1 lagi yang bersembunyi.

"Oh, jadi DIA yang shuffle Meeting deck di Turn 6! Pantas..."
```

### Chapter 3 — Race Endgame
```
Card Pool makin tipis. Setiap kartu teratas Meeting deck jadi kritis.
Pekerja tahu 1 musuh tapi masih ada 1 lagi.
Koalisi mulai pecah — semua orang kejar CEO's Office sendiri.
Manajemen ke-2 masih shuffle dari balik bayangan.
Siapapun yang paling strategis akan menang.

"Tinggal 8 kartu. Siapa yang duluan ke CEO's Office?"
```

---

## 16. BOARD KOMPONEN FISIK (VERSI CETAK)

### Yang Dibutuhkan untuk 1 Set Game
| Komponen | Jumlah | Keterangan |
|---------|--------|-----------|
| Papan board | 1 | Cetak A2, 44 kotak (4 corner + 40 regular) |
| Kartu Work | 50 | Ditarik di Work tile; shuffle ulang saat habis |
| Kartu Meeting | 50 | Ditarik di Meeting tile; bagian Clock Deck |
| Kartu Event | 50 | Ditarik di Event tile; bagian Clock Deck |
| Kartu Networking | 47 | Coffee Machine/Office Gossip/Seminar; punya Card Wording; shuffle ulang |
| Kartu Board Meeting | 25 | Corner Board Meeting; semua efek global; punya Card Wording |
| Kartu Annual Event | 25 | Corner Annual Event; semua efek global; punya Card Wording |
| Kartu Karakter | 6 | 1 per karakter, dengan ability printed |
| Kartu Identitas (Manajemen) | 2 | Hidden, dibagikan rahasia |
| Pion pemain | 6 | Warna berbeda |
| Dadu | 2 | 2×D6 standar |
| Token MOVE | 18 | Warna biru |
| Token MOMENTUM | 18 | Warna hijau |
| Token REP | 12 | Warna merah |
| Token MONEY | 12 | Warna gold |
| Marker Uang | — | Uang kertas / chips |
| Marker Reputasi | — | Counter per pemain |
| Marker Energy | — | Counter per pemain (max 10) |
| Marker Work Counter | — | Counter per pemain (track 5× Work = +1 Rep) |
| Marker Jabatan | 6 | Track di career board |

---

## 17. SETUP AWAL

### Persiapan Board
1. Letakkan board di tengah meja
2. Corner tiles FIXED: Receptionist (kanan bawah), Board Meeting (kiri bawah), Audit (kiri atas), Company Annual Event (kanan atas)
3. 40 kotak regular sudah tercetak di posisi tetap (tidak dikocok)
4. Siapkan 5 deck kartu terpisah — kocok masing-masing deck
5. Buka **3 kartu teratas Meeting Deck** — letakkan face-up di sebelah deck

### Pembagian Karakter & Identitas
1. Siapkan 6 kartu karakter
2. Tentukan berapa Manajemen (rasio 3:1)
3. Siapkan kartu identitas Manajemen sesuai jumlah
4. Kocok kartu karakter + kartu identitas Manajemen menjadi satu pool
5. Bagikan 1 kartu per pemain — **dilihat sendiri, jangan perlihatkan**
6. Pemain yang dapat kartu Manajemen: mereka **juga** dapat kartu karakter sebagai cover

### Resource Awal
| Resource | Mode Cepat | Mode Marathon |
|---------|-----------|--------------|
| Uang | $1.000 | $1.500 |
| Reputasi | 0 | 0 |
| Energy | 5 | 5 |
| MOVE token | 1 | 1 |
| Work Counter | 0 | 0 |
| Semua pion | Di kotak Receptionist | Di kotak Receptionist |

---

## 18. NAMING GLOSSARY

| Istilah | Definisi |
|---------|---------|
| **Clock Deck** | Gabungan Meeting + Event deck — timer game untuk kondisi menang Manajemen |
| **Work Deck** | Deck 50 kartu, ditarik saat landing di Work tile (shuffle ulang saat habis) |
| **Meeting Deck** | Deck 50 kartu, ditarik di Meeting tile — **bagian Clock Deck** |
| **Event Deck** | Deck 50 kartu, ditarik di Event tile — **bagian Clock Deck** |
| **Networking Deck** | Deck 47 kartu dari Coffee Machine, Office Gossip, Seminar (shuffle ulang) |
| **Board Meeting Deck** | Deck 25 kartu dari corner Board Meeting — semua efek global (shuffle ulang) |
| **Annual Event Deck** | Deck 25 kartu dari corner Company Annual Event — semua efek global (shuffle ulang) |
| **Stored / Consumable** | Kartu yang disimpan di tangan dan dimainkan kapan saja (termasuk sebagai Reaction) |
| **[REACTION]** | Tag kartu yang bisa dimainkan saat giliran orang lain (di Fase 5 End of Turn) |
| **Card Wording** | Teks humor/flavor yang dibacakan keras saat kartu Networking/Board Meeting/Annual Event ditarik |
| **Work Counter** | Tracker akumulatif berapa kali landing di Work tile |
| **Receptionist** | Corner START, gaji setiap dilewati |
| **CEO's Office** | Tile untuk attempt promosi jabatan |
| **Audit** | Corner — terjebak sampai doubles atau bayar $500 |
| **Burnout Status** | Kondisi Energy = 0, wajib skip turn, Energy refill ke full |
| **Burnout Tile** | Tile di sisi kiri — skip 2 turn (berbeda dari Burnout status) |
| **Shuffle** | Kemampuan Manajemen kocok ulang salah satu deck (anonim) |
| **Block** | Kemampuan Manajemen batalkan promosi, reveal identity |
| **Rep** | Reputasi — resource untuk promosi |
| **Energy** | Stamina kerja — habis = burnout |
| **Token** | Modifikasi dice roll (MOVE, MOMENTUM, REP, MONEY) |
| **Salary** | Gaji yang didapat setiap melewati Receptionist |
| **Trailing Bonus** | Bonus untuk pemain yang tertinggal jauh dari leader |

---

## 19. KEPUTUSAN DESAIN FINAL (v3.1)

Semua pertanyaan terbuka telah dikunci:

| # | Pertanyaan | Keputusan |
|---|-----------|----------|
| 1 | Post-block shuffle | ✅ Masih bisa shuffle — tapi identitas sudah terbuka, semua pemain bisa counter-strategi |
| 2 | Burnout untuk Manajemen | ✅ Berlaku juga — tidak ada immunity |
| 3 | Manajemen jadi Director | ✅ Langsung end game, menang individu (sama seperti Pekerja) |
| 4 | Shuffle counter | ✅ 3× per Manajemen (total 6× jika 2 Manajemen) |
| 5 | Deck count visibility | ✅ Jumlah sisa kartu setiap deck terlihat oleh semua pemain |
| 6 | Work Counter | ✅ Akumulatif sepanjang game — tidak reset setelah promosi |
| 7 | Audit doubles | ✅ Masing-masing dadu angkanya sama (1-1, 2-2, dst) — bukan sum |
| 8 | Kartu dari tangan | ✅ Bisa dimainkan saat turn sendiri (pre-roll) DAN sebagai reaction di turn orang lain |

> **Status: 0 pertanyaan terbuka. Design Locked ✅**

---

## 20. RINGKASAN SEMUA KEPUTUSAN DESAIN

| No | Keputusan | Hasil |
|----|----------|-------|
| 1 | Mekanik | Token System + Satir Korporat |
| 2 | Durasi | Fleksibel (Cepat 20-30 min / Marathon 60-120 min) |
| 3 | Skill vs Luck | 70% Skill / 30% Luck |
| 4 | Energy | Stamina kerja — Work tile -1 Energy; restore full di 4 tiles |
| 5 | Work Counter | 5× landing Work tile = +1 Rep otomatis |
| 6 | Salary | Dapat gaji sesuai rank setiap lewat Receptionist |
| 7 | Koalisi | Pure behavioral, tidak ada mechanic eksplisit |
| 8 | Struktur pemain | Asymmetric — rasio 3 Pekerja : 1 Manajemen |
| 9 | Manajemen saling tahu? | Tidak — masing-masing hidden ke semua |
| 10 | Win condition | Individu (jadi Director) atau Manajemen (Card Pool habis) |
| 11 | Manajemen naik jabatan? | Boleh — sebagai cover |
| 12 | Clock Deck habis via | Draw dari Meeting tiles (4) dan Event tiles (3) — total 7 trigger tiles |
| 13 | Expose mechanic | Tidak ada — satu-satunya reveal saat Block |
| 14 | Kemampuan Manajemen | Shuffle 3×/Manajemen (anonim, 1 deck pilihan) + Block 1× (reveal identity) |
| 15 | Deck visibility | 3 kartu teratas Meeting Deck visible + jumlah sisa kartu SEMUA deck terlihat |
| 16 | Shuffle visibility | Deck berubah tapi tidak tahu siapa yang shuffle |
| 17 | Block visibility | Identitas Manajemen langsung terbuka |
| 18 | Board layout | Monopoly style, 44 kotak (4 corner + 40 regular) |
| 19 | Posisi corner | Receptionist (kanan bawah), Board Meeting (kiri bawah), Audit (kiri atas), Annual Event (kanan atas) |
| 20 | CEO's Office | Tile biasa di sisi kiri, bukan corner |
| 21 | Burnout tile | Tile di sisi kiri (skip 2 turn), BERBEDA dari status burnout |
| 22 | Card system | 6 deck: Work(50), Meeting(50), Event(50), Networking(47), Board Meeting(25), Annual Event(25) |
| 23 | Audit mechanic | Terjebak hingga roll doubles (masing-masing dadu angka sama) ATAU bayar $500 |
| 24 | Promosi | 8 tier (Staff → Director), masing-masing punya benefit unik |
| 25 | Karakter | 6 karakter: Workaholic, Social Butterfly, Sales Star, Tech Genius, Office Politician, Lucky Employee |
| 26 | Karakter active skill | Cooldown berbasis lap atau turn |
| 27 | General Manager | Tier baru antara Senior Manager dan Director |
| 28 | Post-block shuffle | Masih bisa, tapi identitas terbuka → counter-strategi terbuka |
| 29 | Burnout scope | Berlaku untuk semua pemain termasuk Manajemen |
| 30 | Manajemen jadi Director | Langsung end game, menang individu |
| 31 | Shuffle counter | 3× per Manajemen (bukan 3× total) |
| 32 | Deck count visibility | Jumlah sisa kartu semua deck terlihat oleh semua pemain |
| 33 | Work Counter reset | Akumulatif — tidak reset setelah promosi |
| 34 | Audit doubles | Masing-masing dadu angkanya sama (true doubles: 1-1, 2-2, dst) |
| 35 | Kartu dari tangan | Bisa saat turn sendiri (pre-roll) DAN sebagai reaction di turn orang lain |

---

*"Intern hari ini, Director entah kapan. Tergantung deck mana yang habis duluan — dan siapa yang diam-diam mengocoknya."*

---
**END OF DOCUMENT**
**Total keputusan desain terkunci: 35**
**Pertanyaan terbuka: 0 ✅**
**Status: Design Locked v3.1 — Siap masuk fase playtesting**
**Changelog v3.2:** 6 deck kartu lengkap dari xlsx (247 kartu total); Clock Deck mechanic (Meeting+Event = timer); Work tile sekarang draw Work Card; Stored/Consumable/Reaction card types; Card Wording untuk Networking/Board Meeting/Annual Event
**Changelog v3.1:** Semua open questions dikunci (post-block shuffle, burnout scope, Manajemen win, shuffle counter per-Manajemen, deck visibility, Work Counter akumulatif, Audit doubles definition, hand card timing)
**Changelog v3.0:** Board corners, tile types, salary mechanic, Work Counter, 8-tier promosi dengan benefit, 5 card deck system, 6 karakter baru

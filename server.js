// ============================================
// RestoAI - Akıllı Restoran Otomasyon Sistemi
// Backend Server (Node.js + Express + Socket.io)
// ============================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

// ============================================
// KURULUM VE YAPILANDIRMA
// ============================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET tanımlı değil. .env.example dosyasını .env olarak kopyalayıp bir sır belirleyin.');
  process.exit(1);
}
const AI_RECOMMENDATION_URL = process.env.AI_RECOMMENDATION_URL || 'http://localhost:8001/get-recommendations';
const AI_ANALYTICS_URL = process.env.AI_ANALYTICS_URL || 'http://localhost:8002/get-dashboard-report';

// Middleware'ler
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// WEBSOCKET (SOCKET.IO) YAPILANDIRMASI
// ============================================

io.on('connection', (socket) => {
  console.log(`[WebSocket] Yeni bağlantı: ${socket.id}`);

  // Admin paneli mutfak ekranına katıldığında
  socket.on('admin_katildi', () => {
    socket.join('mutfak_ekrani');
    console.log(`[WebSocket] Admin mutfak ekranına katıldı: ${socket.id}`);
    socket.emit('baglanti_basarili', { mesaj: 'Mutfak ekranına başarıyla bağlandınız' });
  });

  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    console.log(`[WebSocket] Bağlantı kesildi: ${socket.id}`);
  });
});

// ============================================
// YARDIMCI FONKSİYONLAR
// ============================================

// Yeni sipariş bildirimini mutfak ekranına gönder
function mutfagaBildir(siparisVerisi) {
  io.to('mutfak_ekrani').emit('yeni_siparis', siparisVerisi);
  console.log(`[WebSocket] Yeni sipariş mutfak ekranına bildirildi: Sipariş #${siparisVerisi.id}`);
}

// ============================================
// MIDDLEWARE'LER (GÜVENLİK)
// ============================================

// JWT Token Doğrulama Middleware'i
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ hata: 'Erişim reddedildi. Token bulunamadı.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, role }
    next();
  } catch (err) {
    return res.status(403).json({ hata: 'Geçersiz veya süresi dolmuş token.' });
  }
}

// Admin Yetkisi Kontrolü Middleware'i
function isAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ hata: 'Bu işlem için admin yetkisi gereklidir.' });
  }
  next();
}

// ============================================
// AUTH ROTALARI (Kimlik Doğrulama)
// ============================================

// Kullanıcı Kaydı (Register)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, sifre, ad, role } = req.body;

    // Validasyon
    if (!email || !sifre) {
      return res.status(400).json({ hata: 'Email ve şifre zorunludur.' });
    }

    // Email kontrolü
    const mevcutKullanici = await prisma.user.findUnique({ where: { email } });
    if (mevcutKullanici) {
      return res.status(400).json({ hata: 'Bu email adresi zaten kayıtlı.' });
    }

    // Şifre hash'leme
    const hashedSifre = await bcrypt.hash(sifre, 10);

    // Kullanıcı oluşturma
    const yeniKullanici = await prisma.user.create({
      data: {
        email,
        sifre: hashedSifre,
        ad: ad || null,
        role: role || 'KULLANICI'
      },
      select: {
        id: true,
        email: true,
        ad: true,
        role: true,
        createdAt: true
      }
    });

    res.status(201).json({
      mesaj: 'Kayıt başarılı!',
      kullanici: yeniKullanici
    });

  } catch (err) {
    console.error('[Register Hatası]:', err);
    res.status(500).json({ hata: 'Kayıt sırasında bir hata oluştu.' });
  }
});

// Kullanıcı Girişi (Login)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, sifre } = req.body;

    // Validasyon
    if (!email || !sifre) {
      return res.status(400).json({ hata: 'Email ve şifre zorunludur.' });
    }

    // Kullanıcı kontrolü
    const kullanici = await prisma.user.findUnique({ where: { email } });
    if (!kullanici) {
      return res.status(401).json({ hata: 'Email veya şifre hatalı.' });
    }

    // Şifre kontrolü
    const sifreDogrumu = await bcrypt.compare(sifre, kullanici.sifre);
    if (!sifreDogrumu) {
      return res.status(401).json({ hata: 'Email veya şifre hatalı.' });
    }

    // JWT Token oluşturma
    const token = jwt.sign(
      { id: kullanici.id, role: kullanici.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      mesaj: 'Giriş başarılı!',
      token,
      kullanici: {
        id: kullanici.id,
        email: kullanici.email,
        ad: kullanici.ad,
        role: kullanici.role
      }
    });

  } catch (err) {
    console.error('[Login Hatası]:', err);
    res.status(500).json({ hata: 'Giriş sırasında bir hata oluştu.' });
  }
});

// ============================================
// SİPARİŞ ROTALARI (Kullanıcı)
// ============================================

// Yeni Sipariş Oluşturma (QR Kod ile Masa Siparişi)
app.post('/api/siparis/yeni', verifyToken, async (req, res) => {
  try {
    const { masaNumarasi, yemekler } = req.body;
    const userId = req.user.id;

    // Validasyon
    if (!yemekler || !Array.isArray(yemekler) || yemekler.length === 0) {
      return res.status(400).json({ hata: 'Sipariş için en az bir yemek seçilmelidir.' });
    }

    // Transaction ile sipariş oluşturma (Veritabanı Bütünlüğü)
    const yeniSiparis = await prisma.$transaction(async (tx) => {
      let toplamFiyat = 0;
      const siparisDetaylari = [];

      // Her yemek için doğrulama ve fiyat hesaplama
      for (const item of yemekler) {
        const yemek = await tx.yemek.findUnique({
          where: { id: item.yemekId }
        });

        if (!yemek) {
          throw new Error(`Yemek bulunamadı: ID ${item.yemekId}`);
        }

        if (!yemek.stoktaMi) {
          throw new Error(`${yemek.ad} stokta yok.`);
        }

        if (!item.adet || item.adet < 1) {
          throw new Error(`Geçersiz adet: ${item.adet}`);
        }

        const detayFiyat = yemek.fiyat * item.adet;
        toplamFiyat += detayFiyat;

        siparisDetaylari.push({
          yemekId: yemek.id,
          adet: item.adet,
          oAnkiFiyat: yemek.fiyat
        });
      }

      // Ana sipariş kaydı oluştur
      const siparis = await tx.siparis.create({
        data: {
          userId,
          toplamFiyat,
          durum: 'BEKLIYOR',
          masaNumarasi: masaNumarasi || null,
          detaylar: {
            create: siparisDetaylari
          }
        },
        include: {
          kullanici: {
            select: { id: true, ad: true, email: true }
          },
          detaylar: {
            include: {
              yemek: true
            }
          }
        }
      });

      return siparis;
    });

    // WebSocket ile mutfak ekranına bildir
    mutfagaBildir(yeniSiparis);

    res.status(201).json({
      mesaj: 'Sipariş başarıyla oluşturuldu!',
      siparis: yeniSiparis
    });

  } catch (err) {
    console.error('[Sipariş Oluşturma Hatası]:', err);
    res.status(500).json({ 
      hata: 'Sipariş oluşturulurken bir hata oluştu.',
      detay: err.message 
    });
  }
});

// Kullanıcının Kendi Siparişlerini Görme
app.get('/api/siparis/benim', verifyToken, async (req, res) => {
  try {
    const siparisler = await prisma.siparis.findMany({
      where: { userId: req.user.id },
      include: {
        detaylar: {
          include: {
            yemek: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ siparisler });

  } catch (err) {
    console.error('[Siparişleri Getirme Hatası]:', err);
    res.status(500).json({ hata: 'Siparişler getirilirken bir hata oluştu.' });
  }
});

// Belirli Bir Siparişin Detaylarını Görme
app.get('/api/siparis/:id', verifyToken, async (req, res) => {
  try {
    const siparisId = parseInt(req.params.id);

    const siparis = await prisma.siparis.findUnique({
      where: { id: siparisId },
      include: {
        kullanici: {
          select: { id: true, ad: true, email: true }
        },
        detaylar: {
          include: {
            yemek: true
          }
        }
      }
    });

    if (!siparis) {
      return res.status(404).json({ hata: 'Sipariş bulunamadı.' });
    }

    // Kullanıcı sadece kendi siparişini görebilir (Admin hariç)
    if (siparis.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ hata: 'Bu siparişi görme yetkiniz yok.' });
    }

    res.json({ siparis });

  } catch (err) {
    console.error('[Sipariş Detay Hatası]:', err);
    res.status(500).json({ hata: 'Sipariş detayları getirilirken bir hata oluştu.' });
  }
});

// ============================================
// MENU ROTALARI (Public - Herkes Görebilir)
// ============================================

// Tüm Menüyü Getir
app.get('/api/menu', async (req, res) => {
  try {
    const { kategori, stoktaMi } = req.query;
    
    const filtre = {};
    if (kategori) filtre.kategori = kategori;
    if (stoktaMi !== undefined) filtre.stoktaMi = stoktaMi === 'true';

    const yemekler = await prisma.yemek.findMany({
      where: filtre,
      orderBy: { ad: 'asc' }
    });

    res.json({ yemekler });

  } catch (err) {
    console.error('[Menu Getirme Hatası]:', err);
    res.status(500).json({ hata: 'Menü getirilirken bir hata oluştu.' });
  }
});

// Tek Bir Yemeği Getir
app.get('/api/menu/:id', async (req, res) => {
  try {
    const yemekId = parseInt(req.params.id);

    const yemek = await prisma.yemek.findUnique({
      where: { id: yemekId }
    });

    if (!yemek) {
      return res.status(404).json({ hata: 'Yemek bulunamadı.' });
    }

    res.json({ yemek });

  } catch (err) {
    console.error('[Yemek Detay Hatası]:', err);
    res.status(500).json({ hata: 'Yemek detayları getirilirken bir hata oluştu.' });
  }
});

// ============================================
// YAPAY ZEKA ENTEGRASYONLARI
// ============================================

// Kullanıcı AI - Kişiselleştirilmiş Yemek Önerileri
app.get('/api/ai/oneriler', verifyToken, async (req, res) => {
  try {
    // AI servisine kullanıcı ID'si gönder
    const aiResponse = await axios.post(AI_RECOMMENDATION_URL, {
      user_id: req.user.id
    }, {
      timeout: 5000
    });

    const { recommended_ids } = aiResponse.data;

    if (!recommended_ids || !Array.isArray(recommended_ids)) {
      return res.status(500).json({ hata: 'AI servisinden geçersiz yanıt alındı.' });
    }

    // Önerilen yemekleri veritabanından çek
    const onerilenYemekler = await prisma.yemek.findMany({
      where: {
        id: { in: recommended_ids },
        stoktaMi: true
      }
    });

    res.json({
      mesaj: 'Sizin için özel öneriler!',
      oneriler: onerilenYemekler
    });

  } catch (err) {
    console.error('[AI Öneri Hatası]:', err);
    
    // AI servisi çalışmıyorsa fallback öneriler
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      const fallbackYemekler = await prisma.yemek.findMany({
        where: { stoktaMi: true },
        take: 5,
        orderBy: { createdAt: 'desc' }
      });

      return res.json({
        mesaj: 'Popüler yemekler (AI servisi şu anda kullanılamıyor)',
        oneriler: fallbackYemekler
      });
    }

    res.status(500).json({ hata: 'Öneriler getirilirken bir hata oluştu.' });
  }
});

// Admin AI - İşletme Analiz Raporu
app.get('/api/admin/analiz-raporu', verifyToken, isAdmin, async (req, res) => {
  try {
    // AI analytics servisinden rapor al
    const aiResponse = await axios.get(AI_ANALYTICS_URL, {
      timeout: 5000
    });

    res.json({
      mesaj: 'Analiz raporu başarıyla alındı.',
      rapor: aiResponse.data
    });

  } catch (err) {
    console.error('[AI Analiz Hatası]:', err);
    
    // AI servisi çalışmıyorsa fallback verisi
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.json({
        mesaj: 'Örnek analiz raporu (AI servisi şu anda kullanılamıyor)',
        rapor: {
          duyguDagilimi: {
            pozitif: 70,
            notr: 20,
            negatif: 10
          },
          talepTahmini: {
            bugun: 50,
            yarin: 55,
            haftaSonu: 80
          }
        }
      });
    }

    res.status(500).json({ hata: 'Analiz raporu alınırken bir hata oluştu.' });
  }
});

// ============================================
// ADMIN ROTALARI (CRUD İşlemleri)
// ============================================

// --- SİPARİŞ YÖNETİMİ ---

// Tüm Siparişleri Listele
app.get('/api/admin/siparisler', verifyToken, isAdmin, async (req, res) => {
  try {
    const { durum, masaNumarasi } = req.query;
    
    const filtre = {};
    if (durum) filtre.durum = durum;
    if (masaNumarasi) filtre.masaNumarasi = masaNumarasi;

    const siparisler = await prisma.siparis.findMany({
      where: filtre,
      include: {
        kullanici: {
          select: { id: true, ad: true, email: true }
        },
        detaylar: {
          include: {
            yemek: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ siparisler });

  } catch (err) {
    console.error('[Admin Siparişler Hatası]:', err);
    res.status(500).json({ hata: 'Siparişler getirilirken bir hata oluştu.' });
  }
});

// Sipariş Durumunu Güncelle
app.put('/api/admin/siparis/durum/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const siparisId = parseInt(req.params.id);
    const { durum } = req.body;

    // Durum validasyonu
    const gecerliDurumlar = ['BEKLIYOR', 'HAZIRLANIYOR', 'TAMAMLANDI', 'IPTAL'];
    if (!durum || !gecerliDurumlar.includes(durum)) {
      return res.status(400).json({ 
        hata: 'Geçersiz durum. Geçerli değerler: ' + gecerliDurumlar.join(', ') 
      });
    }

    const guncellenenSiparis = await prisma.siparis.update({
      where: { id: siparisId },
      data: { durum },
      include: {
        kullanici: {
          select: { id: true, ad: true, email: true }
        },
        detaylar: {
          include: {
            yemek: true
          }
        }
      }
    });

    // Durum değişikliğini WebSocket ile bildir
    io.to('mutfak_ekrani').emit('siparis_guncellendi', guncellenenSiparis);

    res.json({
      mesaj: 'Sipariş durumu başarıyla güncellendi.',
      siparis: guncellenenSiparis
    });

  } catch (err) {
    console.error('[Sipariş Durum Güncelleme Hatası]:', err);
    
    if (err.code === 'P2025') {
      return res.status(404).json({ hata: 'Sipariş bulunamadı.' });
    }
    
    res.status(500).json({ hata: 'Sipariş durumu güncellenirken bir hata oluştu.' });
  }
});

// --- MENU YÖNETİMİ ---

// Yeni Yemek Ekle
app.post('/api/admin/menu/ekle', verifyToken, isAdmin, async (req, res) => {
  try {
    const { ad, fiyat, aciklama, kategori, stoktaMi, resimUrl } = req.body;

    // Validasyon
    if (!ad || !fiyat || !kategori) {
      return res.status(400).json({ 
        hata: 'Ad, fiyat ve kategori zorunludur.' 
      });
    }

    if (fiyat <= 0) {
      return res.status(400).json({ hata: 'Fiyat 0\'dan büyük olmalıdır.' });
    }

    const yeniYemek = await prisma.yemek.create({
      data: {
        ad,
        fiyat: parseFloat(fiyat),
        aciklama: aciklama || null,
        kategori,
        stoktaMi: stoktaMi !== undefined ? stoktaMi : true,
        resimUrl: resimUrl || null
      }
    });

    res.status(201).json({
      mesaj: 'Yemek başarıyla eklendi!',
      yemek: yeniYemek
    });

  } catch (err) {
    console.error('[Yemek Ekleme Hatası]:', err);
    
    if (err.code === 'P2002') {
      return res.status(400).json({ hata: 'Bu isimde bir yemek zaten mevcut.' });
    }
    
    res.status(500).json({ hata: 'Yemek eklenirken bir hata oluştu.' });
  }
});

// Yemek Güncelle
app.put('/api/admin/menu/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const yemekId = parseInt(req.params.id);
    const { ad, fiyat, aciklama, kategori, stoktaMi, resimUrl } = req.body;

    const guncelData = {};
    if (ad) guncelData.ad = ad;
    if (fiyat !== undefined) {
      if (fiyat <= 0) {
        return res.status(400).json({ hata: 'Fiyat 0\'dan büyük olmalıdır.' });
      }
      guncelData.fiyat = parseFloat(fiyat);
    }
    if (aciklama !== undefined) guncelData.aciklama = aciklama;
    if (kategori) guncelData.kategori = kategori;
    if (stoktaMi !== undefined) guncelData.stoktaMi = stoktaMi;
    if (resimUrl !== undefined) guncelData.resimUrl = resimUrl;

    const guncellenenYemek = await prisma.yemek.update({
      where: { id: yemekId },
      data: guncelData
    });

    res.json({
      mesaj: 'Yemek başarıyla güncellendi.',
      yemek: guncellenenYemek
    });

  } catch (err) {
    console.error('[Yemek Güncelleme Hatası]:', err);
    
    if (err.code === 'P2025') {
      return res.status(404).json({ hata: 'Yemek bulunamadı.' });
    }
    
    if (err.code === 'P2002') {
      return res.status(400).json({ hata: 'Bu isimde başka bir yemek zaten mevcut.' });
    }
    
    res.status(500).json({ hata: 'Yemek güncellenirken bir hata oluştu.' });
  }
});

// Yemek Sil
app.delete('/api/admin/menu/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const yemekId = parseInt(req.params.id);

    // Yemek var mı kontrol et
    const yemek = await prisma.yemek.findUnique({
      where: { id: yemekId }
    });

    if (!yemek) {
      return res.status(404).json({ hata: 'Yemek bulunamadı.' });
    }

    await prisma.yemek.delete({
      where: { id: yemekId }
    });

    res.json({
      mesaj: 'Yemek başarıyla silindi.',
      silinenYemek: yemek
    });

  } catch (err) {
    console.error('[Yemek Silme Hatası]:', err);
    
    if (err.code === 'P2003') {
      return res.status(400).json({ 
        hata: 'Bu yemek sipariş kayıtlarında kullanıldığı için silinemez.' 
      });
    }
    
    res.status(500).json({ hata: 'Yemek silinirken bir hata oluştu.' });
  }
});

// --- KULLANICI YÖNETİMİ ---

// Tüm Kullanıcıları Listele
app.get('/api/admin/kullanicilar', verifyToken, isAdmin, async (req, res) => {
  try {
    const kullanicilar = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        ad: true,
        role: true,
        createdAt: true,
        _count: {
          select: { siparisler: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ kullanicilar });

  } catch (err) {
    console.error('[Kullanıcılar Listesi Hatası]:', err);
    res.status(500).json({ hata: 'Kullanıcılar listelenirken bir hata oluştu.' });
  }
});

// Kullanıcı Rolünü Güncelle
app.put('/api/admin/kullanici/:id/rol', verifyToken, isAdmin, async (req, res) => {
  try {
    const kullaniciId = parseInt(req.params.id);
    const { role } = req.body;

    // Rol validasyonu
    if (!role || !['KULLANICI', 'ADMIN'].includes(role)) {
      return res.status(400).json({ 
        hata: 'Geçersiz rol. Geçerli değerler: KULLANICI, ADMIN' 
      });
    }

    const guncellenenKullanici = await prisma.user.update({
      where: { id: kullaniciId },
      data: { role },
      select: {
        id: true,
        email: true,
        ad: true,
        role: true
      }
    });

    res.json({
      mesaj: 'Kullanıcı rolü başarıyla güncellendi.',
      kullanici: guncellenenKullanici
    });

  } catch (err) {
    console.error('[Rol Güncelleme Hatası]:', err);
    
    if (err.code === 'P2025') {
      return res.status(404).json({ hata: 'Kullanıcı bulunamadı.' });
    }
    
    res.status(500).json({ hata: 'Rol güncellenirken bir hata oluştu.' });
  }
});

// --- İSTATİSTİKLER ---

// Dashboard İstatistikleri
app.get('/api/admin/istatistikler', verifyToken, isAdmin, async (req, res) => {
  try {
    // Toplam sipariş sayısı
    const toplamSiparis = await prisma.siparis.count();

    // Durumlara göre sipariş sayıları
    const durumDagilimi = await prisma.siparis.groupBy({
      by: ['durum'],
      _count: true
    });

    // Toplam gelir (sadece tamamlanan siparişler)
    const gelirData = await prisma.siparis.aggregate({
      where: { durum: 'TAMAMLANDI' },
      _sum: { toplamFiyat: true }
    });

    // Toplam kullanıcı sayısı
    const toplamKullanici = await prisma.user.count();

    // Toplam menü öğesi sayısı
    const toplamYemek = await prisma.yemek.count();

    // En çok sipariş edilen yemekler (Top 5)
    const enCokSiparis = await prisma.siparisDetay.groupBy({
      by: ['yemekId'],
      _sum: { adet: true },
      orderBy: { _sum: { adet: 'desc' } },
      take: 5
    });

    // Yemek isimlerini çek
    const yemekIdleri = enCokSiparis.map(item => item.yemekId);
    const yemekler = await prisma.yemek.findMany({
      where: { id: { in: yemekIdleri } },
      select: { id: true, ad: true, kategori: true }
    });

    const enCokSiparisDetay = enCokSiparis.map(item => {
      const yemek = yemekler.find(y => y.id === item.yemekId);
      return {
        yemek: yemek,
        toplamAdet: item._sum.adet
      };
    });

    res.json({
      toplamSiparis,
      durumDagilimi,
      toplamGelir: gelirData._sum.toplamFiyat || 0,
      toplamKullanici,
      toplamYemek,
      enCokSiparisDosyanlar: enCokSiparisDetay
    });

  } catch (err) {
    console.error('[İstatistik Hatası]:', err);
    res.status(500).json({ hata: 'İstatistikler alınırken bir hata oluştu.' });
  }
});

// ============================================
// SAĞLIK KONTROLÜ (Health Check)
// ============================================

app.get('/health', (req, res) => {
  res.json({ 
    durum: 'Çalışıyor',
    zaman: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Ana sayfa
app.get('/', (req, res) => {
  res.json({
    mesaj: 'RestoAI Backend API\'ye Hoş Geldiniz!',
    version: '1.0.0',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login'
      },
      menu: {
        list: 'GET /api/menu',
        detail: 'GET /api/menu/:id'
      },
      siparis: {
        create: 'POST /api/siparis/yeni (Token gerekli)',
        myOrders: 'GET /api/siparis/benim (Token gerekli)',
        detail: 'GET /api/siparis/:id (Token gerekli)'
      },
      ai: {
        recommendations: 'GET /api/ai/oneriler (Token gerekli)',
        analytics: 'GET /api/admin/analiz-raporu (Admin token gerekli)'
      },
      admin: {
        orders: 'GET /api/admin/siparisler (Admin token gerekli)',
        updateStatus: 'PUT /api/admin/siparis/durum/:id (Admin token gerekli)',
        addMenu: 'POST /api/admin/menu/ekle (Admin token gerekli)',
        updateMenu: 'PUT /api/admin/menu/:id (Admin token gerekli)',
        deleteMenu: 'DELETE /api/admin/menu/:id (Admin token gerekli)',
        users: 'GET /api/admin/kullanicilar (Admin token gerekli)',
        updateRole: 'PUT /api/admin/kullanici/:id/rol (Admin token gerekli)',
        stats: 'GET /api/admin/istatistikler (Admin token gerekli)'
      }
    }
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ hata: 'Endpoint bulunamadı.' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Hata]:', err);
  res.status(500).json({ 
    hata: 'Sunucu hatası oluştu.',
    detay: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================
// SUNUCU BAŞLATMA
// ============================================

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🍽️  RestoAI Backend Sunucusu Başlatıldı!');
  console.log('='.repeat(50));
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`Veritabani: Prisma (${process.env.DATABASE_URL || 'tanimli degil'})`);
  console.log(`🔌 WebSocket: Socket.io aktif`);
  console.log(`🤖 AI Öneri Servisi: ${AI_RECOMMENDATION_URL}`);
  console.log(`📊 AI Analiz Servisi: ${AI_ANALYTICS_URL}`);
  console.log('='.repeat(50));
  console.log('📝 Endpoints için: GET /');
  console.log('💚 Sağlık kontrolü: GET /health');
  console.log('='.repeat(50));
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Sunucu kapatılıyor...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('✅ Sunucu başarıyla kapatıldı.');
    process.exit(0);
  });
});
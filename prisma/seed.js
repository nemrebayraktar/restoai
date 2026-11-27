const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const adminSifre = await bcrypt.hash('admin123', 10);
  const userSifre = await bcrypt.hash('user123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      sifre: adminSifre,
      ad: 'Örnek Admin',
      role: 'ADMIN',
    },
  });

  const kullanici = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      sifre: userSifre,
      ad: 'Örnek Kullanıcı',
      role: 'KULLANICI',
    },
  });

  const yemekler = [
    { ad: 'Mercimek çorbası', fiyat: 90, aciklama: 'Günlük mercimek çorbası', kategori: 'Çorba', stoktaMi: true },
    { ad: 'Tavuk şiş', fiyat: 220, aciklama: 'Izgara tavuk şiş, pilav ile', kategori: 'Ana yemek', stoktaMi: true },
    { ad: 'Sebze güveç', fiyat: 180, aciklama: 'Mevsim sebzeleri', kategori: 'Ana yemek', stoktaMi: true },
    { ad: 'Baklava', fiyat: 140, aciklama: 'Fıstıklı baklava', kategori: 'Tatlı', stoktaMi: true },
    { ad: 'Ayran', fiyat: 40, aciklama: 'Soğuk ayran', kategori: 'İçecek', stoktaMi: true },
  ];

  for (const y of yemekler) {
    await prisma.yemek.upsert({
      where: { ad: y.ad },
      update: y,
      create: y,
    });
  }

  console.log('Örnek veriler eklendi.');
  console.log('Admin girişi: admin@example.com / admin123');
  console.log('Kullanıcı girişi: user@example.com / user123');
  console.log('Bu şifreler yalnızca yerel deneme içindir, üretimde kullanmayın.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

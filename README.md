# RestoAI — restoran otomasyonu denemesi

Basit bir restoran otomasyonu backend'i. Menü, sipariş, kullanıcı girişi ve yönetici işlemleri var. Mutfak ekranı için Socket.io ile anlık bildirim düşünülmüş. İsteğe bağlı iki dış AI servisi de tanımlı: yemek önerisi ve işletme analiz raporu. Bu servisler ayakta değilse öneri tarafı menüden birkaç kayıt döndürür.

Zip'te yalnızca `server.js`, bir `package.json` ve ortam değişkeni taslağı vardı. Veritabanı şeması ve kurulum yazısı yoktu; şema `server.js` içindeki kullanımdan çıkarıldı. Varsayılan veritabanı SQLite yapıldı, böylece PostgreSQL kurmadan yerelde açılabiliyor.

## Ne yapıyor

- Kayıt ve giriş (JWT, şifre bcrypt ile tutulur)
- Roller: `KULLANICI` ve `ADMIN`
- Menü listeleme, ekleme, güncelleme, silme
- Sipariş oluşturma (işlem bütünlüğü için transaction), durum güncelleme (`BEKLIYOR`, `HAZIRLANIYOR`, `TAMAMLANDI`, `IPTAL`)
- Yönetici: siparişler, kullanıcılar, rol değiştirme, istatistikler
- `/api/ai/oneriler` — dış öneri servisine bağlanır, servis yoksa stoktaki yemeklerden döner
- `/api/admin/analiz-raporu` — dış analiz servisine bağlanır
- `/health` ve `/` — sağlık kontrolü ve uç nokta listesi

Arayüz bu pakette yok; bu depo yalnızca API tarafı.

## Kurulum

```bash
cp .env.example .env
# .env içindeki JWT_SECRET değerini kendinizinkine çevirin
npm install
npx prisma generate
npx prisma db push
npm run seed
npm start
```

Sunucu varsayılan olarak http://127.0.0.1:3000 adresinde açılır.

Örnek hesaplar (yalnızca yerel deneme, üretimde kullanmayın):

- Yönetici: `admin@example.com` / `admin123`
- Kullanıcı: `user@example.com` / `user123`

Hızlı deneme:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/menu
```

Giriş için:

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","sifre":"user123"}'
```

Dönen `token` değerini `Authorization: Bearer ...` başlığıyla sipariş ve hesap uç noktalarında kullanın. AI servisleri tanımlı değilse öneri isteği yine de yanıt verir; analiz raporu servis yoksa hata döner. Bu beklenen bir durum.

PostgreSQL kullanmak isterseniz `prisma/schema.prisma` içinde `provider` değerini `postgresql` yapın ve `DATABASE_URL` değerini kendi bağlantınıza çekin.

## Notlar

- Orijinal ortam dosyasında örnek bir JWT anahtarı ve yerel veritabanı bağlantısı vardı. Gerçek bir üretim anahtarı gibi durmuyordu; yine de depoya konmadı. `.env` dosyasını commit etmeyin.
- Sunucu, `JWT_SECRET` yoksa başlamaz.
- Zip'teki Pages dosyası (kurulum özeti) eklenmedi; içeriği bir sohbet çıktısına benziyordu ve bu README yeterli.

## English

This is a small restaurant-automation backend I built as a practice project. It has JWT auth, a menu, orders (with transactions), an admin API, Socket.io notifications for a kitchen screen, and optional hooks to two external AI services. The original zip had the server, a package manifest and an env template, but no Prisma schema. The schema here is inferred from the server code, and the default database is SQLite so the API can be started without PostgreSQL.

Copy `.env.example` to `.env`, set your own `JWT_SECRET`, then run `npm install`, `npx prisma generate`, `npx prisma db push`, `npm run seed`, and `npm start`. The server listens on http://127.0.0.1:3000. Demo logins are `admin@example.com` / `admin123` and `user@example.com` / `user123` (local use only). AI calls may fail or fall back when those services are not running.

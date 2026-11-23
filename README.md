# Gömrük Akademiyası 2.0

Normativ aktlar, izahlı tədris materialları və testlər üçün sayt. Görünüşü Map-Panel kimidir, amma tam ayrıdır.

- **Sayt Vercel-dədir.** Bütün dərslər, PDF / Word faylları və testlər **öz serverinizin diskində**
  (`data` qovluğu) saxlanılır. Verilənlər bazası (MongoDB) yoxdur.
- Vercel hər sorğunu serverinizə ötürür. Vercel-də silinən sənəd elə serverdən silinir: ayrıca yer yoxdur.
- Daxil olmaq: ad yazılır. Serverdə `APP_PASSWORD` təyin etsəniz, hamı üçün bir ortaq şifrə də soruşulur.
- Daxil olan hər kəs dərs, sənəd və test əlavə edə, dəyişə, silə bilər.
- Test cavabları hər istifadəçinin öz brauzerində saxlanılır: səhifə bağlansa da test qaldığı yerdən davam edir.

## 1. Server (öz kompüteriniz / Windows server)

Node.js 18 və ya daha yeni lazımdır.

```powershell
cd C:\path\to\gomruk-akademiyasi
npm install
copy .env.example .env     # istəsəniz APP_PASSWORD yazın
npm start                  # http://localhost:3000
```

- Fayllar `data\` qovluğunda saxlanılır (`DATA_DIR` ilə başqa yer seçmək olar). Ehtiyat nüsxə üçün bu qovluğu kopyalamaq kifayətdir.
- Port 3000 internetdən açıq olmalıdır (Windows Firewall + router / IT). Və ya veb serveriniz (IIS / Apache)
  məsələn `http://ünvan/gomruk/...` sorğularını `http://localhost:3000/gomruk/...`-ə ötürsün, `.env`-də `BASE_PATH=/gomruk`.
- Daima işləməsi üçün MapsPanel kimi Windows xidməti (service) və ya Task Scheduler ilə başladın.
- Yoxlamaq: brauzerdə `http://ictimai-ünvan:3000/api/health` açın, `{"ok":true}` görünməlidir.

## 2. Vercel

1. Bu qovluğu GitHub reposuna qoyun (`data` və `.env` repoya düşmür).
2. Vercel → **Add New Project** → reponu seçin (Framework: Vite, özü tanıyır).
3. **Settings → Environment Variables**: `GOMRUK_SERVER_URL` = serverinizin ictimai ünvanı, məsələn
   `http://203.0.113.10:3000` (və ya `BASE_PATH` işlədirsinizsə `http://203.0.113.10/gomruk`).
4. Deploy.

Fayllar 3 MB-lıq hissələrlə gedib-gəlir, ona görə Vercel-in 4.5 MB limiti problem deyil.

## Şirkət daxilində Vercel-siz

`npm run build` edib `npm start` işlətsəniz (BASE_PATH boş olanda), sayt da `http://server:3000`-də açılır.

## Köhnə dərsləri köçürmək

Əsas səhifədə **Qovluqdan yüklə** → köhnə `DERSLER` qovluğunu seçin (və ya pəncərəyə sürüşdürün).
Hər `Ders_XX` bir dərs olur: `ORIGINAL` normativ aktlar, `IZAH` izah, `TEST` Word test bankı, `BASLIQ.txt` dərsin adı.
Eyni adlı Word və PDF varsa PDF götürülür. Bu adda dərs artıq varsa, siyahıda qeyd olunur və əvvəlcədən seçilmir.

## Lokal inkişaf

```powershell
npm start        # bir pəncərədə (server, port 3000)
npm run dev      # başqa pəncərədə (Vite, /api sorğularını 3000-ə ötürür)
```

## Fayllar

| Yer | Nə edir |
|---|---|
| `api/index.js` | Vercel funksiyası: `/api/...` sorğularını serverinizə ötürür |
| `server.js` | serveri başladır |
| `server/app.js` | giriş və API |
| `server/routes.js` | dərslər, sənədlər, testlər, 3 MB hissələrlə yükləmə / endirmə |
| `server/store.js` | diskdə saxlama (`data\docs`, `data\files`) |
| `src/lib/gaParse.js` | Word / RTF / ODT / köhnə .doc oxuyucu və test bankı tanıyıcı (V1.5-dən) |
| `src/components/` | səhifələr: giriş, dərslər, dərs, sınaq, oxuyucu, test, əlavə etmə |
| `src/styles/panel.css` | Map-Panel-in stilləri (eyni görünüş üçün) |

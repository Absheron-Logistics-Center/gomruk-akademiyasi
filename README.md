# Gömrük Akademiyası 2.0

Normativ aktlar, izahlı tədris materialları və testlər üçün sayt. Görünüşü Map-Panel kimidir, amma tam ayrıdır.

- **Sayt Vercel-dədir** və istənilən kompüterdən, istənilən internetdən açılır.
- Dərslərin siyahısı və testlər **Upstash Redis**-də, PDF / Word faylları **Vercel Blob**-da saxlanılır
  (ikisi də Vercel-in içindən, pulsuz).
- **Öz serveriniz hər dəqiqə bütün faylların nüsxəsini `data` qovluğuna çəkir.** Saytda silinən sənəd
  serverdən də silinir. Server yalnız çölə qoşulur, routerdə port açmaq lazım deyil.
- Daxil olmaq: ad + ortaq şifrə (`APP_PASSWORD`). Daxil olan hər kəs əlavə edə, dəyişə, silə bilər.
- Test cavabları hər istifadəçinin öz brauzerində saxlanılır: səhifə bağlansa da test qaldığı yerdən davam edir.

## 1. Vercel (bir dəfə)

1. Bu qovluğu GitHub-a push edin, Vercel-də layihə kimi əlavə edin (Framework: Vite, özü tanıyır).
2. Layihədə **Storage** bölməsi:
   - **Create → Blob** → ad verin → **Connect** (bu layihəyə). `BLOB_READ_WRITE_TOKEN` özü əlavə olunur.
   - **Create → Upstash for Redis** (Marketplace, Free plan) → **Connect** (bu layihəyə).
     `KV_REST_API_URL` və `KV_REST_API_TOKEN` özü əlavə olunur.
3. **Settings → Environment Variables**: `APP_PASSWORD` = ortaq şifrə (məsələn `ALM2026`).
4. **Deployments → ⋯ → Redeploy**.

Pulsuz limitlər (Hobby): Blob 1 GB yer, ayda 2 000 yazma / 10 000 oxuma; Redis ayda 500 000 əmr.
Fayllar 3 MB-lıq hissələrlə saxlanılır; köhnə DERSLER qovluğunun hamısı (~47 MB) təxminən 60 yazma edir.

## 2. Öz server (nüsxə üçün)

`.env` faylı (`server.js`-in yanında):

```
SITE_URL=https://gomruk-akademiyasi.vercel.app
APP_PASSWORD=ALM2026
PORT=3000
DATA_DIR=data
```

```powershell
npm install
npm start
```

`http://localhost:3000` son yenilənmənin vaxtını göstərir. Fayllar belə düzülür:

```
data\Dersler\01. <dərsin adı>\Orijinal\...
data\Dersler\01. <dərsin adı>\Izah\...
data\Dersler\01. <dərsin adı>\Test\...  (+ suallar.json)
data\Yekun sinaqlar\1. <ad>\...
data\catalog.json
```

`APP_PASSWORD` Vercel-dəki ilə eyni olmalıdır. Daima işləməsi üçün MapsPanel kimi xidmət (service) və ya Task Scheduler ilə başladın.

## Şirkət daxilində Vercel-siz (istəyə görə)

`.env`-də `SITE_URL` yazmasanız, server saytın özünü işlədir (fayllar `data`-da): `npm run build`, sonra `npm start`,
`http://172.25.60.81:3000`. Bu halda məlumat Vercel-dəkindən ayrıdır.

## Köhnə dərsləri köçürmək

Əsas səhifədə **Qovluqdan yüklə** → köhnə `DERSLER` qovluğunu seçin (və ya pəncərəyə sürüşdürün).
Hər `Ders_XX` bir dərs olur: `ORIGINAL`, `IZAH`, `TEST`, `BASLIQ.txt` dərsin adı. Eyni adlı Word və PDF varsa PDF götürülür.

## Fayllar

| Yer | Nə edir |
|---|---|
| `api/index.js` | Vercel funksiyası (bütün `/api/...` sorğuları) |
| `server/app.js` | giriş və API |
| `server/routes.js` | dərslər, sənədlər, testlər, 3 MB hissələrlə yükləmə / endirmə |
| `server/store.js` | Redis + Blob (Vercel-də), disk (öz serverdə) |
| `server/mirror.js` | öz serverdə nüsxə: hər dəqiqə saytdan çəkir |
| `server.js` | öz serveri başladır |
| `src/` | saytın özü (React) |

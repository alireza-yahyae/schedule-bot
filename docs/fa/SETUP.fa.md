# راهنمای نصب — مرحله ۱ (هسته‌ی ربات)

این ربات روی Cloudflare (رایگان) اجرا می‌شه. همه‌ی دستورها رو داخل **PowerShell** کپی و Enter کن.
اگه جایی ارور دیدی، آخر همین فایل «اشتباه‌های رایج» رو ببین.

## ۰) چیزهایی که لازم داری
- ویندوز ۱۱ (Wrangler رسماً ویندوز ۱۱ رو پشتیبانی می‌کنه)
- یه اکانت رایگان Cloudflare: https://dash.cloudflare.com/sign-up
- تلگرام

## ۱) نصب Node.js
از https://nodejs.org نسخه‌ی **LTS** رو دانلود و نصب کن (همه‌ی گزینه‌ها رو پیش‌فرض بذار). بعد یه PowerShell **جدید** باز کن و بزن:

```powershell
node --version
npm --version
```
اگه هر دو یه عدد نشون دادن، درسته.

## ۲) ساخت ربات در تلگرام
1. در تلگرام برو سراغ **@BotFather** و بزن `/newbot`.
2. یه اسم بده (مثلاً `Schedule Bot`) و بعد یه username که آخرش `bot` باشه.
3. BotFather یه **توکن** بهت می‌ده. این مثل رمز عبوره؛ به هیچ‌کس نده و جایی عمومی نذار.
4. ربات خودت رو باز کن و دکمه‌ی **Start** رو بزن (بدون این کار ربات نمی‌تونه بهت پیام بده).

## ۳) پیدا کردن ID تلگرام خودت
در تلگرام برو سراغ **@userinfobot** و Start بزن. یه عدد بهت می‌ده (مثل `123456789`). این **OWNER_ID** توئه؛ فقط همین آدم می‌تونه ربات رو کنترل کنه.

## ۴) باز کردن پوشه‌ی پروژه
فایل zip رو Extract کن (مثلاً روی Desktop). بعد در PowerShell:

```powershell
cd $HOME\Desktop\schedule-bot
```
(اگه جای دیگه‌ای Extract کردی، مسیر اون رو بنویس.)

## ۵) نصب ابزارها
```powershell
npm install
```

## ۶) ورود به Cloudflare
```powershell
npx wrangler login
```
مرورگر باز می‌شه؛ **Allow** رو بزن و برگرد به PowerShell.

## ۷) ساخت دیتابیس
```powershell
npx wrangler d1 create schedule-bot-db
```
توی خروجی یه خط `database_id = "..."` می‌بینی. اون عدد/کد بین گیومه‌ها رو کپی کن، فایل **wrangler.toml** رو با Notepad باز کن و به‌جای `PASTE-YOUR-DATABASE-ID-HERE` بذارش. ذخیره کن.

> اگه wrangler پرسید «می‌خوای خودم به فایل config اضافه کنم؟» جواب **n** (No) بده؛ ما خودمون اضافه کردیم.

## ۸) ساختن جدول‌ها و برنامه‌ی درسی
```powershell
npx wrangler d1 migrations apply schedule-bot-db --remote
```
وقتی پرسید، `y` بزن. این کار جدول‌ها، تنظیمات، متن‌های فارسی و درس‌های ترم رو می‌سازه.

## ۹) آپلود ربات
```powershell
npx wrangler deploy
```
اگه خواست یه subdomain برای workers.dev بسازی، یه اسم انگلیسی بده. آخر کار یه آدرس شبیه این چاپ می‌شه:
`https://schedule-bot.اسم-تو.workers.dev` — **این آدرس رو یادداشت کن**.

## ۱۰) ذخیره‌ی رمزها (Secrets)
اول یه رمز تصادفی برای WEBHOOK_SECRET بساز:
```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString('x2') }) -join ''
```
یه رشته‌ی طولانی چاپ می‌شه؛ کپیش کن (یه جا هم موقت نگه دار، توی مرحله‌ی ۱۱ دوباره لازمه).

حالا سه تا دستور زیر رو یکی‌یکی بزن. هر کدوم مقدار رو می‌پرسه؛ paste کن و Enter بزن:
```powershell
npx wrangler secret put BOT_TOKEN
npx wrangler secret put OWNER_ID
npx wrangler secret put WEBHOOK_SECRET
```
- `BOT_TOKEN` = توکن BotFather
- `OWNER_ID` = عدد @userinfobot
- `WEBHOOK_SECRET` = همون رشته‌ی تصادفی

## ۱۱) وصل کردن تلگرام به ربات (Webhook)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\set-webhook.ps1
```
سه تا چیز می‌پرسه: آدرس مرحله‌ی ۹، توکن، و WEBHOOK_SECRET (موقع تایپ چیزی نشون داده نمی‌شه، طبیعیه). باید `OK: the webhook is set.` ببینی.

## ۱۲) تست
1. آدرس `https://آدرس-تو.workers.dev/health` رو توی مرورگر باز کن. باید `"ok":true` ببینی. بعد از ۱–۲ دقیقه (گاهی تا ۱۵ دقیقه بعد از اولین deploy) صفحه رو Refresh کن؛ مقدار `scheduler_last_run_seconds_ago` باید کمتر از حدود ۶۰ بشه، یعنی زمان‌بند هر دقیقه کار می‌کنه.
2. توی تلگرام به رباتت `/start` بفرست. باید پیام خوش‌آمد بیاد.
3. `/today` ، `/week` ، `/courses` رو امتحان کن.
4. `/test` رو بزن. حدود ۲–۳ دقیقه بعد پیام «الان وقت کلاسه» با دکمه‌ها میاد. دکمه‌ها رو امتحان کن (جزئیات امتحان کردن در جواب چت هست).

## تنظیم‌های ساده (بدون برنامه‌نویسی)
هر ۵ دقیقه یادآوری تکراری می‌ده. برای مثال تغییرش به ۳ دقیقه:
```powershell
npx wrangler d1 execute schedule-bot-db --remote --command "UPDATE settings SET value='3' WHERE key='nag_interval_min'"
```
تنظیم‌های دیگه: `max_nags` (حداکثر تعداد یادآوری تکراری)، `snooze_min` (دقیقه‌ی دکمه‌ی «بعداً»)، `offsets` (مثلاً `15,10` یعنی ۱۵ و ۱۰ دقیقه قبل از کلاس)، `timezone`.
متن همه‌ی پیام‌ها و دکمه‌ها هم توی جدول `bot_texts` ذخیره شده و قابل ویرایشه (در مرحله‌ی ۳ از داخل Mini App هم می‌تونی عوض کنی).

## اشتباه‌های رایج
| مشکل | راه‌حل |
|---|---|
| `npm install` ارور ERESOLVE درباره‌ی workers-types می‌ده | توی `package.json` عبارت `"@cloudflare/workers-types": "^4.0.0"` رو به `"^5.0.0"` تغییر بده و دوباره `npm install` بزن (نسخه‌ی جدید zip این رو دارد) |
| deploy ارور می‌ده درباره‌ی database_id | توی `wrangler.toml` هنوز `PASTE-YOUR-DATABASE-ID-HERE` مونده؛ مرحله‌ی ۷ رو انجام بده |
| ربات جواب نمی‌ده | ۱) توی ربات Start زده باشی ۲) `OWNER_ID` درست باشه (عدد @userinfobot) ۳) مرحله‌ی ۱۱ رو دوباره اجرا کن و `last_error_message` رو بخون |
| `last_error_message` می‌گه 403 | `WEBHOOK_SECRET` توی Cloudflare با چیزی که توی اسکریپت زدی یکی نیست. هر دو رو دوباره با یک مقدار ست کن |
| اسکریپت set-webhook اجرا نمی‌شه («running scripts is disabled») | دقیقاً با همون دستور مرحله‌ی ۱۱ اجراش کن (`-ExecutionPolicy Bypass`) |
| یادآوری‌ها نمیاد | `/health` رو ببین؛ اگه `scheduler_last_run_seconds_ago` عدد نیست، چند دقیقه صبر کن. همچنین چک کن `/pause` فعال نباشه (`/resume`) |
| ساعت‌ها اشتباهه | مقدار `timezone` توی جدول settings باید `Asia/Tehran` باشه |
| توکن رو جایی لو دادی | توی BotFather بزن `/revoke` و توکن جدید رو دوباره با `npx wrangler secret put BOT_TOKEN` ذخیره کن |

## نکته‌ی امنیتی برای GitHub Desktop
- اگه پوشه رو توی GitHub Desktop می‌ذاری، حتماً گزینه‌ی **Keep this code private** رو تیک بزن (برنامه‌ی درسی‌ات توی `migrations/0002_seed.sql` هست).
- رمزها (توکن و ...) هیچ‌جا توی فایل‌ها نیستن؛ فقط توی Cloudflare ذخیره شدن. هیچ‌وقت توکن رو توی فایل ننویس.

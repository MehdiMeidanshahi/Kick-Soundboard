# Kick Soundboard

**1-Click Kick channel point rewards → audio playback on your Windows stream PC.**

Kick Soundboard is a local Windows desktop application that listens for approved Kick channel point reward redemptions and plays your assigned audio files in real time through your sound card into OBS.

[![Platform: Windows x64](https://img.shields.io/badge/Platform-Windows%20x64-0078D6.svg)](https://github.com/MehdiMeidanshahi/Kick-Soundboard/releases)
[![Version: v0.2.0](https://img.shields.io/badge/Version-v0.2.0-53FC18.svg)](https://github.com/MehdiMeidanshahi/Kick-Soundboard/releases/latest)
[![Kick OAuth: 1--Click Bridge](https://img.shields.io/badge/OAuth-1--Click%20Bridge-brightgreen.svg)](https://github.com/MehdiMeidanshahi/Kick-Soundboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Languages / زبان‌ها:** [English](#english) · [فارسی](#فارسی)  |  [GitHub Releases](https://github.com/MehdiMeidanshahi/Kick-Soundboard/releases)

---

## English

### Quick Navigation
- [⚡ Quick Install (For Streamers)](#-quick-install-for-streamers)
- [📸 Screenshots](#-screenshots)
- [🛠️ Detailed Setup (For Developers)](#️-detailed-setup-for-developers)
- [🔒 Privacy & Security](#-privacy--security)
- [⚙️ Technical Details](#️-technical-details)

---

### ⚡ Quick Install (For Streamers)

No developer app creation, manual Client ID/Secret entry, or localhost redirect setup is needed. You can connect your Kick account in 1 click!

#### 1. Download & Install
1. Go to the [**Latest GitHub Releases**](https://github.com/MehdiMeidanshahi/Kick-Soundboard/releases/latest).
2. Download **`Kick-Soundboard-Setup-0.2.0.exe`**.
3. Run the installer (it creates desktop and Start Menu shortcuts and installs cleanly under your Windows user account).

> [!NOTE]
> As an independent open-source release without an expensive corporate code-signing certificate, Windows SmartScreen may show an *"Unknown publisher"* prompt on first launch. Click **More info** → **Run anyway**. You can verify the published SHA-256 checksum on the Releases page anytime.

#### 2. Connect Kick with 1 Click
1. Open **Kick Soundboard** and click the green **Connect Kick** button.
2. Your default web browser will open Kick's authorization screen.
3. Log in to your Kick streamer account (if not already logged in) and click **Approve**.
4. Your browser will prompt: *"Open Kick Soundboard?"* Click **Open**.
5. The app automatically catches your secure session tokens via deep-link (`kick-soundboard://auth`).
6. The status dot turns green (**Connected**), and all your channel rewards load automatically!

#### 3. Assign Sounds & Configure
1. For each reward, click **Choose sound** and select an audio file from your computer (`.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`, `.m4a`).
2. Click **Test** to preview the sound at your chosen volume.
3. Optionally set a **Cooldown (sec)** so spamming a reward doesn't overwhelm your stream.
4. Adjust **Master volume** or individual **Sound volume** as needed.

#### 4. Route into OBS
- Kick Soundboard plays audio through your selected Windows audio output device (configured in **Settings** → **Audio output**).
- In OBS Studio, simply ensure your **Desktop Audio** or an **Audio Output Capture** source captures that device.

---

### 📸 Screenshots

#### Main Soundboard & Reward Mapping
![Kick Soundboard overview with rewards list, volume controls, queue controls, and redemption history](docs/screenshots/app-overview.png)
*Live stream readiness status, channel rewards with custom sounds, per-reward cooldowns, master volume, and redemption queue.*

#### Connection & Device Settings
![Kick Soundboard settings dialog showing Kick account status, audio output picker, and update checker](docs/screenshots/connection-settings.png)
*1-click Kick connection status, Windows output device selection, and automatic update checker.*

---

### 🛠️ Detailed Setup (For Developers)

If you are a developer looking to contribute, audit the code, or run a self-hosted OAuth bridge:

#### Architecture Overview
- **Electron Desktop Client (`src/`)**: Built on Electron 44 with Chromium sandboxing, context isolation, and secure IPC.
- **Local Storage (`safeStorage`)**: Authentication tokens are encrypted on disk via Windows DPAPI before being saved to `%APPDATA%/kick-soundboard-local`.
- **Stateless Serverless Bridge (`api/` or `bridge/`)**: A zero-dependency Vercel serverless function suite implementing OAuth 2.1 authorization code flow with PKCE (SHA-256 code challenge) and custom protocol deep-linking (`kick-soundboard://auth`).

#### Prerequisites
- Windows 10/11 x64
- Node.js 20.x or newer
- [pnpm](https://pnpm.io/) 9.x or newer

#### 1. Clone & Install
```powershell
git clone https://github.com/MehdiMeidanshahi/Kick-Soundboard.git
cd Kick-Soundboard
pnpm install
```

#### 2. Run in Development Mode
```powershell
npm start
```

#### 3. Run Automated Tests
```powershell
npm test
```
*Executes unit tests covering deep-link parsing, FIFO redemption queueing, token lifecycle handling, exponential backoff, and version comparisons.*

#### 4. Package Windows Executables
```powershell
npm run build:win
```
*Generates the standalone executable under `release/win-unpacked/` and the NSIS installer `release/Kick-Soundboard-Setup-0.2.0.exe`.*

#### 5. Self-Hosting the Vercel OAuth Bridge (Optional)
If you prefer hosting your own Kick Developer credentials:
1. Create an application in [Kick Developer Portal](https://kick.com/dashboard/developer):
   - **Redirect URL:** `https://<your-vercel-domain>.vercel.app/api/auth/callback`
   - **Scopes:** `user:read`, `channel:rewards:read`, `channel:rewards:write`, `events:subscribe`, `kicks:read`
2. Deploy the root repository (or the `bridge/` folder) to [Vercel](https://vercel.com).
3. In Vercel Project Settings → **Environment Variables**, add:
   - `KICK_CLIENT_ID`: Your Kick application Client ID.
   - `KICK_CLIENT_SECRET`: Your Kick application Client Secret.
4. Set the `KICK_BRIDGE_URL` environment variable or specify your custom URL in the app's `DEFAULT_BRIDGE_URL`.

---

### 🔒 Privacy & Security

- **Zero Project Servers**: Your streamer tokens and channel data are never stored on any third-party database.
- **Windows DPAPI Encryption**: Tokens are encrypted at rest using Windows Data Protection API (`safeStorage`).
- **Sandboxed Execution**: The Electron renderer runs with `nodeIntegration: false`, `contextIsolation: true`, and a strict Content Security Policy.
- **Stateless OAuth Bridge**: The Vercel bridge is completely stateless; it stores no logs, databases, or user identities—it exchanges the PKCE code and deep-links directly back into your PC.

---

### ⚙️ Technical Details

- **Polling Engine**: Actively polls Kick's Channel Rewards API every 10 seconds.
- **Approval-First Playback**: Sounds only trigger once a redemption is in `accepted` status. Pending redemptions stay silent until approved in Kick's moderation dashboard.
- **Deep-Link Protocol**: Registers Windows protocol client `kick-soundboard://` to pass authorization tokens directly into the running instance via `second-instance` IPC.

---

## فارسی

### دسترسی سریع
- [⚡ راه‌اندازی سریع (ویژهٔ استریمرها)](#-راه‌اندازی-سریع-ویژهٔ-استریمرها)
- [📸 تصاویر برنامه](#-تصاویر-برنامه)
- [🛠️ راهنمای فنی و توسعه (ویژهٔ برنامه‌نویسان)](#️-راهنمای-فنی-و-توسعه-ویژهٔ-برنامه‌نویسان)
- [🔒 حریم خصوصی و امنیت](#-حریم-خصوصی-و-امنیت)

---

### ⚡ راه‌اندازی سریع (ویژهٔ استریمرها)

بدون نیاز به ساخت برنامه در پنل توسعه‌دهندگان، بدون نیاز به کپی کردن Client ID یا Client Secret؛ اتصال به کیک تنها با ۱ کلیک انجام می‌شود!

#### ۱. دریافت و نصب برنامه
۱. به [**صفحهٔ نسخه‌های منتشرشده در GitHub**](https://github.com/MehdiMeidanshahi/Kick-Soundboard/releases/latest) بروید.
۲. فایل نصب **`Kick-Soundboard-Setup-0.2.0.exe`** را دانلود کنید.
۳. فایل را اجرا و نصب کنید (میان‌بر برنامه روی دسکتاپ و منوی استارت ایجاد می‌شود).

> [!NOTE]
> چون برنامه متن‌باز است و گواهی تجاری گران‌قیمت کد را ندارد، ممکن است ویندوز SmartScreen هشدار *"Unknown publisher"* نشان دهد. کافی است روی **More info** و سپس **Run anyway** کلیک کنید.

#### ۲. اتصال به کیک با یک کلیک
۱. برنامهٔ **Kick Soundboard** را باز کرده و دکمهٔ سبز رنگ **Connect Kick** را بزنید.
۲. مرورگر شما باز شده و صفحهٔ تأیید کیک را نمایش می‌دهد.
۳. وارد حساب کاربری کیک خود شوید و دکمهٔ **Approve** را انتخاب کنید.
۴. مرورگر از شما اجازهٔ بازگشت به برنامه را می‌خواهد (*"Open Kick Soundboard?"*)؛ آن را تأیید کنید.
۵. وضعیت به **Connected** تغییر یافته و پاداش‌های کانال شما بلافاصله بارگذاری می‌شوند!

#### ۳. تنظیم صداها و استریم
۱. روبه‌روی هر پاداش، دکمهٔ **Choose sound** را زده و یک فایل صوتی از کامپیوترتان (`.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`) انتخاب کنید.
۲. با دکمهٔ **Test** بلندی صدا را بسنجید.
۳. در صورت تمایل، وقفه برحسب ثانیه (**Cooldown**) تنظیم کنید تا از پخش پشت‌سر‌هم صدا جلوگیری شود.
۴. در نرم‌افزار OBS خروجی صدای سیستم (Desktop Audio) را فعال کنید تا بینندگان صدای پاداش‌ها را هنگام استریم بشنوند.

---

### 📸 تصاویر برنامه

#### نمای کلی و تنظیم صدای پاداش‌ها
![نمای کلی نرم‌افزار کیک ساندبورد با فهرست جوایز و تاریخچه](docs/screenshots/app-overview.png)
*بررسی آمادگی استریم، نگاشت صداها، کنترل بلندی صدا، تنظیم وقفه و صف بازخریدها.*

#### تنظیمات اتصال و دستگاه خروجی
![پنجرهٔ تنظیمات کیک ساندبورد](docs/screenshots/connection-settings.png)
*وضعیت اتصال ۱ کلیک کیک، انتخاب دستگاه خروجی صدا در ویندوز و بررسی خودکار نسخه‌های جدید.*

---

### 🛠️ راهنمای فنی و توسعه (ویژهٔ برنامه‌نویسان)

#### معماری برنامه
- **بخش کلاینت دسکتاپ (`src/`)**: بر پایهٔ Electron 44 با امنیت ایزوله‌سازی Context و Sandbox.
- **حافظهٔ امن محلی (`safeStorage`)**: توکن‌ها با استفاده از الگوریتم DPAPI ویندوز به‌صورت رمزنگاری‌شده روی دیسک ذخیره می‌شوند.
- **پل ارتباطی OAuth سرورلس (`api/` و `bridge/`)**: توابع سرورلس Vercel بدون وابستگی، پیاده‌سازی OAuth 2.1 به‌همراه الگوریتم PKCE S256 و ارسال توکن به دسکتاپ از طریق پروتکل پیوند عمیق `kick-soundboard://auth`.

#### نیازمندی‌ها
- ویندوز ۱۰ یا ۱۱ (۶۴ بیتی)
- Node.js نسخهٔ ۲۰ به بالا
- pnpm نسخهٔ ۹ به بالا

#### ۱. دریافت کد و نصب وابستگی‌ها
```powershell
git clone https://github.com/MehdiMeidanshahi/Kick-Soundboard.git
cd Kick-Soundboard
pnpm install
```

#### ۲. اجرای برنامه در حالت توسعه
```powershell
npm start
```

#### ۳. اجرای آزمون‌های خودکار
```powershell
npm test
```

#### ۴. ساخت فایل نصب ویندوز
```powershell
npm run build:win
```
*فایل نصبی نهایی در مسیر `release/Kick-Soundboard-Setup-0.2.0.exe` ساخته خواهد شد.*

---

### 🔒 حریم خصوصی و امنیت

- **بدون سرور میانی**: توکن‌ها و فایل‌های صوتی شما به هیچ سرور ذخیره‌سازی واسطه‌ای ارسال نمی‌شوند.
- **رمزنگاری DPAPI ویندوز**: اطلاعات ذخیره‌شده تنها توسط حساب کاربری ویندوز شما قابل رمزگشایی هستند.
- **بررسی هوشمند وضعیت بازخرید**: صداها تنها پس از تأیید در کیک پخش می‌شوند و درخواست‌های رد شده یا در انتظار به هیچ وجه صدا پخش نمی‌کنند.

# Kick Soundboard - Sound Pad & Stream Deck Integration Guide
# راهنمای ساندپد و اتصال به استریم دک در کیک ساندبورد

**Languages / زبان‌ها:** [English](#english) · [فارسی](#فارسی)

---

## English

### Table of Contents
1. [Overview](#1-overview)
2. [Sound Pad Features](#2-sound-pad-features)
   - [⚡ Quick Sampler & Retrigger Engine](#-quick-sampler--retrigger-engine)
   - [🗗 Floating Pop-out Window](#-floating-pop-out-window)
   - [⌨️ Global Hotkeys (Keybinds)](#️-global-hotkeys-keybinds)
   - [📱 Web Sound Pad & Touchscreen Deck Mode](#-web-sound-pad--touchscreen-deck-mode)
3. [Elgato Stream Deck Integration](#3-elgato-stream-deck-integration)
   - [Method 1: Native "Website" Action (Recommended)](#method-1-native-website-action-recommended)
   - [Method 2: Custom Protocol URI ("System -> Open")](#method-2-custom-protocol-uri-system---open)
   - [Method 3: Hardware Hotkeys](#method-3-hardware-hotkeys)
   - [⏹️ Panic Stop Key Setup](#️-panic-stop-key-setup)
4. [Third-Party Decks (Touch Portal, Loupedeck, Macro Deck, Streamer.bot)](#4-third-party-decks-touch-portal-loupedeck-macro-deck-streamerbot)
5. [Local HTTP API & Endpoints Reference](#5-local-http-api--endpoints-reference)

---

### 1. Overview

Kick Soundboard includes a dedicated **Streamer Sound Pad** designed for low-latency live broadcast sound effects, meme clips, and viewer engagement. It operates simultaneously with automated Kick channel point reward alerts and can be controlled via:
- The desktop graphical launchpad in the main window
- The floating, always-on-top Pop-out mini window
- Global Windows keyboard hotkeys (even while gaming in full screen)
- Physical hardware devices such as **Elgato Stream Deck**, **Loupedeck**, **Touch Portal**, and **Macro Deck**
- The standalone touch-friendly Web App on phones, tablets, or iPads

---

### 2. Sound Pad Features

#### ⚡ Quick Sampler & Retrigger Engine
- **Sampler Retriggering**: When rapidly pressing or spamming a pad, playback restarts instantly from the beginning (`currentTime = 0`). Overlapping sounds or duplicate audio elements are prevented.
- **Visual Feedback**: Active pads display animated equalizer sound waves and a dedicated stop button.
- **Categorized Sections**: Standalone manual sampler sounds (`⚡ Sound Pad`) and automated viewer reward sounds (`🪙 Channel Points`) are kept in separate grids for clarity.

#### 🗗 Floating Pop-out Window
- Click the **🗗 Pop out** button in the Sound Pad toolbar.
- Opens a dedicated, compact mini window (`Kick Sound Pad`).
- Set to **Always on Top** by default, allowing it to float over OBS Studio, chat windows, or game windows.

#### ⌨️ Global Hotkeys (Keybinds)
You can assign global hotkeys to any sound tile so you can trigger sounds during live gameplay without switching windows:
1. Hover or click the **⌨️ +Key** badge on any sound pad tile.
2. The **Assign Hotkey** dialog will appear.
3. Press any key combination on your keyboard (e.g. `F1`–`F24`, `Numpad 0`–`9`, `Ctrl+Shift+1`, `Alt+F8`).
4. Click **Save**.
5. The shortcut is registered globally in Windows via Electron's `globalShortcut` engine.

> [!TIP]
> To remove a hotkey, open the dialog and click **Clear Hotkey**.

#### 📱 Web Sound Pad & Touchscreen Deck Mode
Turn any smartphone, tablet, iPad, or secondary browser into a wireless Stream Deck:
1. Click **🌐 Web Sound Pad** in the toolbar (or visit `http://localhost:9000/soundpad.html` in your browser).
2. The link is automatically copied to your clipboard with your local session token.
3. Click the **🎛️ DECK MODE** button in the top bar to enter full-screen touch mode.
4. Pads transform into large 3D tactile buttons with tactile push animations and haptic vibration (`navigator.vibrate`) on touch devices.

---

### 3. Elgato Stream Deck Integration

Kick Soundboard offers seamless, zero-plugin integration with all Elgato Stream Deck hardware (Stream Deck Mini, MK.2, XL, Plus, and Mobile).

#### Method 1: Native "Website" Action (Recommended)
This method executes background HTTP requests without opening any browser tabs or stealing focus from games.

1. Open the **Elgato Stream Deck** desktop software.
2. In the right-hand actions list, search for **System** → **Website**.
3. Drag the **Website** action onto your chosen Stream Deck key.
4. In Kick Soundboard, click the **🎛️ Stream Deck** button in the Sound Pad toolbar.
5. Next to the sound you want, click **Copy Trigger URL**. The URL has the format:
   ```text
   http://localhost:9000/streamdeck/trigger/<sound_id>
   ```
6. In the Stream Deck software, paste this into the **URL** field.
7. **Crucial:** Check the box labeled **"GET request in background"**.
8. Press the key on your Stream Deck. The sound will play instantly through Kick Soundboard!

#### Method 2: Custom Protocol URI ("System -> Open")
1. In the Elgato Stream Deck software, drag the **System** → **Open** action onto a key.
2. In Kick Soundboard's Stream Deck dialog, click **Copy Custom URI** next to the sound. The URI format is:
   ```text
   kick-soundboard://trigger/<sound_id>
   ```
3. Paste the URI into the **App / File** field in the Stream Deck software.
4. When pressed, Kick Soundboard intercepts the request without stealing window focus.

#### Method 3: Hardware Hotkeys
1. Assign a hotkey to the sound in Kick Soundboard (e.g. `F13`–`F24` or `Ctrl+Alt+1`).
2. In Elgato Stream Deck, add a **System** → **Hotkey** action to a key and assign the identical key combination.

#### ⏹️ Panic Stop Key Setup
To immediately silence all playing audio (queue redemptions, preview tests, and soundpad clips):
1. In Elgato Stream Deck, add a **System** → **Website** action.
2. Set the URL to:
   ```text
   http://localhost:9000/streamdeck/stop-all
   ```
3. Check **"GET request in background"**.
4. Pressing this key will immediately silence all audio across your PC.

---

### 4. Third-Party Decks (Touch Portal, Loupedeck, Macro Deck, Streamer.bot)

Any software or hardware capable of making HTTP requests or opening custom protocol links can trigger Kick Soundboard sounds:

- **Touch Portal**: Add an `HTTP: GET Request` action and paste `http://localhost:9000/streamdeck/trigger/<sound_id>`.
- **Loupedeck**: Create an action with the Custom URL / Webhook trigger.
- **Streamer.bot**: Use the `Sub-Actions -> Fetch URL` action with HTTP GET.
- **Macro Deck**: Use the `Web Request` action.

---

### 5. Local HTTP API & Endpoints Reference

The Kick Soundboard local daemon runs on port `9000` (`http://localhost:9000`).

| Endpoint | Method | Auth Required | Description |
| :--- | :---: | :---: | :--- |
| `/streamdeck/trigger/:id` | `GET` / `POST` | No | Instantly triggers the soundpad audio for the specified ID. |
| `/streamdeck/stop-all` | `GET` / `POST` | No | Panic stop: silences all queue, preview, and sampler audio. |
| `/streamdeck/actions` | `GET` | No | Returns JSON array of all registered sounds, trigger URLs, protocol links, and assigned hotkeys. |
| `/api/trigger` | `POST` | Yes (`x-kick-app-session`) | Triggers playback via JSON payload `{"rewardId": "id"}`. |
| `/api/stop-all` | `POST` | Yes (`x-kick-app-session`) | Silences all audio via authenticated POST request. |

---

## فارسی

### فهرست مطالب
۱. [نمای کلی](#۱-نمای-کلی)
۲. [قابلیت‌های ساندپد](#۲-قابلیت‌های-ساندپد)
   - [⚡ سمپلر سریع با شلیک آنی](#-سمپلر-سریع-با-شلیک-آنی)
   - [🗗 پنجرهٔ شناور مستقل (Pop-out)](#-پنجرهٔ-شناور-مستقل-pop-out)
   - [⌨️ کلیدهای میانبر سراسری (Hotkeys)](#️-کلیدهای-میانبر-سراسری-hotkeys)
   - [📱 وب‌اپ لمسی و حالت دک](#-وب‌اپ-لمسی-و-حالت-دک)
۳. [راهنمای اتصال به استریم دک الگاتو (Elgato Stream Deck)](#۳-راهنمای-اتصال-به-استریم-دک-الگاتو-elgato-stream-deck)
   - [روش اول: دستور Website در پس‌زمینه (پیشنهادی)](#روش-اول-دستور-website-در-پس‌زمینه-پیشنهادی)
   - [روش دوم: پروتکل اختصاصی (System -> Open)](#روش-دوم-پروتکل-اختصاصی-system---open)
   - [روش سوم: کلیدهای میانبر سخت‌افزاری](#روش-سوم-کلیدهای-میانبر-سخت‌افزاری)
   - [⏹️ راه‌اندازی کلید توقف اضطراری (Panic Stop)](#️-راه‌اندازی-کلید-توقف-اضطراری-panic-stop)
۴. [اتصال به تاچ‌پورتال، لوپ‌دک و ماکرو دک](#۴-اتصال-به-تاچ‌پورتال-لوپ‌دک-و-ماکرو-دک)
۵. [مرجع API و وب‌سرویس محلی](#۵-مرجع-api-و-وب‌سرویس-محلی)

---

### ۱. نمای کلی

نرم‌افزار کیک ساندبورد مجهز به یک **ساندپد اختصاصی استریمر (Sound Pad)** است که برای پخش آنی میم‌ها، افکت‌های صوتی و تعامل با بینندگان طراحی شده است. این بخش به‌صورت مستقل در کنار سیستم خودکار پاداش‌های امتیاز کیک کار می‌کند و از طریق راه‌های زیر قابل کنترل است:
- محیط کاربری دسکتاپ برنامه
- پنجرهٔ شناور و همیشه بالا (Always on Top)
- کلیدهای میانبر سراسری کیبورد در ویندوز (حتی درون بازی‌های تمام‌صفحه بدون نیاز به Alt+Tab)
- دستگاه‌های فیزیکی مانند **Elgato Stream Deck**، **Loupedeck**، **Touch Portal** و **Macro Deck**
- وب‌اپلیکیشن لمسی روی گوشی، تبلت یا آیپد

---

### ۲. قابلیت‌های ساندپد

#### ⚡ سمپلر سریع با شلیک آنی
- **شلیک مجدد آنی (Retrigger)**: با فشردن یا اسپم کردن سریع هر پد صوتی، صدا بدون ایجاد صدای تکراریِ همزمان، از میلی‌ثانیهٔ صفر (`currentTime = 0`) مجدداً پخش می‌شود.
- **بازخورد تصویری**: پدهای در حال پخش دارای اکولایزر متحرک و دکمهٔ توقف سریع هستند.
- **دسته‌بندی شفاف**: پدهای دستی استریمر (`⚡ ساند پد`) از صداهای خودکار امتیاز کیک (`🪙 امتیاز کانال`) تفکیک شده‌اند.

#### 🗗 پنجرهٔ شناور مستقل (Pop-out)
- روی دکمهٔ **🗗 Pop out** در نوار ابزار ساندپد کلیک کنید.
- پنجره‌ای فشرده و اختصاصی باز می‌شود که به‌طور پیش‌فرض **همیشه روی سایر برنامه‌ها (Always on Top)** قرار می‌گیرد تا بتوانید آن را بالای بازی یا OBS نگه دارید.

#### ⌨️ کلیدهای میانبر سراسری (Hotkeys)
می‌توانید برای هر پد یک کلید میانبر دلخواه تعیین کنید:
۱. روی دکمهٔ **⌨️ +Key** پد مورد نظر کلیک کنید.
۲. پنجرهٔ تعیین کلید میانبر باز می‌شود.
۳. کلید ترکیبی مورد نظر را روی کیبورد فشار دهید (مانند `F1` تا `F24`، کلیدهای اعداد Numpad، یا ترکیبات `Ctrl+Shift+1`).
۴. روی دکمهٔ **ذخیره** کلیک کنید.
۵. این کلید به‌صورت سراسری در ویندوز ثبت شده و حتی هنگام بازی تمام‌صفحه نیز کار می‌کند.

#### 📱 وب‌اپ لمسی و حالت دک
تبدیل گوشی، تبلت یا آیپد به یک استریم دک فیزیکی و بی‌سیم:
۱. در نوار ابزار روی **🌐 Web Sound Pad** کلیک کنید (یا در مرورگر آدرس `http://localhost:9000/soundpad.html` را باز کنید).
۲. لینک با توکن امنیتی به‌صورت خودکار در حافظه کپی می‌شود.
۳. در وب‌اپ، دکمهٔ **🎛️ DECK MODE** را بزنید تا برنامه تمام‌صفحه شود.
۴. کلیدها به دکمه‌های بزرگ لمسی با انیمیشن فشردن سه‌بعدی و ویبرهٔ لمسی تبدیل می‌شوند.

---

### ۳. راهنمای اتصال به استریم دک الگاتو (Elgato Stream Deck)

#### روش اول: دستور Website در پس‌زمینه (پیشنهادی)
سریع‌ترین و بی‌دردسرترین روش بدون نیاز به نصب هیچ‌گونه افزونه:
۱. نرم‌افزار **Elgato Stream Deck** را باز کنید.
۲. از منوی سمت راست، دستور **System** → **Website** را روی دکمهٔ دلخواه بکشید.
۳. در برنامهٔ کیک ساندبورد، روی دکمهٔ **🎛️ Stream Deck** در نوار ابزار ساندپد کلیک کنید.
۴. روبه‌روی صدای دلخواه، دکمهٔ **کپی آدرس اجرا (Copy Trigger URL)** را بزنید. ساختار آدرس به این شکل است:
   ```text
   http://localhost:9000/streamdeck/trigger/<sound_id>
   ```
۵. این آدرس را داخل فیلد **URL** در نرم‌افزار استریم دک جای‌گذاری کنید.
۶. **بسیار مهم:** تیک گزینهٔ **"GET request in background"** را فعال کنید.
۷. کلید استریم دک را فشار دهید؛ صدا بلافاصله بدون باز شدن مرورگر در استریم پخش می‌شود!

#### روش دوم: پروتکل اختصاصی (System -> Open)
۱. در استریم دک، دستور **System** → **Open** را انتخاب کنید.
۲. از دیالوگ برنامه، دکمهٔ **کپی پروتکل اختصاصی (Copy Custom URI)** را بزنید:
   ```text
   kick-soundboard://trigger/<sound_id>
   ```
۳. آن را در فیلد App/File قرار دهید. این دستور بدون خارج کردن شما از محیط بازی صدا را اجرا می‌کند.

#### روش سوم: کلیدهای میانبر سخت‌افزاری
۱. در کیک ساندبورد برای صدا میانبر تعریف کنید (مانند `F13` تا `F24`).
۲. در استریم دک، دستور **System** → **Hotkey** را اضافه کرده و همان کلید را انتخاب کنید.

#### ⏹️ راه‌اندازی کلید توقف اضطراری (Panic Stop)
برای قطع فوری تمام صداهای در حال پخش (صف پاداش‌ها، پیش‌نمایش و ساندپد):
۱. در استریم دک یک دستور **System** → **Website** اضافه کنید.
۲. آدرس زیر را در آن قرار دهید:
   ```text
   http://localhost:9000/streamdeck/stop-all
   ```
۳. گزینهٔ **"GET request in background"** را تیک بزنید.

---

### ۴. اتصال به تاچ‌پورتال، لوپ‌دک و ماکرو دک

هر نرم‌افزار یا سخت‌افزاری که توانایی ارسال درخواست HTTP GET داشته باشد می‌تواند کیک ساندبورد را کنترل کند:
- **Touch Portal**: اضافه کردن اکشن `HTTP: GET Request` با آدرس `http://localhost:9000/streamdeck/trigger/<sound_id>`.
- **Loupedeck**: استفاده از وب‌هوک یا Custom URL.
- **Streamer.bot**: استفاده از دستور `Sub-Actions -> Fetch URL` با متد GET.
- **Macro Deck**: استفاده از اکشن Web Request.

---

### ۵. مرجع API و وب‌سرویس محلی

سرویس محلی کیک ساندبورد روی پورت `9000` (`http://localhost:9000`) اجرا می‌شود:

| مسیر وب‌سرویس | متد | احراز هویت | توضیحات |
| :--- | :---: | :---: | :--- |
| `/streamdeck/trigger/:id` | `GET` / `POST` | ندارد | پخش فوری صدای مشخص‌شده با شناسهٔ صوتی. |
| `/streamdeck/stop-all` | `GET` / `POST` | ندارد | توقف اضطراری و قطع تمام صداهای در حال پخش. |
| `/streamdeck/actions` | `GET` | ندارد | دریافت لیست تمام صداها، آدرس‌های تریگر و کلیدهای میانبر به‌صورت JSON. |
| `/api/trigger` | `POST` | دارد (`x-kick-app-session`) | ارسال درخواست پخش صدا از طریق JSON داخلی. |
| `/api/stop-all` | `POST` | دارد (`x-kick-app-session`) | ارسال درخواست توقف اضطراری صدا از طریق وب‌اپ. |

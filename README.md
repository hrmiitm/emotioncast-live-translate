# EmotionCast Desktop Studio 🎙️🌐

Real-time, two-way live audio translation studio for Google Meet and Gemini Live API. Speak in your language and meeting participants hear their language; hear incoming speech translated live into your headphones.

---

## 🚀 Quick Setup & Launch

Get up and running in seconds using your preferred method:

### 1. Launch the App

#### 🐧 Linux (AppImage)
Download the standalone AppImage, make it executable, and launch:
```bash
chmod +x EmotionCast-1.0.0.AppImage
./EmotionCast-1.0.0.AppImage
```

#### 📦 NPM / Node (Cross-Platform)
Run directly from source with Node.js (v20+):
```bash
git clone <repo-url> && cd desktop-app
npm install
npm start
```
*Or execute directly via NPX:*
```bash
npx emotioncast-desktop
```

#### 🍏 macOS (Binary / DMG)
1. Download `EmotionCast-1.0.0.dmg`.
2. Open the DMG and drag **EmotionCast** to your **Applications** folder.
3. Launch **EmotionCast** from Applications or Spotlight.

---

### 2. Add API Key

1. In section **01 Connection**:
   - Provider: **Gemini · Official** (or LLM Foundry)
   - Paste your API key from [Google AI Studio](https://aistudio.google.com/apikey).
   - Check **Remember securely** (safely encrypted using OS keyring via Electron safeStorage).
   - Click **Set key**.
2. Click **Check live connection** to verify your endpoint and API key.

---

### 3. Start Virtual Audio Routing (Google Meet)

1. In section **04 Google Meet audio routing setup**:
   - Click **⚡ Auto-Route Everything** *(creates PulseAudio/PipeWire virtual microphone & speaker channels on Linux)*.
   - *(macOS users: install [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole); Windows users: install [VB-CABLE](https://vb-audio.com/Cable/))*.
2. Open **Google Meet** in your browser (`meet.google.com` → **Settings** → **Audio**):
   - **Microphone**: Select `EmotionCast (Google Meet Microphone)`
   - **Speaker**: Select `EmotionCast (Google Meet Speaker)`
3. In EmotionCast channels above:
   - **Speak Channel (02 You → Meet)**:
     - Input: **Your Physical Microphone**
     - Output: `★ EmotionCast - To Meet Microphone`
   - **Listen Channel (03 Meet → You)**:
     - Input: `★ EmotionCast - From Meet Speaker`
     - Output: **Your Real Headphones**

---

### 4. Choose Languages & Start!

1. **Speak Channel (02 You → Meet)**:
   - Input Language: Select your language (e.g., *English*).
   - Target Language: Select the translation language for meeting attendees (e.g., *Spanish*, *Hindi*, *Japanese*, *French*, etc.).
   - Choose your preferred AI vocal character and tone style.
   - Click **▶ Start**. Your voice is now translated live into Google Meet!
2. **Listen Channel (03 Meet → You)**:
   - Input Language: Select what meeting participants speak (or *Auto-detect*).
   - Target Language: Select your native language (e.g., *English*).
   - Click **▶ Start**. Live incoming speech from the meeting is translated directly into your headphones!

---

## 🎨 Theme & UI Scale Controls

- **Dark & White Mode**: Built-in theme switcher in the sidebar:
  - **🌓 Auto (System default)**: Follows your OS dark/light mode automatically.
  - **☀️ Light**: Clean, high-contrast white mode for bright environments.
  - **🌙 Dark**: Low-glare dark studio aesthetic.
- **Font Size & UI Zoom**: Click **A+** / **A−** or press `Ctrl +` / `Ctrl -` (reset with `Ctrl 0` or **↺**) to scale the studio typography and layout for optimal legibility.
- **⚡ Latency & Session Tuning**: Tune audio send intervals (20ms–80ms), playback buffer (60ms), max queued audio (1500ms), and silence timeout with one-click presets (`Ultra low latency`, `Low latency`, `Balanced`, `High stability`). Uses fast WebSocket streaming with `TCP_NODELAY` enabled and live token/spend estimation.

---

## 🛠️ Build & Packaging

Build production distribution packages:

```bash
# Test
npm test

# Build Linux AppImage
npm run dist:linux

# Build macOS DMG & ZIP binaries
npm run dist:mac

# Build all platforms
npm run dist:all
```

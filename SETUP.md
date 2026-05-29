# Life Planner Bot — Setup Guide

## Step 1 — Create Telegram Bot

1. Open Telegram → search **@BotFather**
2. Send `/newbot` → give it a name (e.g. `My Life Planner`) and username
3. Copy the **token** BotFather gives you → this is `TELEGRAM_BOT_TOKEN`
4. Start a conversation with your new bot (send `/start`)
5. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
6. Find `"chat":{"id":123456789}` → copy that number → `TELEGRAM_CHAT_ID`

## Step 2 — Install & Generate VAPID Keys (for browser notifications)

```bash
cd /path/to/planner
npm install
node generate-vapid.js
```

Copy the two lines printed into your `.env` file.

## Step 3 — Create .env file

```bash
cp .env.example .env
# Fill in all values
```

## Step 4 — Test locally

```bash
npm start
# Bot should say: 🤖 Life Planner Bot started
# Send /start to your bot in Telegram
```

## Step 5 — Deploy to Render (free, 24/7)

1. Push this project to a GitHub repo (public or private)
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml`
5. Add all environment variables in Render dashboard:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_EMAIL` → `mailto:shavgoniaziz@gmail.com`
   - `PLANNER_URL` → your Netlify URL (e.g. `https://yoursite.netlify.app`)
6. Deploy → copy your Render URL (e.g. `https://life-planner-bot.onrender.com`)

## Step 6 — Update index.html

In `index.html` find this line near the bottom:

```js
const BOT_SERVER = 'https://your-bot-server.onrender.com';
```

Replace with your actual Render URL, then redeploy to Netlify.

## Step 7 — Enable browser notifications

1. Open your Netlify planner site
2. Click **🔔 Enable Reminders** button (bottom-right corner)
3. Allow notifications when browser asks
4. Button turns green → ✅ Reminders ON

## ⚠️ Render Free Tier Note

Render free tier spins down after 15 min of inactivity. To keep it alive 24/7:
- Use [UptimeRobot](https://uptimerobot.com) (free) → monitor `https://your-bot.onrender.com/`
- Set check interval: every 5 minutes
- This pings the server and prevents sleep

## Reminder Schedule (Tashkent UTC+5)

| Time  | Message |
|-------|---------|
| 00:00 | 📅 Full daily schedule sent |
| 00:30 | 🌙 Work starts in 30 min |
| 09:05 | ✅ Work done! Morning routine |
| 09:15 | 📖 Quran time |
| 10:00 | 💪 Gym — Cardio |
| 10:30 | 🇷🇺 Russian class |
| 12:30 | 📺 Finance video |
| 13:00 | 🍽️ Breakfast |
| 16:30 | 💪 Gym — Weights |
| 18:00 | 🍽️ Lunch (+ Sunday reflection) |
| 18:30 | 📚 Business study |
| 19:00 | 📅 Plan next week (Sunday only) |
| 20:00 | 🕌 Maghrib |
| 21:00 | 🍽️ Dinner |
| 21:30 | 💾 Save life plan |
| 22:00 | 🕌 Isha |
| 23:30 | 😴 Sleep |
| Every 3h | 💎 Motivational quote (Tajik) |

## Bot Commands

- `/start` — Welcome message + command list
- `/schedule` — Get today's full schedule now
- `/motive` — Get the motivational quote
- `/prayers` — Tashkent prayer times
- `/status` — Bot status + push subscription count
- `/chatid` — Shows your chat ID

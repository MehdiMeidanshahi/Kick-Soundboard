# Kick Soundboard Vercel Auth Bridge

This is the serverless OAuth bridge for **Kick Soundboard**. It runs on Vercel's free tier, allowing streamers to link their Kick account in 1 click without needing to create a Kick Developer app or manage localhost redirects.

## How It Works

1. Streamer clicks **Connect Kick** in the desktop app.
2. Desktop app opens `https://kicksoundboard-itsmehdi7.vercel.app/api/auth/login`.
3. Kick prompts the streamer to authorize read-only reward access.
4. Kick redirects back to `https://kicksoundboard-itsmehdi7.vercel.app/api/auth/callback`.
5. The bridge exchanges the authorization code for tokens using your hidden `KICK_CLIENT_SECRET`.
6. The bridge triggers `kick-soundboard://auth?token=...&refresh=...`, opening the local Windows app with the tokens.
7. The desktop app securely stores tokens via Windows Credential Manager / DPAPI and polls Kick directly.

---

## Deployment to Vercel

### 1. Create your Kick Developer App
1. Go to [kick.com/settings/developer](https://kick.com/settings/developer).
2. Click **Create new**.
3. **App Name:** `Kick Soundboard`
4. **Redirect URL:** `https://kicksoundboard-itsmehdi7.vercel.app/api/auth/callback` (or your chosen Vercel domain).
5. **Scopes:** Check `Read Channel points rewards information on a channel` (`channel:rewards:read`).
6. Save and copy the **Client ID** and **Client Secret**.

### 2. Deploy to Vercel
You can deploy using the Vercel CLI or by linking your GitHub repository:

#### Using Vercel CLI:
```bash
cd bridge
vercel
```

#### Set Environment Variables in Vercel:
In your Vercel Project Dashboard (**Settings -> Environment Variables**), add:
- `KICK_CLIENT_ID`: Your Kick Developer App Client ID
- `KICK_CLIENT_SECRET`: Your Kick Developer App Client Secret
- `KICK_REDIRECT_URI` (optional): `https://kicksoundboard-itsmehdi7.vercel.app/api/auth/callback`

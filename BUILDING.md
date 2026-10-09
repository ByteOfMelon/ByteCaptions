# Building ByteCaptions with YouTube upload

Release builds of ByteCaptions can't upload to YouTube: that needs a Google OAuth client,
and Google only lets an app use the YouTube API for everyone after a lengthy verification.
You can make a build that uploads to your own channel with an OAuth client of your own.
It stays in "testing" mode in Google Cloud, which is fine for personal use.

Without a client the app hides everything to do with YouTube. Exporting SRV3 and uploading
the file in YouTube Studio by hand works in every build.

## 1. Create the OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Under **APIs & Services → Library**, enable **YouTube Data API v3**.
3. Under **APIs & Services → OAuth consent screen** (Google Auth Platform):
    - Choose **External** and fill in the app name and your email.
    - Add the scope `https://www.googleapis.com/auth/youtube.force-ssl`.
    - Under **Audience → Test users**, add the Google account that owns your channel.
4. Under **APIs & Services → Credentials**, choose **Create credentials → OAuth client ID**,
   with application type **Desktop app**.
5. Download the client's JSON file.

## 2. Give it to the build

Use either of these:

- Save the downloaded file as `src-tauri/google-oauth.json`. It's in `.gitignore`, so it
  won't be committed.
- Or set the `BC_GOOGLE_CLIENT_ID` and `BC_GOOGLE_CLIENT_SECRET` environment variables
  when building.

Then build as usual:

```bash
npm install
npm run fetch:ffmpeg
npm run tauri build
```

The client ID and secret are compiled into the app, so keep a build like this to yourself.
A desktop app can't truly hide its client secret; Google expects that, and sign-in is still
protected by PKCE. Even so, don't publish the build: anyone using it would share your
API quota.

## Notes

- **Test users:** while the consent screen is in testing, only the accounts listed as test
  users can sign in, and Google asks them to sign in again about once a week.
- **Quota:** the YouTube Data API gives each project 10,000 units a day. Uploading one
  caption track costs about 450 units, and listing videos and captions costs a few more.
- **Sign-in:** the app opens your browser to sign in and receives the answer on a one-off
  server on `127.0.0.1`. Desktop-app clients allow that without extra setup.

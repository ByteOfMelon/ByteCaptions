# Building the app

For a regular build of the app, run:

```bash
npm install
npm run fetch:ffmpeg
npm run tauri build
```

## Building ByteCaptions with YouTube upload support

Official release builds of ByteCaptions via GitHub Releases have the YouTube uploading features turned off. This is because these features need a Google OAuth client, and Google has some incredibly stingy policies regarding use of the YouTube API for apps made for the public, and to be honest, I couldn't be bothered to deal with all of those headaches.

Instead, if you'd like to use these features for the time being, you can build ByteCaptions yourself so that you can upload subtitles to your own YouTube videos using your own Google OAuth client. Remember though that in the release build, you can still simply export as SRV3 and upload the file to YouTube Studio and it will work just fine.

Below is a guide on how to create and use a Google OAuth client with a custom build if you'd still like to do so.

### 1. Create the OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Under APIs & Services -> Library, search for and enable "YouTube Data API v3".
3. Under APIs & Services -> OAuth consent screen:
   - Choose "External" and fill in your own app name and email.
   - Add the custom scope `https://www.googleapis.com/auth/youtube.force-ssl`.
   - Under Audience -> Test users, add the Google account that owns your channel.
4. Under APIs & Services -> Credentials, choose "Create credentials", then "OAuth client ID", and set the application type to "Desktop app".
5. Download the client's JSON file.

### 2. Give it to the build

There are two ways to set up your Google OAuth app for the custom build:

- Save the downloaded file as `src-tauri/google-oauth.json`
- Set the `BC_GOOGLE_CLIENT_ID` and `BC_GOOGLE_CLIENT_SECRET` environment variables when building.

Then build as usual with the following commands:

```bash
npm install
npm run fetch:ffmpeg
npm run tauri build
```

> [!WARNING]
> The Google OAuth app's client ID and secret are compiled directly into the app, so do not distribute this build to anyone you don't trust, as they can also use up your API quota and potentially cause issues with Google's API terms of service.

### Notes for using the YouTube upload features of ByteCaptions

- While your OAuth app is set to testing mode, only the accounts listed as test users can sign in, and Google will ask each of these users to sign in again once a week.
- The YouTube Data API gives each project 10,000 units a day. Uploading one caption track costs about 450 units, and listing videos and captions costs a few more, leading to about 20-25 caption uploads per day per app without further authorization from Google.
- For OAuth, the app will open your default browser to sign in and receives its tokens on a one-off server on `127.0.0.1`.

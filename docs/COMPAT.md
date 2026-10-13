# SRV3 compatibility results
Below is my testing of how ByteCaptions's SRV3 exporter outputs on YouTube across the most common platforms.

You can view the test video yourself by clicking [here](https://www.youtube.com/watch?v=2RB-UMqY3oY). Note, however, that the timings and text are a bit messed up as I used the auto-transcribe without editing these aspects. This video is made purely to test SRV3 compatibility.

## Tested platforms

| Player      | Version, device                                                       | Date       |
| ----------- | --------------------------------------------------------------------- | ---------- |
| Desktop web | Helium 0.19.2.1 / Chromium 155.0.8059.39, on macOS Golden Gate 27.0.1 | 10/13/2026 |
| iOS app     | App version 21.40.5, on iOS 27.0                                      | 10/13/2026 |
| Android app | Yet to be tested, anyone who has an Android device hmu                | TBD        |
| TV app      | Yet to be tested, will be soon                                        | TBD        |

## Result meaning
| Result | Meaning                                       |
| ------ | --------------------------------------------- |
| ✅     | Functions perfectly                           |
| ⚠️     | Functions partially or differently, see Notes |  
| ❌     | Doesn't work whatsoever                       |    

## Results

| Test | Time  | Feature                                 | Desktop web | iOS | Android | TV  | Notes                                                                                      |
| ---- | ----- | --------------------------------------- | ----------- | --- | ------- | --- | ------------------------------------------------------------------------------------------ |
| T01  | 0:00  | Baseline: default style                 | ✅          | ✅  |         |     |                                                                                            |
| T02  | 0:25  | Font: Courier New (monoSerif)           | ✅          | ⚠️  |         |     | iOS: shows a proportional serif, not monospaced                                            |
| T03  | 0:55  | Font: Times New Roman (propSerif)       | ✅          | ⚠️  |         |     | iOS: shows a monospaced font, not Times                                                    |
| T04  | 1:20  | Font: Lucida Console (monoSans)         | ✅          | ⚠️  |         |     | iOS: shows a proportional sans, not monospaced                                             |
| T05  | 1:34  | Font: Roboto (propSans)                 | ✅          | ⚠️  |         |     | iOS: different sans from desktop Roboto                                                    |
| T06  | 2:03  | Font: Comic Sans (casual)               | ✅          | ⚠️  |         |     | iOS: shows a serif, not Comic Sans                                                         |
| T07  | 2:31  | Font: Monotype Corsiva (cursive)        | ✅          | ⚠️  |         |     | iOS: shows small caps (T08's font), not cursive                                            |
| T08  | 2:52  | Font: Carrois Gothic SC (smallCaps)     | ✅          | ⚠️  |         |     | iOS: regular sans, no small caps                                                           |
| T09  | 3:12  | Size: 75%                               | ✅          | ⚠️  |         |     | iOS: same as 100%, not smaller                                                             |
| T10  | 3:33  | Size: 150%                              | ✅          | ✅  |         |     |                                                                                            |
| T11  | 4:05  | Size: 200%                              | ✅          | ✅  |         |     |                                                                                            |
| T12  | 4:26  | Bold                                    | ✅          | ❌  |         |     |                                                                                            |
| T13  | 4:54  | Italic                                  | ✅          | ✅  |         |     |                                                                                            |
| T14  | 5:09  | Underline                               | ✅          | ✅  |         |     |                                                                                            |
| T15  | 5:37  | Offset: last word subscript             | ✅          | ❌  |         |     | Web: offset word shifts down and shrinks                                                   |
| T16  | 6:34  | Offset: last word superscript           | ✅          | ❌  |         |     | Web: offset word shifts up and shrinks                                                     |
| T17  | 6:57  | Text color: yellow                      | ✅          | ✅  |         |     |                                                                                            |
| T18  | 7:15  | Text color: cyan at 50% opacity         | ✅          | ✅  |         |     |                                                                                            |
| T19  | 7:37  | Background: blue at 75%                 | ✅          | ⚠️  |         |     | iOS: dark grey box, not blue                                                               |
| T20  | 8:05  | Background: none (0%)                   | ✅          | ⚠️  |         |     | iOS: standard dark box drawn anyway                                                        |
| T21  | 8:17  | Background: solid black (100%)          | ✅          | ⚠️  |         |     | iOS: standard 75% box, not solid                                                           |
| T22  | 8:29  | Edge: hard shadow, no background        | ✅          | ⚠️  |         |     | iOS: shadow shows, but the standard box is added behind                                    |
| T23  | 8:46  | Edge: bevel, no background              | ✅          | ⚠️  |         |     | iOS: bevel shows, but the standard box is added behind                                     |
| T24  | 9:05  | Edge: glow, no background               | ✅          | ⚠️  |         |     | iOS: glow shows, but the standard box is added behind                                      |
| T25  | 9:25  | Edge: soft shadow, no background        | ✅          | ⚠️  |         |     | iOS: shadow shows, but the standard box is added behind                                    |
| T26  | 9:38  | Position: top left                      | ✅          | ✅  |         |     |                                                                                            |
| T27  | 9:57  | Position: top center                    | ✅          | ✅  |         |     |                                                                                            |
| T28  | 10:15 | Position: top right                     | ✅          | ✅  |         |     |                                                                                            |
| T29  | 10:36 | Position: middle left                   | ✅          | ✅  |         |     |                                                                                            |
| T30  | 11:02 | Position: center                        | ✅          | ✅  |         |     |                                                                                            |
| T31  | 11:15 | Position: middle right                  | ✅          | ✅  |         |     |                                                                                            |
| T32  | 11:30 | Position: bottom left                   | ✅          | ✅  |         |     |                                                                                            |
| T33  | 11:47 | Position: bottom right                  | ✅          | ✅  |         |     |                                                                                            |
| T34  | 12:01 | Align: left (bottom center window)      | ✅          | ✅  |         |     |                                                                                            |
| T35  | 12:12 | Align: right (bottom center window)     | ✅          | ✅  |         |     |                                                                                            |
| T36  | 12:29 | Vertical text: right to left            | ✅          | ⚠️  |         |     | iOS: drawn horizontally; position (middle right) kept                                      |
| T37  | 12:45 | Vertical text: left to right            | ✅          | ⚠️  |         |     | iOS: drawn horizontally, same as T36                                                       |
| T38  | 13:01 | Per-word styling: first word red + bold | ✅          | ⚠️  |         |     | iOS: red shows, but bold is not applied (see T12)                                                 |
| T39  | 13:19 | Karaoke: default yellow                 | ✅          | ✅  |         |     |                                                                                            |
| T40  | 13:36 | Karaoke: no background + glow           | ✅          | ✅  |         |     |                                                                                            |

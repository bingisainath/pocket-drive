# Play Store assets

Regenerate with `python3 generate.py` (needs Pillow).

The icon and feature graphic are drawn from the same Material cloud-upload path as
`android/app/src/main/res/drawable/ic_launcher_foreground.xml`, on the same brand blue `#2563EB`, so the
store icon matches what lands on the home screen. Both are RGB with no alpha, which is what Play wants.

| File | Use |
|---|---|
| `play-icon-512.png` | Play Console app icon (512x512, required) |
| `play-feature-1024x500.png` | feature graphic (1024x500, required) |
| `short-description.txt` | 80-character limit |
| `full-description.txt` | 4000-character limit |

Screenshots are not generated: take them on a real device, signed in as a **test account**, so no personal
filenames end up public forever.

```bash
adb exec-out screencap -p > shot-1.png
```

At least 4 at 1080px or more on each side, which is the threshold for promotion eligibility.

# Recording the live demo for `examples.html`

The page carries a "recorded session" section that stays hidden until the video
exists. Drop a file at **`media/live-demo.mp4`** and the section appears — no
HTML edit needed. (`assets/examples.js` does a `HEAD` request for it on load;
that check cannot run from `file://`, so preview over a local server.)

Optional: `media/live-demo-poster.jpg` is used as the still frame before play.

## 1. Run the demo

Either use the hosted one, or run it yourself:

```sh
cd backend
uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1
# then open http://localhost:8000
```

Local needs the models on disk and a GPU — see `setup.sh`. The hosted pod is
the easier path if it is up.

## 2. Record

macOS screen recording, no extra software:

1. Turn on Do Not Disturb, and hide the bookmarks bar and anything personal.
2. Size the browser window to about **1280×720** — matching the final frame
   size keeps text crisp instead of resampled.
3. `⇧⌘5` → **Record Selected Portion** → drag over the window → Record.
4. Stop from the menu bar. It saves a `.mov` to the Desktop.

Worth capturing, in order: entering a move, the agents exchanging messages,
and then opening the **diagnosis** panel so the belief curve is on screen.
Thirty to sixty seconds is plenty — this sits next to three static examples,
it does not need to be a tour.

## 3. Convert

`avconvert` ships with macOS and writes a fast-start H.264 MP4, which is what
browsers want:

```sh
avconvert --source ~/Desktop/Screen\ Recording.mov \
          --output media/live-demo.mp4 \
          --preset PresetAppleM4V720pHD
```

Use `PresetAppleM4V1080pHD` if 720p looks soft. Avoid the `PresetHEVC*`
presets — Chrome and Firefox support for HEVC in MP4 is unreliable.

To trim, add `--start 3.5 --duration 45` (seconds).

A poster frame, if you want one:

```sh
avconvert --source media/live-demo.mp4 --output /tmp/frame.mov \
          --preset PresetAppleM4V720pHD --start 5 --duration 0.1
# then screenshot that frame, or use ffmpeg if installed:
#   ffmpeg -i media/live-demo.mp4 -ss 5 -frames:v 1 media/live-demo-poster.jpg
```

If you would rather have finer control, `brew install ffmpeg` and use:

```sh
ffmpeg -i in.mov -vf "scale=1280:-2,fps=30" -c:v libx264 -profile:v high \
       -pix_fmt yuv420p -crf 26 -movflags +faststart -an media/live-demo.mp4
```

`-movflags +faststart` matters: without it the browser must download the whole
file before the first frame. `-an` drops the audio track, which a silent screen
capture does not need.

## 4. Check the size

GitHub Pages refuses files over 100 MB and the whole site is capped at 1 GB, but
the real constraint is the visitor. **Keep it under ~15 MB.** Check with
`ls -lh media/live-demo.mp4`. If it is larger: shorten it, drop to 720p, or
raise `-crf` (ffmpeg) toward 30.

At that size a plain `git add` is fine — no Git LFS needed.

## 5. Preview

```sh
python3 -m http.server 8777    # from the repo root
open http://127.0.0.1:8777/examples.html
```

The section should appear after the three examples. If it does not, the `HEAD`
request failed — check the filename is exactly `media/live-demo.mp4`.

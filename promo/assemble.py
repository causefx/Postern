# Joins the rendered scenes and the Higgsfield clips into promo/postern-promo.mp4 with ffmpeg crossfades.
#
#   python promo/assemble.py
#
# Needs promo/build/*.mp4 from render.mjs, promo/clips/intro-door.mp4 and outro-door.mp4,
# and (optionally) promo/clips/music.mp3.
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
B, C = ROOT / "build", ROOT / "clips"

# (file, seconds, transition into the NEXT segment, transition length)
SEGMENTS = [
    (C / "intro-door.mp4", 5.0, "fadewhite", 0.7),
    (B / "title.mp4", 3.6, "fade", 0.4),
    (B / "dash.mp4", 5.2, "smoothleft", 0.5),
    (B / "palette.mp4", 4.8, "smoothleft", 0.5),
    (B / "scope.mp4", 5.2, "smoothleft", 0.5),
    (B / "requests.mp4", 5.0, "circleopen", 0.6),
    (B / "theme.mp4", 4.4, "smoothup", 0.5),
    (B / "mobile.mp4", 5.4, "zoomin", 0.6),
    (B / "wall.mp4", 5.0, "fadeblack", 0.6),
    (C / "outro-door.mp4", 5.0, "fade", 0.6),
    (B / "end.mp4", 4.4, None, 0),
]

args = ["ffmpeg", "-y", "-loglevel", "error"]
for f, d, *_ in SEGMENTS:
    args += ["-t", str(d), "-i", str(f)]
cap = len(SEGMENTS)
args += ["-loop", "1", "-t", "5", "-i", str(B / "cap-intro.png")]
music = C / "music.mp3"
if music.exists():
    args += ["-i", str(music)]

norm = "fps=30,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,format=yuv420p,settb=AVTB"
fl = [f"[{i}:v]{norm}[s{i}]" for i in range(len(SEGMENTS))]
# Caption card over the opening shot.
fl.append(f"[{cap}:v]format=rgba,fade=in:st=1.3:d=0.6:alpha=1,fade=out:st=3.9:d=0.5:alpha=1[capv]")
fl.append("[s0][capv]overlay=0:0:shortest=1,format=yuv420p[s0c]")

prev, t = "s0c", 0.0
for i in range(len(SEGMENTS) - 1):
    _, d, trans, td = SEGMENTS[i]
    t += d - td
    out = f"x{i}"
    fl.append(f"[{prev}][s{i + 1}]xfade=transition={trans}:duration={td}:offset={t:.3f}[{out}]")
    prev = out
total = t + SEGMENTS[-1][1]
fl.append(f"[{prev}]fade=in:st=0:d=0.4[vout]")

maps = ["-map", "[vout]"]
if music.exists():
    fl.append(f"[{cap + 1}:a]atrim=0:{total:.3f},afade=in:st=0:d=0.5,afade=out:st={total - 2.5:.3f}:d=2.5[aout]")
    maps += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]

args += ["-filter_complex", ";".join(fl), *maps, "-c:v", "libx264", "-preset", "slow", "-crf", "17",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", f"{total:.3f}", str(ROOT / "postern-promo.mp4")]
subprocess.run(args, check=True)
print(f"wrote {ROOT / 'postern-promo.mp4'} ({total:.1f}s)")

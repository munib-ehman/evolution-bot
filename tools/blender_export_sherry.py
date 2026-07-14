"""
Export Sherry (.blend) → web-ready GLB for the shop-avatar app.

Sherry ships as a Blender project with ~482 MB of 4K/8K textures — far too heavy
for a browser. This script downscales the textures (sharper for face-relevant
maps, smaller for body/cloth), packs them into the file, and exports a single
self-contained .glb with the skeleton + any shape keys preserved (so the jaw/lip
bones can drive lip-sync in three.js).

Run headless (no Blender UI):

  blender -b "Sherry 5.0.blend" -P tools/blender_export_sherry.py -- "OUT.glb"

e.g. on Windows:

  "C:/Program Files/Blender Foundation/Blender 4.2/blender.exe" -b ^
     "C:/Users/muneebur1/Downloads/uploads_files_7293931_girl/Sherry/Sherry 5.0.blend" ^
     -P "D:/company/shop-avatar/tools/blender_export_sherry.py" -- ^
     "D:/company/shop-avatar/public/models/sherry.glb"
"""

import sys
import bpy

# ── Args after the `--` separator ───────────────────────────────────────────
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "sherry.glb"

# Face-relevant maps stay sharp; everything else (body/cloth/socks/skirt) is
# smaller since the camera is framed on the face.
FACE_HINTS = ("eye", "eyelash", "hair", "teeth", "face", "head", "brow", "skin")
MAX_FACE = 2048
MAX_OTHER = 1024


def downscale_textures():
    for img in bpy.data.images:
        try:
            if img.source == "FILE" and not img.has_data:
                img.reload()
            w, h = img.size
            if w == 0 or h == 0:
                continue
            name = (img.name or "").lower()
            cap = MAX_FACE if any(k in name for k in FACE_HINTS) else MAX_OTHER
            m = max(w, h)
            if m > cap:
                s = cap / m
                img.scale(max(1, int(w * s)), max(1, int(h * s)))
                print(f"  scaled {img.name}: {w}x{h} -> {img.size[0]}x{img.size[1]}")
            img.pack()  # embed so the exporter bakes it into the .glb
        except Exception as e:  # noqa: BLE001 — never let one bad image abort the run
            print(f"  ! skipped {img.name}: {e}")


def export_glb():
    # Minimal, version-tolerant argument set. Defaults already export materials,
    # +Y up, and AUTO image format; we just make skins + morphs explicit.
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_skins=True,
        export_morph=True,
        export_animations=False,
    )
    print("EXPORTED:", OUT)


print("Downscaling textures…")
downscale_textures()
print("Exporting GLB…")
export_glb()
print("DONE")

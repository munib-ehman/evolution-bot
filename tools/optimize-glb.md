# Optimizing a heavy GLB for the web

Sherry exported from Blender at **~449 MB** (8K PNG textures embedded) — unusable
in a browser. We shrink it to **~16 MB** with two `@gltf-transform/cli` passes:
resize textures to 2K, then convert PNG → WebP (browser-native, no extra loader).

```bash
# 1. Cap every texture at 2048px  (449 MB → ~70 MB)
npx --yes @gltf-transform/cli@latest resize "Sherry 5.0.glb" sherry_2k.glb \
  --width 2048 --height 2048

# 2. PNG → WebP, quality 82        (~70 MB → ~16 MB)
npx --yes @gltf-transform/cli@latest webp sherry_2k.glb public/models/sherry.glb \
  --quality 82
```

Notes
- WebP textures use the `EXT_texture_webp` glTF extension, which three.js'
  GLTFLoader decodes automatically on any WebP-capable browser (all modern ones).
- We deliberately skip Draco/meshopt/KTX2 geometry compression: those need extra
  decoders that three.js fetches from a CDN by default, which would break the
  app's "$0, self-contained, offline-capable" rule. Texture optimization alone
  gets the file small enough.
- Drop `--quality` to 75 (or `--width 1536`) if you need it even smaller.
```
```

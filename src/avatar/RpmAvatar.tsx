/**
 * Renders a Ready Player Me GLB and animates it every frame into something that
 * reads as a *person*, not a prop:
 *   - Lip-sync: the shared speechEngine's live amplitude drives the jaw and an
 *     eased Oculus viseme whose *shape* changes on syllable onsets.
 *   - Living eyes: micro-saccades (the eyes dart and hold), gaze-linked blinks,
 *     and a little head-follow so the stare is never frozen.
 *   - Micro-expression: brows lift and eyes widen on stressed syllables; a soft
 *     resting smile drifts with slow noise.
 *   - Organic idle: noise-driven head drift + a breathing bob (never a clean sine).
 *
 * All of it comes from the shared {@link LifeController} — pure math over time and
 * one audio amplitude — so it's fully local and free.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Color, Vector3, type Group, type Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { speechEngine } from "../audio/speechEngine";
import { MORPH, VISEMES, EYE_LOOK_ALL } from "./constants";
import { DEFAULT_AVATAR_URL, RPM_BLONDE_URL, DEFAULT_HAIR_COLOR } from "./constants";

// ── Face-focus framing (for un-rigged GLBs with no "Head" bone) ─────────────
// The model is normalized so its head — the top slice of the bounding box —
// fills the framed view, then the face is parked at the camera target. Tune
// these three if a model sits too high/low or too close/far.
const HEAD_REGION = 0.17; // fraction of total height treated as "the head"
const FACE_FILL = 1.02; // world-units the head region is scaled to fill
const FACE_CENTER = 0.42; // where in the head region the face sits (0 = crown)
const FACE_YAW = 0; // radians; set to Math.PI if a model faces away from camera
import { collectMorphMeshes, setMorph, type MorphMesh } from "./morphUtils";
import { LifeController, eyeLookWeights } from "./lifeController";

interface RpmAvatarProps {
  url: string;
  /** True while the assistant is processing — plays a "thinking" pose. */
  thinking?: boolean;
  /** Fired once the GLB has loaded and this component mounts. */
  onReady?: () => void;
}

export function RpmAvatar({ url, thinking = false, onReady }: RpmAvatarProps) {
  const { scene } = useGLTF(url);
  const group = useRef<Group>(null);

  // Clone-free: RPM scenes are single-use here. Gather morph meshes + head bone once.
  const morphMeshes = useMemo<MorphMesh[]>(() => collectMorphMeshes(scene), [scene]);
  const headBone = useMemo<Object3D | undefined>(() => scene.getObjectByName("Head") ?? undefined, [scene]);

  // All the micro-behaviour (saccades, blinks, brows, head drift) lives here.
  const life = useRef(new LifeController());

  // Reset morphs when the avatar changes.
  useEffect(() => {
    for (const mesh of morphMeshes) mesh.morphTargetInfluences.fill(0);
  }, [morphMeshes]);

  // We only reach here once the GLB has finished streaming (Suspense resolved),
  // so this is the moment the model is truly ready to show.
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // Recolor the default avatar's hair to blonde. The stock hair uses a flat-color
  // base texture + a normal map, so dropping the base map and setting a solid
  // blonde color keeps the strand shading while changing the colour cleanly. Only
  // applied to the bundled default — a custom avatar you load is left as-is.
  useLayoutEffect(() => {
    if (url !== RPM_BLONDE_URL) return;
    const blonde = new Color(DEFAULT_HAIR_COLOR);
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as MeshStandardMaterial | undefined;
      if (!mat) return;
      const isHair = mesh.name.includes("Hair") || (mat.name?.includes("Hair") ?? false);
      if (isHair) {
        mat.map = null; // drop the flat purple base texture
        mat.color = blonde;
        mat.roughness = 0.55;
        mat.metalness = 0.05;
        mat.needsUpdate = true;
      }
    });
  }, [scene, url]);

  // Auto-frame the face.
  //   • RPM (rigged) avatars expose a "Head" bone → park the head just above the
  //     camera target, showing head + shoulders like before.
  //   • Un-rigged GLBs (e.g. the Meshy model) have no head bone, so we normalize
  //     the model by its size and frame tightly on the top-of-body head region —
  //     a face close-up regardless of the source model's scale.
  useLayoutEffect(() => {
    scene.rotation.y = headBone ? 0 : FACE_YAW;
    scene.position.set(0, 0, 0);
    scene.scale.setScalar(1);
    scene.updateWorldMatrix(true, true);

    if (headBone) {
      const box = new Box3().setFromObject(scene);
      const center = box.getCenter(new Vector3());
      const headY = headBone.getWorldPosition(new Vector3()).y;
      scene.position.x -= center.x;
      scene.position.z -= center.z;
      scene.position.y -= headY - 0.02; // head just above the camera target
      return;
    }

    // Rigless: normalize scale so the head region fills the frame, then center
    // the face at the origin (the camera's target).
    let box = new Box3().setFromObject(scene);
    const height = box.max.y - box.min.y || 1;
    const s = FACE_FILL / (HEAD_REGION * height);
    scene.scale.setScalar(s);
    scene.updateWorldMatrix(true, true);

    box = new Box3().setFromObject(scene);
    const center = box.getCenter(new Vector3());
    const totalH = box.max.y - box.min.y;
    const faceY = box.max.y - FACE_CENTER * HEAD_REGION * totalH;
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= faceY; // face at the camera target
  }, [scene, headBone]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const level = speechEngine.getLevel(t); // 0..1, smoothed
    const f = life.current.update(t, delta, level, thinking);

    // ── Lip-sync ────────────────────────────────────────────────────────────
    setMorph(morphMeshes, MORPH.jawOpen, f.jaw * 0.9);
    setMorph(morphMeshes, MORPH.mouthOpen, f.mouthOpen);
    VISEMES.forEach((v) => setMorph(morphMeshes, v, 0));
    if (f.viseme) setMorph(morphMeshes, f.viseme, f.visemeWeight);

    // ── Resting smile ─────────────────────────────────────────────────────────
    setMorph(morphMeshes, MORPH.mouthSmile, f.smile);
    setMorph(morphMeshes, MORPH.mouthSmileRight, f.smile);

    // ── Brows + eye-widen (speech emphasis / upward glances) ──────────────────
    setMorph(morphMeshes, MORPH.browInnerUp, f.browInner);
    setMorph(morphMeshes, MORPH.browOuterUpLeft, f.browOuter);
    setMorph(morphMeshes, MORPH.browOuterUpRight, f.browOuter);
    setMorph(morphMeshes, MORPH.eyeWideLeft, f.eyeWide);
    setMorph(morphMeshes, MORPH.eyeWideRight, f.eyeWide);

    // ── Concentration furrow while thinking (safe no-op if morph is absent) ───
    setMorph(morphMeshes, MORPH.browDownLeft, f.browDown);
    setMorph(morphMeshes, MORPH.browDownRight, f.browDown);

    // ── Blinking ──────────────────────────────────────────────────────────────
    setMorph(morphMeshes, MORPH.eyeBlinkLeft, f.blink);
    setMorph(morphMeshes, MORPH.eyeBlinkRight, f.blink);

    // ── Living eyes: micro-saccades ───────────────────────────────────────────
    for (const name of EYE_LOOK_ALL) setMorph(morphMeshes, name, 0);
    const look = eyeLookWeights(f.gazeX, f.gazeY);
    for (const name in look) setMorph(morphMeshes, name, look[name]);

    // ── Organic head pose + breathing bob ─────────────────────────────────────
    if (headBone) {
      // Rigged: rotate just the head bone; the body stays planted.
      if (group.current) group.current.position.y = f.bob;
      headBone.rotation.set(f.headPitch, f.headYaw, f.headRoll);
    } else if (group.current) {
      // Rigless: pivot the whole model at the face so it turns, nods, and tilts
      // (incl. the thinking tilt) instead of standing there as a dead statue.
      group.current.position.y = f.bob;
      group.current.rotation.set(f.headPitch * 0.5, f.headYaw * 0.6, f.headRoll);
    }
  });

  // The static framing offset lives on `scene`; the group only does the breathing bob.
  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

// Let drei prefetch/cache the default so switching back is instant.
useGLTF.preload(DEFAULT_AVATAR_URL);

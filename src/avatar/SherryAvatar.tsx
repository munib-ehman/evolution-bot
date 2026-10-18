/**
 * Sherry — a high-detail Auto-Rig Pro (ARP) character, animated to read as a
 * *person*. She has no viseme blendshapes, so everything is driven through her
 * facial DEFORM bones — rotations for the long bones, tiny translations for the
 * micro lip/brow/cheek bones (rotating a 5mm leaf bone moves nothing; sliding it
 * moves the lip surface directly).
 *
 * Every driver below was verified by posing the exported GLB in Blender and
 * looking at renders:
 *   • jaw open   → jawbone.x rotateX+          (teeth/tongue show correctly)
 *   • blink      → eyelid_top rotX− / eyelid_bot rotX+
 *   • smile pull → c_lips_smile translate Y+   (Y− puckers the corners forward)
 *   • lip raise  → c_lips_top translate Y+     (upper teeth show)
 *   • lip press  → c_lips_bot translate Y+     (Y− drops the lower lip)
 *   • brow lift  → c_eyebrow_full translate Y+ (subtle, partly under her fringe)
 *   • cheek raise→ c_cheek_smile translate Y+  (the "real smile" Duchenne cue)
 *
 * What makes her feel alive rather than animated:
 *   - Lip-sync with real mouth SHAPES: wide (E/I), round (O/U) and upper-lip
 *     raise glide between syllables on top of the amplitude-driven jaw.
 *   - Eyes that track your cursor (softly, between natural saccades), lids that
 *     follow vertical gaze, gaze-linked blinks.
 *   - Head motion split across neck + head bones (organic, never a stiff swivel),
 *     chest breathing via the spine, resting smile that reaches the cheeks.
 *   - The "thinking" pose (eyes up-and-away, head tilt, brow knit) blends over
 *     all of it while the assistant is processing.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Quaternion, Vector3, type Group, type Mesh, type Object3D } from "three";
import { speechEngine } from "../audio/speechEngine";
import { DEFAULT_AVATAR_URL } from "./constants";
import { LifeController } from "./lifeController";

// ── Framing (head-and-shoulders portrait), in the app camera's world units ──
const FACE_YAW = 0;
const HALF_TARGET = 0.56; // on-screen size of eye→crown. ↑ = tighter zoom
const EYE_Y = -0.14; // world-y the eyes sit at. ↑ raises her in frame

// ── Rotation gains (radians at signal = 1) ──────────────────────────────────
// NOTE: this ARP export has a DISCONNECTED hierarchy — the whole head unit
// (head.x + hair + eyes + teeth + all face bones) hangs under `c_head.x`, which
// is parented to the rig root, NOT the neck (the constraints that linked them
// died in export). So head pose goes on c_head.x — that carries hair and every
// facial bone with it — while neck.x gets a small share purely to bend the neck
// skin into the turn.
const R = {
  headPitch: 1.0,
  headYaw: 1.0,
  headRoll: 1.0,
  neckShare: 0.3, // neck skin bends into the head turn
  jaw: 0.33,
  lidTopBlink: 0.55,
  lidBotBlink: 0.28,
  lidGazeFollow: 0.08, // lids track vertical gaze — a big "alive" cue
  eyeYaw: 0.5,
  eyePitch: 0.4,
  breatheSpine: 0.01,
};

// ── Translation gains (model units; verified 0.03 = extreme, so ~¼ of that) ──
const T = {
  cornerSmile: 0.02, // × f.smile   (resting smile ≈ 0.13 → ~2.6mm pull)
  cornerWide: 0.0075, // × lipWide   (E/I)
  cornerRound: -0.011, // × lipRound  (O/U pucker — negative Y = forward)
  topRaise: 0.008, // × lipRaise  (upper lip lifts, teeth show)
  topRound: -0.0025, // × lipRound  (upper lip wraps down slightly on O/U)
  botDrop: -0.0045, // × jaw       (lower lip follows the jaw down)
  botRound: 0.002, // × lipRound  (lower lip firms up on O/U)
  brow: 0.011, // × (browInner + ½browOuter − browDown)
  cheek: 0.012, // × smile — smiles that reach the eyes
};

// Cursor-following gaze: how strongly her eyes/head drift toward the pointer.
const POINTER_EYES = 0.7;
const POINTER_HEAD = 0.14;

interface SherryAvatarProps {
  url: string;
  thinking?: boolean;
  /** True while the assistant is talking — she looks at the viewer, not the cursor. */
  speaking?: boolean;
  attentive?: boolean;
  onReady?: () => void;
}

interface TransBone {
  bone: Object3D;
  restPos: Vector3;
  restQuat: Quaternion;
}

export function SherryAvatar({ url, thinking = false, speaking = false, attentive = false, onReady }: SherryAvatarProps) {
  const { scene } = useGLTF(url);
  const { gl } = useThree();
  const group = useRef<Group>(null);
  const life = useRef(new LifeController());
  // Raw pointer target + smoothed pointer-gaze so cursor jumps never snap her eyes.
  const pt = useRef({ x: 0, y: 0 });
  const px = useRef(0);
  const py = useRef(0);
  // Smoothed attention weight: 0 = idle (free to follow the cursor), 1 = engaged
  // (speaking or thinking → look at the viewer). Eased so the gaze glides between
  // modes instead of snapping.
  const attention = useRef(0);
  const tmpV = useRef(new Vector3());

  // Track the cursor across the WHOLE page, not just the canvas (r3f's
  // state.pointer freezes the moment the cursor leaves the canvas — that made
  // her stop following whenever you moved into the chat). Coordinates stay
  // relative to the canvas center so "toward the chat" reads as a natural
  // glance to her left.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      pt.current.x = Math.max(-1.3, Math.min(1.3, x));
      pt.current.y = Math.max(-1, Math.min(1, y * 0.9));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [gl]);

  const rig = useMemo(() => {
    const realMeshes: Mesh[] = [];
    // three's GLTFLoader sanitizes node names (PropertyBinding.sanitizeNodeName):
    // spaces → "_" and the characters []./: are STRIPPED. So the rig's "head.x"
    // arrives as "headx" — plain getObjectByName("head.x") finds nothing (this
    // is why the face was static). Look bones up by their sanitized names.
    const sanitize = (n: string) => n.replace(/\s/g, "_").replace(/[\[\]./:]/g, "");
    const byName = new Map<string, Object3D>();
    scene.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (m.name.startsWith("cs_")) m.visible = false; // ARP control widgets
      else realMeshes.push(m);
    });

    const get = (n: string) => byName.get(n) ?? byName.get(sanitize(n));
    // Bones we ROTATE (long bones — rotation moves their whole region).
    const rot = {
      // c_head.x, not head.x: the hair mesh and every facial bone hang under
      // c_head.x, so rotating it moves the head as ONE unit (hair included).
      head: get("c_head.x"),
      neck: get("neck.x"),
      spine: get("spine_02.x"),
      jaw: get("jawbone.x"),
      lidTopL: get("eyelid_top.l"),
      lidTopR: get("eyelid_top.r"),
      lidBotL: get("eyelid_bot.l"),
      lidBotR: get("eyelid_bot.r"),
      // Eyeballs are skinned to the c_eye bones (the *_ref ones carry no
      // weights). Verified axes: Z+ = look viewer-left, X+ = look up.
      eyeL: get("c_eye.l"),
      eyeR: get("c_eye.r"),
    };
    // Bones we TRANSLATE (micro leaf bones sitting on the lip/brow surface).
    const transNames = {
      cornerL: "c_lips_smile.l",
      cornerR: "c_lips_smile.r",
      topX: "c_lips_top.x",
      topL: "c_lips_top.l",
      topR: "c_lips_top.r",
      botX: "c_lips_bot.x",
      botL: "c_lips_bot.l",
      botR: "c_lips_bot.r",
      browL: "c_eyebrow_full.l",
      browR: "c_eyebrow_full.r",
      cheekL: "c_cheek_smile.l",
      cheekR: "c_cheek_smile.r",
    } as const;
    const trans = {} as Record<keyof typeof transNames, TransBone | undefined>;
    for (const key in transNames) {
      const b = get(transNames[key as keyof typeof transNames]);
      trans[key as keyof typeof transNames] = b
        ? { bone: b, restPos: b.position.clone(), restQuat: b.quaternion.clone() }
        : undefined;
    }

    const restQuats = new Map<Object3D, Quaternion>();
    for (const b of Object.values(rot)) if (b) restQuats.set(b, b.quaternion.clone());
    return { rot, trans, restQuats, realMeshes };
  }, [scene]);

  useLayoutEffect(() => {
    onReady?.();
  }, [onReady]);

  // Head-and-shoulders framing off the eye bones (see previous iterations).
  useLayoutEffect(() => {
    scene.rotation.y = FACE_YAW;
    scene.position.set(0, 0, 0);
    scene.scale.setScalar(1);
    scene.updateWorldMatrix(true, true);

    const eL = rig.rot.eyeL;
    const eR = rig.rot.eyeR;
    const box = new Box3();
    for (const m of rig.realMeshes) box.expandByObject(m);

    let eyeC: Vector3;
    if (eL && eR) {
      eyeC = eL.getWorldPosition(new Vector3()).add(eR.getWorldPosition(new Vector3())).multiplyScalar(0.5);
    } else {
      eyeC = new Vector3(box.getCenter(new Vector3()).x, box.max.y - 0.12 * (box.max.y - box.min.y), 0);
    }

    const half = Math.max(1e-4, box.max.y - eyeC.y);
    const s = HALF_TARGET / half;
    scene.scale.setScalar(s);
    scene.position.x -= eyeC.x * s;
    scene.position.z -= eyeC.z * s;
    scene.position.y -= eyeC.y * s - EYE_Y;
  }, [scene, rig]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const d = Math.min(delta, 0.05);
    const level = speechEngine.getLevel(t);
    const f = life.current.update(t, d, level, thinking);
    const { rot, trans, restQuats } = rig;

    // Reset driven bones to rest, then layer the frame's behaviour on top.
    for (const [b, q] of restQuats) b.quaternion.copy(q);

    // ── Attention: idle → follow the cursor; speaking/thinking → look at the
    // viewer (the screen). The weight is eased, so she *glides* from one mode to
    // the other; tiny residual saccades keep the engaged stare from going glassy.
    const k = 1 - Math.exp(-3.5 * d);
    px.current += (pt.current.x - px.current) * k;
    py.current += (pt.current.y - py.current) * k;
    const engaged = speaking || thinking || attentive ? 1 : 0;
    attention.current += (engaged - attention.current) * (1 - Math.exp(-4 * d));
    const at = attention.current;

    const pw = POINTER_EYES * (1 - at); // cursor pull, idle only
    const wander = 1 - 0.75 * at; // damp saccade wander toward center while engaged
    const gazeX = f.gazeX * wander * (1 - pw) + px.current * pw * 0.8;
    const gazeY = f.gazeY * wander * (1 - pw) + py.current * pw * 0.45;

    // ── Head + neck (distributed = organic) ──────────────────────────────────
    // Head follows the cursor only when idle; engaged, it faces the viewer.
    const hp = f.headPitch - py.current * POINTER_HEAD * 0.5 * (1 - at);
    const hy = f.headYaw + px.current * POINTER_HEAD * (1 - at);
    const hr = f.headRoll;
    rot.neck?.rotateX(hp * R.neckShare);
    rot.neck?.rotateY(hy * R.neckShare);
    rot.neck?.rotateZ(hr * R.neckShare);
    rot.head?.rotateX(hp * R.headPitch);
    rot.head?.rotateY(hy * R.headYaw);
    rot.head?.rotateZ(hr * R.headRoll);

    // ── Breathing: chest rises via the spine, in phase with the bob ──────────
    rot.spine?.rotateX(Math.sin(t * 1.35) * R.breatheSpine);

    // ── Lip-sync: jaw + mouth shapes ─────────────────────────────────────────
    rot.jaw?.rotateX(f.jaw * R.jaw);

    const move = (tb: TransBone | undefined, dx: number, dy: number, dz: number) => {
      if (!tb) return;
      const v = tmpV.current.set(dx, dy, dz).applyQuaternion(tb.restQuat);
      tb.bone.position.set(tb.restPos.x + v.x, tb.restPos.y + v.y, tb.restPos.z + v.z);
    };

    const cornerY = f.smile * T.cornerSmile + f.lipWide * T.cornerWide + f.lipRound * T.cornerRound;
    move(trans.cornerL, 0, cornerY, 0);
    move(trans.cornerR, 0, cornerY, 0);

    const topY = f.lipRaise * T.topRaise + f.lipRound * T.topRound;
    move(trans.topX, 0, topY, 0);
    move(trans.topL, 0, topY * 0.8, 0);
    move(trans.topR, 0, topY * 0.8, 0);

    const botY = f.jaw * T.botDrop + f.lipRound * T.botRound;
    move(trans.botX, 0, botY, 0);
    move(trans.botL, 0, botY * 0.8, 0);
    move(trans.botR, 0, botY * 0.8, 0);

    // ── Brows + cheeks ───────────────────────────────────────────────────────
    const browY = (f.browInner + f.browOuter * 0.5 - f.browDown) * T.brow;
    move(trans.browL, 0, browY, 0);
    move(trans.browR, 0, browY, 0);
    const cheekY = f.smile * T.cheek;
    move(trans.cheekL, 0, cheekY, 0);
    move(trans.cheekR, 0, cheekY, 0);

    // ── Eyes: gaze + lids that track it + blinks ─────────────────────────────
    // c_eye axes verified NUMERICALLY in glTF space (Blender's export flips the
    // horizontal sign!): rotZ+ = look viewer-right, rotX+ = look up.
    rot.eyeL?.rotateZ(gazeX * R.eyeYaw);
    rot.eyeR?.rotateZ(gazeX * R.eyeYaw);
    rot.eyeL?.rotateX(gazeY * R.eyePitch);
    rot.eyeR?.rotateX(gazeY * R.eyePitch);

    // Upper lids ride the vertical gaze (X+ opens wider — verified), and close
    // over it on a blink. Bottom lids do the reverse, gently.
    const lidTop = gazeY * R.lidGazeFollow - f.blink * R.lidTopBlink;
    const lidBot = f.blink * R.lidBotBlink + gazeY * R.lidGazeFollow * 0.35;
    rot.lidTopL?.rotateX(lidTop);
    rot.lidTopR?.rotateX(lidTop);
    rot.lidBotL?.rotateX(lidBot);
    rot.lidBotR?.rotateX(lidBot);

    if (group.current) group.current.position.y = f.bob;
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(DEFAULT_AVATAR_URL);

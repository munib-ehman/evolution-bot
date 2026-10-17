/**
 * The react-three-fiber canvas: lights, camera, controls, and the avatar (RPM
 * with automatic procedural fallback). Everything renders on the shopper's GPU —
 * no server, no cost.
 *
 * The avatar auto-frames with its head at the origin (see RpmAvatar), so the
 * camera below works for half-body or full-body avatars alike.
 *
 * Lighting is a soft studio setup built from drei <Lightformer>s baked into an
 * <Environment> (`frames={1}` bakes once). This gives real image-based lighting —
 * the subtle skin sheen and wet catch-lights in the eyes that make the face read
 * as modern rather than flat plastic — while staying 100% self-contained: unlike
 * <Environment preset>, procedural lightformers fetch nothing from any CDN.
 */
import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, Lightformer } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ACESFilmicToneMapping } from "three";
import { RpmAvatar } from "./RpmAvatar";
import { SherryAvatar } from "./SherryAvatar";
import { ProceduralAvatar } from "./ProceduralAvatar";
import { AvatarErrorBoundary } from "./AvatarErrorBoundary";
import { isSherryModel } from "./constants";

function LoadingPlaceholder() {
  // A calm placeholder while the GLB streams in — warm gold to match the theme.
  return (
    <mesh>
      <icosahedronGeometry args={[0.35, 1]} />
      <meshStandardMaterial color="#ff8a3d" wireframe />
    </mesh>
  );
}

interface AvatarSceneProps {
  avatarUrl: string;
  /** True while the assistant is processing — plays a "thinking" pose. */
  thinking?: boolean;
  /** True while the assistant is talking — the avatar looks at the viewer. */
  speaking?: boolean;
  /**
   * "portrait": face centred (chat view, avatar in its own column).
   * "stage": face framed in the upper third, leaving the lower part of the
   * canvas clear for the voice captions + orb dock overlay.
   */
  framing?: "portrait" | "stage" | "companion";
  /** Notified if we had to fall back to the procedural avatar. */
  onAvatarFallback?: () => void;
  /** Fired once the avatar (real or fallback) is mounted and on screen. */
  onReady?: () => void;
}

/**
 * Fixed camera (no zoom / pan / rotate) that eases between the two framings,
 * so switching voice ↔ chat glides instead of jump-cutting.
 *
 * Stage framing on a wide canvas pans the shot so the avatar stands on the
 * RIGHT of the frame, keeping the whole left/bottom-left clear for the voice
 * captions and controls — nothing ever overlaps the face. On narrow (mobile)
 * canvases there is no side room, so it raises the face to the upper third
 * instead and the overlay stays centred below it.
 */
function CameraRig({ framing }: { framing: "portrait" | "stage" | "companion" }) {
  const controls = useRef<OrbitControlsImpl>(null);
  useFrame((state, dt) => {
    const stage = framing === "stage";
    const aspect = state.size.width / state.size.height;
    // Below the CSS breakpoint the layout stacks and nothing overlays the
    // stage sideways, so the shot must centre. Aspect alone can't tell this:
    // the stacked chat-view stage on a phone is short and WIDE (~1.5), which
    // would otherwise read as a desktop overlay canvas and pan the model.
    const stacked = window.innerWidth <= 820;
    const wide = !stacked && aspect > 1.4;

    let camX: number;
    let camY: number;
    let camZ: number;
    let targetY: number;
    const halfFovTan = Math.tan((30 * Math.PI) / 360);
    if (framing === "companion") {
      // V2's dedicated portrait includes the crown and shoulders at any aspect.
      // Existing ecommerce portrait/stage framing is unchanged.
      const top = 0.78, bottom = -1.1;
      camZ = Math.min(6, Math.max((top-bottom)/(2*halfFovTan),1.1/(2*halfFovTan*aspect)));
      targetY = (top+bottom)/2;
      camY = targetY + 0.12;
      camX = 0;
    } else if (stacked && stage) {
      // Phone canvas in voice view: a head-and-shoulders portrait cropped in a
      // fixed vertical window — headroom above the crown (~0.5) down to the
      // collarbone, so the frame always ends above the chest. The width guard
      // only kicks in on very narrow canvases so the hair never clips.
      const TOP = 0.62;
      const BOTTOM = -1.05;
      const fitHeight = (TOP - BOTTOM) / (2 * halfFovTan);
      const fitWidth = 0.9 / (2 * halfFovTan * aspect);
      camZ = Math.min(6, Math.max(fitHeight, fitWidth));
      targetY = TOP - halfFovTan * camZ;
      camY = targetY + 0.15;
      camX = 0;
    } else {
      camY = stage ? (wide ? -0.1 : -0.24) : -0.05;
      camZ = stage ? (wide ? 2.5 : 2.6) : wide ? 2.35 : 2.2;
      targetY = stage ? (wide ? -0.16 : -0.4) : -0.1;

      // Pan as a FRACTION of the visible width so the model lands in the free
      // half at any window size: voice → right of the caption column, chat →
      // centred in the half not covered by the chat panel.
      const visibleWidth = 2 * camZ * halfFovTan * aspect;
      camX = !wide ? 0 : stage ? -0.17 * visibleWidth : 0.23 * visibleWidth;
    }

    const k = Math.min(1, dt * 3.5); // frame-rate independent easing
    state.camera.position.x += (camX - state.camera.position.x) * k;
    state.camera.position.y += (camY - state.camera.position.y) * k;
    state.camera.position.z += (camZ - state.camera.position.z) * k;
    const t = controls.current?.target;
    if (t) {
      t.x += (camX - t.x) * k;
      t.y += (targetY - t.y) * k;
      controls.current?.update();
    }
  });
  return (
    <OrbitControls
      ref={controls}
      enableZoom={false}
      enablePan={false}
      enableRotate={false}
      target={[0, -0.1, 0]}
    />
  );
}

export function AvatarScene({
  avatarUrl,
  thinking = false,
  speaking = false,
  framing = "portrait",
  onAvatarFallback,
  onReady,
}: AvatarSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, -0.05, 2.2], fov: 30 }}
      dpr={[1, 2]}
      // React instantly to container resizes (the default ~200ms debounce
      // visibly stretches the model when the voice/chat layout switches).
      resize={{ debounce: 0 }}
      gl={{
        antialias: true,
        alpha: true,
        // Filmic tone mapping rolls off highlights gracefully, so skin looks lit
        // rather than blown out — the difference between "render" and "webcam".
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
    >
      {/* Key + cool fill + warm rim for depth and a lively skin tone. The
          Environment below does most of the soft, wrap-around lighting; these
          direct lights add shape and a crisp catch-light. */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 3, 3]} intensity={1.15} />
      <directionalLight position={[-3, 2, 1]} intensity={0.45} color="#b9c7ff" />
      {/* Rim light from behind: separates the head from the background. */}
      <directionalLight position={[-1, 2, -3]} intensity={0.8} color="#ffe0c2" />

      {/* Self-contained studio HDRI, assembled from lightformers and baked once. */}
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2.2} position={[0, 1, 3]} scale={[6, 6, 1]} color="#ffffff" />
        <Lightformer intensity={0.9} position={[-3, 1, 2]} scale={[4, 5, 1]} color="#c3d4ff" />
        <Lightformer intensity={0.7} position={[3, 0, 2]} scale={[4, 5, 1]} color="#ffd9c7" />
        <Lightformer intensity={1.1} position={[0, 3, -2]} scale={[8, 3, 1]} color="#ffffff" />
      </Environment>

      <AvatarErrorBoundary
        key={avatarUrl}
        fallback={<ProceduralAvatar thinking={thinking} onReady={onReady} />}
        onError={() => onAvatarFallback?.()}
      >
        <Suspense fallback={<LoadingPlaceholder />}>
          {isSherryModel(avatarUrl) ? (
            <SherryAvatar url={avatarUrl} thinking={thinking} speaking={speaking} onReady={onReady} />
          ) : (
            <RpmAvatar url={avatarUrl} thinking={thinking} onReady={onReady} />
          )}
        </Suspense>
      </AvatarErrorBoundary>

      <CameraRig framing={framing} />
    </Canvas>
  );
}

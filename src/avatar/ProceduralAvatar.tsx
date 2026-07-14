/**
 * A built-in, dependency-free stylised head used as a GUARANTEED fallback when a
 * Ready Player Me GLB can't be loaded (bad URL, offline, blocked host). It shares
 * the same {@link LifeController} as the real avatar, so even the fallback has
 * darting eyes, natural blinks, brow lifts and organic head motion — the app's
 * core "feels alive" demo never breaks, and it costs nothing.
 */
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import { speechEngine } from "../audio/speechEngine";
import { LifeController } from "./lifeController";

interface ProceduralAvatarProps {
  /** True while the assistant is processing — plays a "thinking" pose. */
  thinking?: boolean;
  /** Fired once this fallback head mounts and is on screen. */
  onReady?: () => void;
}

export function ProceduralAvatar({ thinking = false, onReady }: ProceduralAvatarProps) {
  const root = useRef<Group>(null);
  const head = useRef<Group>(null);
  const mouth = useRef<Mesh>(null);
  const leftEye = useRef<Group>(null);
  const rightEye = useRef<Group>(null);
  const leftPupil = useRef<Mesh>(null);
  const rightPupil = useRef<Mesh>(null);
  const brows = useRef<Group>(null);
  const leftBrow = useRef<Mesh>(null);
  const rightBrow = useRef<Mesh>(null);

  const life = useRef(new LifeController());

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const level = speechEngine.getLevel(t);
    const f = life.current.update(t, delta, level, thinking);

    // Mouth opens with the jaw signal; narrows slightly, like a real aperture.
    if (mouth.current) {
      mouth.current.scale.y = 0.1 + f.jaw * 1.5 + f.mouthOpen * 0.4;
      mouth.current.scale.x = 1 - f.jaw * 0.12 + f.smile * 0.25;
    }

    // Blink: squash the whole eye vertically (1 = open, 0 = shut).
    const open = 1 - f.blink;
    if (leftEye.current) leftEye.current.scale.y = open;
    if (rightEye.current) rightEye.current.scale.y = open;

    // Living eyes: translate the pupils across the eyeball with the gaze signal.
    const gx = f.gazeX * 0.06;
    const gy = f.gazeY * 0.05;
    if (leftPupil.current) leftPupil.current.position.set(gx, gy, 0.14);
    if (rightPupil.current) rightPupil.current.position.set(gx, gy, 0.14);

    // Brows lift on emphasis / upward glances, and lower into a furrow while
    // thinking — the inner ends also angle down toward the nose (concentration).
    if (brows.current) brows.current.position.y = 0.42 + f.browInner * 0.06 - f.browDown * 0.05;
    if (leftBrow.current) leftBrow.current.rotation.z = -0.1 + f.browDown * 0.5;
    if (rightBrow.current) rightBrow.current.rotation.z = 0.1 - f.browDown * 0.5;

    // Organic head pose (noise + gaze follow) and a gentle breathing bob.
    if (head.current) head.current.rotation.set(f.headPitch, f.headYaw, f.headRoll);
    if (root.current) root.current.position.y = 0.05 + f.bob * 6;
  });

  // Scaled down so it frames like an RPM head at the shared camera distance.
  return (
    <group ref={root} position={[0, 0.05, 0]} scale={0.3}>
      <group ref={head}>
        {/* Head */}
        <mesh>
          <sphereGeometry args={[1, 48, 48]} />
          <meshStandardMaterial color="#f2c9a0" roughness={0.6} metalness={0} />
        </mesh>

        {/* Hair cap */}
        <mesh position={[0, 0.35, -0.05]} scale={[1.02, 0.9, 1.02]}>
          <sphereGeometry args={[1, 40, 40, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color="#e8c987" roughness={0.7} metalness={0.05} />
        </mesh>

        {/* Brows */}
        <group ref={brows} position={[0, 0.42, 0.88]}>
          <mesh ref={leftBrow} position={[-0.35, 0, 0]} rotation={[0, 0, -0.1]}>
            <boxGeometry args={[0.28, 0.05, 0.06]} />
            <meshStandardMaterial color="#8a6a3a" roughness={0.8} />
          </mesh>
          <mesh ref={rightBrow} position={[0.35, 0, 0]} rotation={[0, 0, 0.1]}>
            <boxGeometry args={[0.28, 0.05, 0.06]} />
            <meshStandardMaterial color="#8a6a3a" roughness={0.8} />
          </mesh>
        </group>

        {/* Eyes: each group squashes vertically to blink; the pupil inside
            translates across the eyeball to follow the gaze. */}
        <group ref={leftEye} position={[-0.35, 0.15, 0.86]}>
          <mesh>
            <sphereGeometry args={[0.17, 32, 32]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} />
          </mesh>
          <mesh ref={leftPupil} position={[0, 0, 0.14]}>
            <sphereGeometry args={[0.08, 24, 24]} />
            <meshStandardMaterial color="#3a2f52" roughness={0.2} />
          </mesh>
        </group>
        <group ref={rightEye} position={[0.35, 0.15, 0.86]}>
          <mesh>
            <sphereGeometry args={[0.17, 32, 32]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} />
          </mesh>
          <mesh ref={rightPupil} position={[0, 0, 0.14]}>
            <sphereGeometry args={[0.08, 24, 24]} />
            <meshStandardMaterial color="#3a2f52" roughness={0.2} />
          </mesh>
        </group>

        {/* Mouth (scales open with speech) */}
        <mesh ref={mouth} position={[0, -0.4, 0.9]}>
          <boxGeometry args={[0.44, 0.12, 0.12]} />
          <meshStandardMaterial color="#7a2b3a" roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

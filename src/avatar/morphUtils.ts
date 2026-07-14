import type { Object3D } from "three";
import { Mesh } from "three";

/** A mesh that carries morph targets (RPM head/teeth/eyes meshes do). */
export interface MorphMesh extends Mesh {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
}

/** Collect every mesh in a subtree that exposes morph targets. */
export function collectMorphMeshes(root: Object3D): MorphMesh[] {
  const meshes: MorphMesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (
      (mesh as Mesh).isMesh &&
      (mesh as MorphMesh).morphTargetDictionary &&
      (mesh as MorphMesh).morphTargetInfluences
    ) {
      meshes.push(mesh as MorphMesh);
    }
  });
  return meshes;
}

/** Set a named morph influence on every mesh that has it. */
export function setMorph(meshes: MorphMesh[], name: string, value: number): void {
  for (const mesh of meshes) {
    const index = mesh.morphTargetDictionary[name];
    if (index !== undefined) mesh.morphTargetInfluences[index] = value;
  }
}

import type * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { downloadBlob } from '../utils/download';

/**
 * Export objects as binary glTF. Vertex colors survive; the GLSL growth
 * shading is approximated by the baked vertex colors and Lambert response.
 */
export async function exportGlb(
  objects: readonly THREE.Object3D[],
  filename: string
): Promise<void> {
  if (objects.length === 0) {
    throw new Error('Nothing to export.');
  }
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(objects as THREE.Object3D[], {
    binary: true,
    onlyVisible: true
  });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('GLB export did not produce binary output.');
  }
  downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), filename);
}

export function exportPngDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

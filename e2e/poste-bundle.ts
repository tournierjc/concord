import { createMediaPlane } from '../src/engine/rtc/media-plane.ts';
import { createMesh } from '../src/engine/net/mesh.ts';

// Bundle de test (e2e) : le plan media + le maillage de PRODUCTION, exposés à la page.
// esbuild installe ses helpers (`__name`) en tête de bundle IIFE via ce footer.
(globalThis as any).__name = (target: unknown) => target;

(globalThis as any).__factory = { createMediaPlane, createMesh };

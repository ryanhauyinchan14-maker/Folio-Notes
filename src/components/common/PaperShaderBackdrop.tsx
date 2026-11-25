import React, { useEffect, useState } from 'react';
import { MeshGradient, StaticMeshGradient } from '@paper-design/shaders-react';

export const FOLIO_SHADER_COLORS: string[] = ['#DBF2FC', '#9AD7F7', '#072D59', '#FD6E88'];

let cachedWebGLSupport: boolean | null = null;

function canUseWebGL(): boolean {
  if (cachedWebGLSupport !== null) return cachedWebGLSupport;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    cachedWebGLSupport = false;
    return false;
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    cachedWebGLSupport = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { powerPreference: 'low-power' }) ??
      canvas.getContext('webgl', { powerPreference: 'low-power' }) ??
      canvas.getContext('experimental-webgl');
    cachedWebGLSupport = Boolean(gl);
  } catch {
    cachedWebGLSupport = false;
  }
  return cachedWebGLSupport;
}

class ShaderErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export interface PaperShaderBackdropProps {
  variant: 'hero' | 'static-accent';
  className?: string;
  paused?: boolean;
  'data-testid'?: string;
}

export const PaperShaderBackdrop: React.FC<PaperShaderBackdropProps> = ({
  variant,
  className = '',
  paused = false,
  'data-testid': explicitTestId,
}) => {
  const testId =
    explicitTestId ?? (variant === 'hero' ? 'home-hero-shader' : 'static-shader-accent');

  const [windowFocused, setWindowFocused] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden && document.hasFocus(),
  );
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (variant !== 'hero' || typeof window === 'undefined') return;

    const handleFocus = () => setWindowFocused(!document.hidden);
    const handleBlur = () => setWindowFocused(false);
    const handleVisibility = () => setWindowFocused(!document.hidden && document.hasFocus());

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);

    const mq =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const handleMotionChange = () => setReducedMotion(Boolean(mq?.matches));
    mq?.addEventListener?.('change', handleMotionChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
      mq?.removeEventListener?.('change', handleMotionChange);
    };
  }, [variant]);

  const fallbackMesh = (
    <div
      data-testid={testId}
      data-shader-mode="css-fallback"
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{
        background:
          variant === 'hero'
            ? [
                'radial-gradient(62% 115% at 88% 14%, rgba(253, 110, 136, 0.36) 0%, rgba(253, 110, 136, 0) 68%)',
                'radial-gradient(56% 105% at 72% 86%, rgba(7, 45, 89, 0.28) 0%, rgba(7, 45, 89, 0) 68%)',
                'radial-gradient(75% 110% at 38% 12%, #9AD7F7 0%, rgba(154, 215, 247, 0.35) 54%, rgba(219, 242, 252, 0) 100%)',
                'linear-gradient(125deg, #DBF2FC 0%, #B7E4FA 50%, #E7D8EB 100%)',
              ].join(', ')
            : [
                'radial-gradient(68% 120% at 86% 20%, rgba(253, 110, 136, 0.32) 0%, rgba(253, 110, 136, 0) 70%)',
                'radial-gradient(60% 100% at 20% 80%, rgba(7, 45, 89, 0.16) 0%, rgba(7, 45, 89, 0) 68%)',
                'linear-gradient(135deg, #DBF2FC 0%, #9AD7F7 55%, #F2DCE6 100%)',
              ].join(', '),
      }}
    />
  );

  if (!canUseWebGL()) {
    return fallbackMesh;
  }

  const activeSpeed = !paused && windowFocused && !reducedMotion ? 0.18 : 0;

  return (
    <ShaderErrorBoundary fallback={fallbackMesh}>
      <div
        data-testid={testId}
        data-shader-mode="webgl"
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      >
        {variant === 'hero' ? (
          <MeshGradient
            colors={FOLIO_SHADER_COLORS}
            distortion={0.62}
            swirl={0.14}
            grainMixer={0.14}
            grainOverlay={0.12}
            scale={1.15}
            speed={activeSpeed}
            fit="cover"
            maxPixelCount={1280 * 720}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <StaticMeshGradient
            colors={FOLIO_SHADER_COLORS}
            positions={2}
            waveX={0.85}
            waveXShift={0.4}
            waveY={0.75}
            waveYShift={0.2}
            mixing={0.9}
            grainMixer={0.12}
            grainOverlay={0.1}
            rotation={240}
            fit="cover"
            maxPixelCount={800 * 400}
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>
    </ShaderErrorBoundary>
  );
};

import React from 'react';
import { BookOpen, Lock } from 'lucide-react';
import { isDarkColor } from '../../canvas/paperRenderer';
import type { CoverConfig } from '../../types/notes';

interface CoverPreviewProps {
  cover: CoverConfig;
  title?: string;
  locked?: boolean;
  compact?: boolean;
  className?: string;
}

const COVER_GRAIN_SVG =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.14'/%3E%3C/svg%3E\")";

export const CoverPreview: React.FC<CoverPreviewProps> = ({
  cover,
  title,
  locked = false,
  compact = false,
  className = '',
}) => {
  const hasImage = cover.styleId === 'custom-image' && Boolean(cover.customImageDataUrl);
  const darkSurface = hasImage || isDarkColor(cover.primaryColor);

  const backgroundStyle: React.CSSProperties = hasImage
    ? {
        backgroundImage: `url(${cover.customImageDataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : cover.pattern === 'gradient'
      ? {
          backgroundImage: `linear-gradient(145deg, ${cover.primaryColor} 0%, ${cover.accentColor} 100%)`,
        }
      : {
          backgroundColor: cover.primaryColor,
        };

  return (
    <div
      className={`relative overflow-hidden rounded-r-xl rounded-l-[4px] ring-1 ring-[#072D59]/18 select-none ${className}`}
      style={{
        ...backgroundStyle,
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.36), inset 0 -1px 0 rgba(7, 45, 89, 0.18), 0 10px 22px -8px rgba(7, 45, 89, 0.25), 0 3px 8px rgba(7, 45, 89, 0.1)',
      }}
    >
      {/* Ambient Cover Light Falloff */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18)_0%,transparent_44%,rgba(7,45,89,0.14)_100%)]" />

      {/* Subtle Scrim over custom images so direct white ink remains high contrast */}
      {hasImage && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#072D59]/65 via-[#072D59]/25 to-[#072D59]/15" />
      )}

      {/* Subtle Cloth / Paperboard Grain */}
      {!hasImage && (
        <div
          className="pointer-events-none absolute inset-0 opacity-45 mix-blend-soft-light"
          style={{ backgroundImage: COVER_GRAIN_SVG }}
        />
      )}

      {/* Pattern overlays when not using custom image */}
      {!hasImage && cover.pattern === 'dots' && (
        <div
          className="pointer-events-none absolute inset-0 opacity-22"
          style={{
            backgroundImage: `radial-gradient(${cover.accentColor} 1.5px, transparent 1.5px)`,
            backgroundSize: '14px 14px',
          }}
        />
      )}

      {!hasImage && cover.pattern === 'grid' && (
        <div
          className="pointer-events-none absolute inset-0 opacity-18"
          style={{
            backgroundImage: `linear-gradient(${cover.accentColor} 1px, transparent 1px), linear-gradient(90deg, ${cover.accentColor} 1px, transparent 1px)`,
            backgroundSize: '18px 18px',
          }}
        />
      )}

      {/* Subtle Left-Edge 10px Spine Crease Ridge */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-[10px]"
        style={{
          background:
            'linear-gradient(90deg, rgba(7,45,89,0.42) 0%, rgba(7,45,89,0.18) 52%, rgba(255,255,255,0.28) 82%, transparent 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-y-0 left-[10px] w-px bg-white/25" />

      {/* Physical Right-Edge 2.5px Cream Paper-Stack Edge (#F8F6F0) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[3px] right-0 w-[2.5px] bg-[#F8F6F0] shadow-[inset_1px_0_1px_rgba(7,45,89,0.18)]"
      />
      <div className="pointer-events-none absolute inset-y-[3px] right-[2.5px] w-px bg-black/15" />

      {/* Subtle Accent Spine Band */}
      {!hasImage && cover.pattern === 'spine-band' && (
        <div
          className="pointer-events-none absolute inset-x-0 top-1/4 h-2 opacity-75"
          style={{ backgroundColor: cover.accentColor }}
        />
      )}

      {/* Vault-Locked Security Weave & Clean Frosted Glass Top-Right Lock Badge */}
      {locked && (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-10 backdrop-blur-[1.5px]"
            style={{
              backgroundImage: darkSurface
                ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 8px)'
                : 'repeating-linear-gradient(135deg, rgba(7,45,89,0.06) 0px, rgba(7,45,89,0.06) 1px, transparent 1px, transparent 8px)',
            }}
          />
          <div
            data-testid="locked-notebook-badge"
            className={`pointer-events-none absolute right-2.5 top-2.5 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-md ${
              darkSurface
                ? 'bg-white/20 text-white ring-1 ring-white/30'
                : 'bg-[#072D59]/12 text-[#072D59] ring-1 ring-[#072D59]/20'
            }`}
          >
            <Lock className="h-3 w-3 text-[#FD6E88]" />
            {!compact && <span>Locked</span>}
          </div>
        </>
      )}

      {/* Direct Cover Typography (High-contrast ink on cover surface — no white sticker box) */}
      {title !== undefined && (
        <div
          className={`relative z-20 flex h-full flex-col justify-between ${
            compact ? 'p-2.5 pl-4' : 'px-4 py-4 pl-5 pr-4'
          }`}
        >
          <div className={compact ? 'mt-0.5' : 'mt-1.5'}>
            <div
              className={`line-clamp-3 font-bold tracking-[-0.02em] ${
                compact ? 'text-[9px] leading-tight' : 'text-[14px] leading-snug'
              } ${darkSurface ? 'text-[#F8FAFC]' : 'text-[#072D59]'}`}
              style={
                darkSurface
                  ? { textShadow: '0 1px 2px rgba(7, 45, 89, 0.35)' }
                  : undefined
              }
            >
              {title || 'Untitled Notebook'}
            </div>
            {!compact && (
              <div
                className={`mt-2 h-px w-8 rounded-full ${
                  darkSurface ? 'bg-white/35' : 'bg-[#072D59]/25'
                }`}
              />
            )}
          </div>

          {!compact && (
            <div className="flex items-center justify-end">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  darkSurface ? 'bg-white/12 text-white/75' : 'bg-[#072D59]/10 text-[#072D59]/70'
                }`}
              >
                <BookOpen className="h-2.5 w-2.5" />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { FileText, Lock, Palette, Presentation } from 'lucide-react';
import { isDarkColor } from '../../canvas/paperRenderer';
import type { CoverConfig, NotebookMode } from '../../types/notes';

interface CoverPreviewProps {
  cover: CoverConfig;
  title?: string;
  mode?: NotebookMode;
  locked?: boolean;
  compact?: boolean;
  className?: string;
}

const COVER_GRAIN_SVG =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.14'/%3E%3C/svg%3E\")";

export const CoverPreview: React.FC<CoverPreviewProps> = ({
  cover,
  title,
  mode = 'notebook',
  locked = false,
  compact = false,
  className = '',
}) => {
  const isWhiteboard = mode === 'whiteboard';
  const isNotes = mode === 'notes';
  const isSlides = mode === 'slides';
  const hasImage = cover.styleId === 'custom-image' && Boolean(cover.customImageDataUrl);
  const isInsetImage =
    hasImage &&
    (cover.imagePresentation === 'inset' ||
      (cover.imagePresentation === undefined &&
        cover.primaryColor.toLowerCase() === '#072d59' &&
        cover.accentColor.toLowerCase() === '#dbf2fc' &&
        cover.pattern === 'solid'));
  const isFullBleedImage = hasImage && !isInsetImage;
  const darkSurface = isFullBleedImage || isDarkColor(cover.primaryColor);

  const backgroundStyle: React.CSSProperties = isFullBleedImage
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
      data-cover-presentation={isInsetImage ? 'inset' : isFullBleedImage ? 'full' : 'standard'}
      className={`relative overflow-hidden rounded-r-2xl rounded-l-[5px] ring-1 ring-[var(--border-strong)] select-none transition-shadow duration-200 group-hover:shadow-[var(--shadow-card-hover)] ${className}`}
      style={{
        ...backgroundStyle,
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.38), inset 0 -1px 0 rgba(7, 45, 89, 0.16), 0 1px 2px rgba(7, 45, 89, 0.06), 0 12px 26px -8px rgba(7, 45, 89, 0.22)',
      }}
    >
      {/* Ambient Cover Light Falloff */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.20)_0%,transparent_44%,rgba(7,45,89,0.16)_100%)]" />

      {/* Subtle Scrim over full-bleed custom images so direct white ink remains high contrast */}
      {isFullBleedImage && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#072D59]/65 via-[#072D59]/25 to-[#072D59]/15" />
      )}

      {/* Subtle Cloth / Paperboard Grain */}
      {!isFullBleedImage && (
        <div
          className="pointer-events-none absolute inset-0 opacity-45 mix-blend-soft-light"
          style={{ backgroundImage: COVER_GRAIN_SVG }}
        />
      )}

      {/* Subtle Debossed Notebook Outline Frame for Inset PDF / Document Previews */}
      {isInsetImage && !compact && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-2.5 left-[18px] right-[9px] rounded-r-xl rounded-l-[3px] border border-white/16"
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

      {/* Sculpted Left-Edge 12px Spine Crease Shadow Ridge & Bevel */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-[12px]"
        style={{
          background:
            'linear-gradient(90deg, rgba(5,33,66,0.44) 0%, rgba(7,45,89,0.22) 48%, rgba(255,255,255,0.32) 78%, transparent 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-y-0 left-[12px] w-px bg-white/25" />

      {/* Physical Right-Edge 2.5px Cream Paper-Stack Edge (#F8F6F0) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[3px] right-0 w-[2.5px] bg-[#F8F6F0] shadow-[inset_1px_0_1px_rgba(7,45,89,0.16)]"
      />
      <div className="pointer-events-none absolute inset-y-[3px] right-[2.5px] w-px bg-[#072D59]/18" />

      {/* Subtle Accent Spine Band */}
      {!hasImage && cover.pattern === 'spine-band' && (
        <div
          className="pointer-events-none absolute inset-x-0 top-1/4 h-2 opacity-75"
          style={{ backgroundColor: cover.accentColor }}
        />
      )}

      {/* Compact Inset Thumbnail Preview (when no title, e.g., swatch thumbnails) */}
      {isInsetImage && title === undefined && (
        <div className="pointer-events-none relative z-10 flex h-full w-full items-center justify-center pl-[14px] pr-[6px] py-2">
          <div className="flex max-h-[72%] max-w-[74%] items-center justify-center rounded-[3px] bg-white p-[2px] shadow-md ring-1 ring-white/80">
            <img
              src={cover.customImageDataUrl}
              alt=""
              draggable={false}
              className="max-h-full max-w-full rounded-[2px] object-contain"
            />
          </div>
        </div>
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
            compact ? 'p-2.5 pl-4' : isInsetImage ? 'px-4 py-3.5 pl-6 pr-4' : 'px-4 py-4 pl-5 pr-4'
          }`}
        >
          <div className={compact ? 'mt-0.5 shrink-0' : isInsetImage ? 'mt-0.5 shrink-0' : 'mt-1.5'}>
            <div
              className={`${isInsetImage ? 'line-clamp-2' : 'line-clamp-3'} font-bold tracking-[-0.02em] ${
                compact
                  ? 'text-[9px] leading-tight'
                  : isInsetImage
                    ? 'text-[12.5px] leading-snug'
                    : 'text-[14px] leading-snug'
              } ${darkSurface ? 'text-[#F8FAFC]' : 'text-[#072D59]'}`}
              style={
                darkSurface
                  ? { textShadow: '0 1px 2px rgba(7, 45, 89, 0.35)' }
                  : undefined
              }
            >
              {title || 'Untitled Canvas'}
            </div>
            {!compact && (
              <div
                className={`${isInsetImage ? 'mt-1.5' : 'mt-2'} h-px w-8 rounded-full ${
                  darkSurface ? 'bg-white/35' : 'bg-[#072D59]/25'
                }`}
              />
            )}
          </div>

          {/* Smaller, Centered Framed Mini-Page Preview inside Notebook Cover Outline */}
          {isInsetImage && (
            <div
              data-testid="pdf-inset-cover-preview"
              className="flex min-h-0 flex-1 items-center justify-center py-2"
            >
              <div
                className={`relative flex items-center justify-center overflow-hidden bg-white ${
                  compact
                    ? 'max-h-[34px] max-w-[78%] rounded-[3px] p-[2px] shadow-xs'
                    : 'max-h-full max-w-[74%] rounded-[6px] p-[4px] shadow-[0_8px_18px_rgba(3,18,38,0.45),0_1px_3px_rgba(3,18,38,0.28)] ring-1 ring-white/85'
                }`}
              >
                <img
                  src={cover.customImageDataUrl}
                  alt=""
                  draggable={false}
                  className="block max-h-[112px] w-auto max-w-full rounded-[3px] border border-[#072D59]/10 object-contain"
                />
              </div>
            </div>
          )}

          {!compact && (
            <div className="flex shrink-0 items-center justify-between gap-2">
              {isWhiteboard ? (
                <span
                  data-testid="whiteboard-cover-badge"
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide backdrop-blur-xs ${
                    darkSurface
                      ? 'bg-white/18 text-white ring-1 ring-white/25'
                      : 'bg-[#072D59]/10 text-[#072D59] ring-1 ring-[#072D59]/18'
                  }`}
                >
                  <Presentation className="h-3 w-3 text-[#FD6E88]" />
                  <span>Infinite Board</span>
                </span>
              ) : isNotes ? (
                <span
                  data-testid="notes-cover-badge"
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide backdrop-blur-xs ${
                    darkSurface
                      ? 'bg-white/18 text-white ring-1 ring-white/25'
                      : 'bg-[#072D59]/10 text-[#072D59] ring-1 ring-[#072D59]/18'
                  }`}
                >
                  <FileText className="h-3 w-3 text-[#FD6E88]" />
                  <span>Docs</span>
                </span>
              ) : isSlides ? (
                <span
                  data-testid="slides-cover-badge"
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide backdrop-blur-xs ${
                    darkSurface
                      ? 'bg-white/18 text-white ring-1 ring-white/25'
                      : 'bg-[#072D59]/10 text-[#072D59] ring-1 ring-[#072D59]/18'
                  }`}
                >
                  <Presentation className="h-3 w-3 text-[#FD6E88]" />
                  <span>Slides</span>
                </span>
              ) : (
                <>
                  <span
                    data-testid="drawing-cover-badge"
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide backdrop-blur-xs ${
                      darkSurface
                        ? 'bg-white/18 text-white ring-1 ring-white/25'
                        : 'bg-[#072D59]/10 text-[#072D59] ring-1 ring-[#072D59]/18'
                    }`}
                  >
                    <Palette className="h-3 w-3 text-[#FD6E88]" />
                    <span>Drawing</span>
                  </span>
                  {isInsetImage && (
                    <span className="rounded-full bg-[#DBF2FC]/22 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#DBF2FC] ring-1 ring-[#DBF2FC]/30">
                      PDF
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import type { SlideElement, SlideShapeElement } from '../../types/notes';

interface SlideElementNodeProps {
  element: SlideElement;
  editing?: boolean;
  onChangeText?: (nextText: string) => void;
  onFinishEdit?: () => void;
}

const ShapeSvg: React.FC<{ el: SlideShapeElement }> = ({ el }) => {
  const { width: w, height: h, fillColor, strokeColor, strokeWidth, cornerRadius, shape } = el;
  const stroke = strokeWidth > 0 ? strokeColor : 'none';
  const fill = fillColor || 'transparent';

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`}
      preserveAspectRatio="none"
      className="block overflow-visible"
    >
      {shape === 'circle' && (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(1, w / 2 - strokeWidth / 2)}
          ry={Math.max(1, h / 2 - strokeWidth / 2)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {(shape === 'rect' || shape === 'rounded-rect' || shape === 'pill') && (
        <rect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={Math.max(1, w - strokeWidth)}
          height={Math.max(1, h - strokeWidth)}
          rx={shape === 'pill' ? Math.min(w, h) / 2 : cornerRadius}
          ry={shape === 'pill' ? Math.min(w, h) / 2 : cornerRadius}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {shape === 'triangle' && (
        <polygon
          points={`${w / 2},${strokeWidth} ${w - strokeWidth},${h - strokeWidth} ${strokeWidth},${h - strokeWidth}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {shape === 'star' && (
        <polygon
          points={`${w * 0.5},${h * 0.04} ${w * 0.62},${h * 0.36} ${w * 0.97},${h * 0.36} ${w * 0.69},${h * 0.58} ${w * 0.79},${h * 0.94} ${w * 0.5},${h * 0.72} ${w * 0.21},${h * 0.94} ${w * 0.31},${h * 0.58} ${w * 0.03},${h * 0.36} ${w * 0.38},${h * 0.36}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {shape === 'arrow' && (
        <polygon
          points={`0,${h * 0.3} ${w * 0.68},${h * 0.3} ${w * 0.68},${h * 0.08} ${w},${h * 0.5} ${w * 0.68},${h * 0.92} ${w * 0.68},${h * 0.7} 0,${h * 0.7}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {shape === 'speech-bubble' && (
        <path
          d={`M 16 4 H ${w - 16} Q ${w - 4} 4 ${w - 4} 16 V ${h * 0.76} Q ${w - 4} ${h * 0.86} ${w - 16} ${h * 0.86} H ${w * 0.35} L ${w * 0.2} ${h - 2} L ${w * 0.22} ${h * 0.86} H 16 Q 4 ${h * 0.86} 4 ${h * 0.76} V 16 Q 4 4 16 4 Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {(shape === 'line' || shape === 'divider') && (
        <line
          x1={0}
          y1={h / 2}
          x2={w}
          y2={h / 2}
          stroke={fillColor !== 'transparent' ? fillColor : strokeColor}
          strokeWidth={Math.max(2, strokeWidth || 4)}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
};

export const SlideElementNode: React.FC<SlideElementNodeProps> = ({
  element,
  editing = false,
  onChangeText,
  onFinishEdit,
}) => {
  if (element.kind === 'shape') {
    return (
      <div
        className="h-full w-full"
        style={{
          filter: element.shadow ? 'drop-shadow(0 12px 24px rgba(7,45,89,0.16))' : undefined,
        }}
      >
        <ShapeSvg el={element} />
      </div>
    );
  }

  if (element.kind === 'image') {
    const transformParts: string[] = [];
    if (element.flipX) transformParts.push('scaleX(-1)');
    if (element.flipY) transformParts.push('scaleY(-1)');
    return (
      <img
        src={element.dataUrl}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: element.objectFit,
          borderRadius: `${element.borderRadius}px`,
          transform: transformParts.length > 0 ? transformParts.join(' ') : undefined,
          boxShadow: element.shadow ? '0 14px 32px rgba(7, 45, 89, 0.18)' : undefined,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        fontFamily: element.fontFamily,
        fontSize: `${element.fontSize}px`,
        fontWeight: element.bold ? 700 : 400,
        fontStyle: element.italic ? 'italic' : 'normal',
        textDecoration:
          [element.underline ? 'underline' : '', element.strikethrough ? 'line-through' : '']
            .filter(Boolean)
            .join(' ') || undefined,
        color: element.color,
        backgroundColor: element.backgroundColor || 'transparent',
        textAlign: element.align,
        lineHeight: element.lineHeight,
        padding: `${element.padding}px`,
        borderRadius: element.borderRadius ? `${element.borderRadius}px` : undefined,
      }}
      className="h-full w-full overflow-hidden whitespace-pre-wrap break-words"
    >
      {editing ? (
        <textarea
          autoFocus
          data-testid={`slide-text-editor-${element.id}`}
          value={element.text}
          onChange={(e) => onChangeText?.(e.target.value)}
          onBlur={onFinishEdit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              onFinishEdit?.();
            }
          }}
          style={{
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            fontStyle: 'inherit',
            color: 'inherit',
            textAlign: 'inherit',
            lineHeight: 'inherit',
          }}
          className="h-full w-full resize-none border-0 bg-transparent outline-none"
        />
      ) : (
        element.text
      )}
    </div>
  );
};

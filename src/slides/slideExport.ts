import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { drawCommittedStroke } from '../canvas/strokeRenderer';
import type {
  Page,
  SlideBackground,
  SlideImageElement,
  SlideShapeElement,
  SlideTextElement,
} from '../types/notes';
import { sanitizeExportFilename, triggerBlobDownload } from '../utils/exportNotebook';

function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  bg: SlideBackground,
  w: number,
  h: number,
  bgImg?: HTMLImageElement | null,
): void {
  if (bg.kind === 'image' && bgImg) {
    ctx.drawImage(bgImg, 0, 0, w, h);
    return;
  }
  if (bg.kind === 'gradient' && bg.gradient) {
    const colorMatches = bg.gradient.match(/#[0-9a-fA-F]{3,8}/g);
    if (colorMatches && colorMatches.length >= 2) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      colorMatches.forEach((hex, idx) => {
        grad.addColorStop(idx / Math.max(1, colorMatches.length - 1), hex);
      });
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      return;
    }
  }
  ctx.fillStyle = bg.color || '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
}

function drawRoundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawShape(ctx: CanvasRenderingContext2D, el: SlideShapeElement): void {
  const w = el.width;
  const h = el.height;
  ctx.fillStyle = el.fillColor;
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;

  if (el.shape === 'circle') {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (el.fillColor !== 'transparent') ctx.fill();
    if (el.strokeWidth > 0 && el.strokeColor !== 'transparent') ctx.stroke();
    return;
  }
  if (el.shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    if (el.fillColor !== 'transparent') ctx.fill();
    if (el.strokeWidth > 0 && el.strokeColor !== 'transparent') ctx.stroke();
    return;
  }
  if (el.shape === 'line' || el.shape === 'divider') {
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.strokeStyle = el.fillColor !== 'transparent' ? el.fillColor : el.strokeColor;
    ctx.lineWidth = Math.max(2, el.strokeWidth || 4);
    ctx.stroke();
    return;
  }
  drawRoundedPath(
    ctx,
    0,
    0,
    w,
    h,
    el.shape === 'pill' ? Math.min(w, h) / 2 : el.cornerRadius,
  );
  if (el.fillColor !== 'transparent') ctx.fill();
  if (el.strokeWidth > 0 && el.strokeColor !== 'transparent') ctx.stroke();
}

function drawTextElement(ctx: CanvasRenderingContext2D, el: SlideTextElement): void {
  if (el.backgroundColor) {
    drawRoundedPath(ctx, 0, 0, el.width, el.height, el.borderRadius ?? 0);
    ctx.fillStyle = el.backgroundColor;
    ctx.fill();
  }

  ctx.fillStyle = el.color;
  ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700 ' : '400 '}${el.fontSize}px ${el.fontFamily}`;
  ctx.textBaseline = 'top';
  const maxTextW = Math.max(20, el.width - el.padding * 2);
  const lineH = el.fontSize * (el.lineHeight || 1.3);
  const paragraphs = el.text.split('\n');
  let curY = el.padding;

  for (const para of paragraphs) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxTextW && line) {
        const alignX =
          el.align === 'center'
            ? el.width / 2
            : el.align === 'right'
              ? el.width - el.padding
              : el.padding;
        ctx.textAlign = el.align;
        ctx.fillText(line, alignX, curY);
        curY += lineH;
        line = word;
      } else {
        line = testLine;
      }
    }
    const alignX =
      el.align === 'center'
        ? el.width / 2
        : el.align === 'right'
          ? el.width - el.padding
          : el.padding;
    ctx.textAlign = el.align;
    ctx.fillText(line, alignX, curY);
    curY += lineH;
  }
}

export async function renderSlideToCanvas(
  slidePage: Page,
  scale = 1,
): Promise<HTMLCanvasElement> {
  const w = slidePage.paper.width;
  const h = slidePage.paper.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const slide = slidePage.slideData;
  const bgImg =
    slide?.background.kind === 'image' && slide.background.imageDataUrl
      ? await loadHtmlImage(slide.background.imageDataUrl)
      : null;

  ctx.save();
  ctx.scale(scale, scale);
  drawBackground(ctx, slide?.background ?? { kind: 'solid', color: '#FFFFFF' }, w, h, bgImg);

  const elements = [...(slide?.elements ?? [])].sort((a, b) => a.zIndex - b.zIndex);
  for (const el of elements) {
    ctx.save();
    ctx.globalAlpha = Math.max(0.05, Math.min(1, el.opacity ?? 1));
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
    if (el.rotation) {
      ctx.rotate((el.rotation * Math.PI) / 180);
    }
    ctx.translate(-el.width / 2, -el.height / 2);

    if (el.kind === 'shape') {
      drawShape(ctx, el);
    } else if (el.kind === 'text') {
      drawTextElement(ctx, el);
    } else if (el.kind === 'image') {
      const htmlImg = await loadHtmlImage((el as SlideImageElement).dataUrl);
      if (htmlImg) {
        drawRoundedPath(ctx, 0, 0, el.width, el.height, el.borderRadius);
        ctx.clip();
        if (el.flipX || el.flipY) {
          ctx.translate(el.width / 2, el.height / 2);
          ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
          ctx.translate(-el.width / 2, -el.height / 2);
        }
        ctx.drawImage(htmlImg, 0, 0, el.width, el.height);
      }
    }
    ctx.restore();
  }

  for (const stroke of slide?.inkStrokes ?? []) {
    drawCommittedStroke(ctx, stroke, false, false);
  }
  ctx.restore();

  return canvas;
}

export async function exportSlidesAsPdf(deckTitle: string, pages: Page[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(deckTitle || 'Folio Slides');
  for (const slidePage of pages) {
    const canvas = await renderSlideToCanvas(slidePage, 1);
    const pngDataUrl = canvas.toDataURL('image/png');
    const pngRes = await fetch(pngDataUrl);
    const pngBytes = new Uint8Array(await pngRes.arrayBuffer());
    const embedded = await doc.embedPng(pngBytes);
    const ptW = slidePage.paper.width * 0.75;
    const ptH = slidePage.paper.height * 0.75;
    const pdfPage = doc.addPage([ptW, ptH]);
    pdfPage.drawImage(embedded, { x: 0, y: 0, width: ptW, height: ptH });
  }
  return doc.save();
}

export async function exportSlidesAsPngZip(deckTitle: string, pages: Page[]): Promise<void> {
  const zip = new JSZip();
  for (let i = 0; i < pages.length; i++) {
    const canvas = await renderSlideToCanvas(pages[i], 1);
    const dataUrl = canvas.toDataURL('image/png');
    const b64 = dataUrl.split(',')[1] ?? '';
    zip.file(`slide-${String(i + 1).padStart(2, '0')}.png`, b64, { base64: true });
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(blob, `${sanitizeExportFilename(deckTitle)}-slides.zip`);
}

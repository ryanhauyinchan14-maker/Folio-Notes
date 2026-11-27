import type { PaperConfig, SlideData, SlideSizePresetId } from '../types/notes';
import { createSlideLayout, SLIDE_BACKGROUND_GRADIENTS } from './slideLayouts';
import { createStarterSlideData, resolveSlidePaperConfig } from './slidePresets';

export interface BuiltInSlideTemplate {
  id: string;
  name: string;
  aspectLabel: string;
  slideSizePreset: Exclude<SlideSizePresetId, 'custom'>;
  slideCount: number;
  previewBg: string;
  previewAccent: string;
  previewDark: boolean;
  buildDeck: () => { paper: PaperConfig; slides: SlideData[] };
}

function buildSlide(
  layoutId: 'title' | 'section' | 'bullets' | 'two-column' | 'stat-quote' | 'cards-3',
  width: number,
  height: number,
  speakerNotes = '',
): SlideData {
  const layout = createSlideLayout(layoutId, width, height);
  return {
    background: layout.background,
    elements: layout.elements,
    speakerNotes,
    transition: 'fade',
    inkStrokes: [],
  };
}

export const BUILT_IN_SLIDE_TEMPLATES: BuiltInSlideTemplate[] = [
  {
    id: 'tpl-slide-pitch',
    name: 'Pitch Deck',
    aspectLabel: '16:9 · 3 slides',
    slideSizePreset: '16:9',
    slideCount: 3,
    previewBg: 'linear-gradient(135deg, #FFFFFF 0%, #DBF2FC 100%)',
    previewAccent: '#FD6E88',
    previewDark: false,
    buildDeck: () => {
      const paper = resolveSlidePaperConfig('16:9');
      const slide1 = createStarterSlideData(paper.width, paper.height, 'Product Pitch Deck');
      slide1.speakerNotes = 'Introduce the core mission and problem statement.';
      const slide2 = buildSlide(
        'cards-3',
        paper.width,
        paper.height,
        'Walk through the three core pillars that differentiate the product.',
      );
      const slide3 = buildSlide(
        'two-column',
        paper.width,
        paper.height,
        'Compare the status quo with the proposed solution and next steps.',
      );
      return { paper, slides: [slide1, slide2, slide3] };
    },
  },
  {
    id: 'tpl-slide-study',
    name: 'Study Guide Deck',
    aspectLabel: '16:9 · 3 slides',
    slideSizePreset: '16:9',
    slideCount: 3,
    previewBg: 'linear-gradient(135deg, #072D59 0%, #0F4C81 100%)',
    previewAccent: '#FD6E88',
    previewDark: true,
    buildDeck: () => {
      const paper = resolveSlidePaperConfig('16:9');
      const slide1 = buildSlide(
        'section',
        paper.width,
        paper.height,
        'Topic title and high-level learning goals.',
      );
      const slide2 = buildSlide(
        'bullets',
        paper.width,
        paper.height,
        'Core definitions, equations, and examples.',
      );
      const slide3 = buildSlide(
        'stat-quote',
        paper.width,
        paper.height,
        'Memorable summary rule or closing theorem.',
      );
      return { paper, slides: [slide1, slide2, slide3] };
    },
  },
  {
    id: 'tpl-slide-portfolio',
    name: 'Creative Showcase',
    aspectLabel: '16:9 · 3 slides',
    slideSizePreset: '16:9',
    slideCount: 3,
    previewBg: SLIDE_BACKGROUND_GRADIENTS[2].gradient,
    previewAccent: '#072D59',
    previewDark: false,
    buildDeck: () => {
      const paper = resolveSlidePaperConfig('16:9');
      const slide1 = createStarterSlideData(paper.width, paper.height, 'Creative Showcase');
      slide1.background = { kind: 'gradient', gradient: SLIDE_BACKGROUND_GRADIENTS[2].gradient };
      const slide2 = buildSlide(
        'cards-3',
        paper.width,
        paper.height,
        'Highlight three selected case studies or deliverables.',
      );
      const slide3 = buildSlide(
        'stat-quote',
        paper.width,
        paper.height,
        'Closing creative statement or contact details.',
      );
      return { paper, slides: [slide1, slide2, slide3] };
    },
  },
  {
    id: 'tpl-slide-carousel',
    name: 'Square Carousel',
    aspectLabel: '1:1 · 3 slides',
    slideSizePreset: '1:1',
    slideCount: 3,
    previewBg: SLIDE_BACKGROUND_GRADIENTS[0].gradient,
    previewAccent: '#FD6E88',
    previewDark: false,
    buildDeck: () => {
      const paper = resolveSlidePaperConfig('1:1');
      const slide1 = createStarterSlideData(paper.width, paper.height, 'Quick Visual Guide');
      slide1.background = { kind: 'gradient', gradient: SLIDE_BACKGROUND_GRADIENTS[0].gradient };
      const slide2 = buildSlide(
        'bullets',
        paper.width,
        paper.height,
        'Main bite-sized points formatted for square swipe cards.',
      );
      const slide3 = buildSlide(
        'section',
        paper.width,
        paper.height,
        'Closing call-to-action card.',
      );
      return { paper, slides: [slide1, slide2, slide3] };
    },
  },
];

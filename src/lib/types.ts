// Shared domain types used by the web app, the worker and the database schema.

export type Viewport = "desktop" | "tablet" | "mobile";

export const VIEWPORTS: Record<
  Viewport,
  { width: number; height: number; isMobile: boolean; hasTouch: boolean; deviceScaleFactor: number; label: string }
> = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1, label: "Desktop" },
  tablet: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 1, label: "Tablet" },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1, label: "Mobile" },
};

export type ReferenceRole =
  | "full"
  | "identity"
  | "colors"
  | "typography"
  | "layout"
  | "navigation"
  | "animations"
  | "photography"
  | "components"
  | "content";

export const REFERENCE_ROLES: { id: ReferenceRole; label: string; description: string }[] = [
  { id: "full", label: "Full recreation", description: "Recreate this site as closely as possible: layout, look, motion and structure." },
  { id: "identity", label: "Visual identity", description: "Overall mood, brand personality and art direction." },
  { id: "colors", label: "Colors", description: "Palette, backgrounds, gradients and contrast." },
  { id: "typography", label: "Typography", description: "Font families, type scale, weights, tracking and casing." },
  { id: "layout", label: "Layout & spacing", description: "Grids, section composition, whitespace and proportions." },
  { id: "navigation", label: "Navigation & structure", description: "Menus, page hierarchy and information architecture." },
  { id: "animations", label: "Animations & interactions", description: "Scroll effects, transitions, hovers and motion." },
  { id: "photography", label: "Photography & media", description: "Image style, cropping, aspect ratios and video use." },
  { id: "components", label: "Components", description: "Buttons, cards, forms, galleries and other UI patterns." },
  { id: "content", label: "Content", description: "Copy tone, messaging and content structure (text is rewritten, not copied)." },
];

export interface ProjectSettings {
  maxPages: number;
  viewports: Viewport[];
  reuseMedia: boolean;
  autoGenerate: boolean;
  fidelityIterations: number;
  fidelityTarget: number;
  imageStrategy: "auto" | "reference" | "stock" | "generate";
  rightsConfirmed: boolean;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  maxPages: 6,
  viewports: ["desktop", "tablet", "mobile"],
  reuseMedia: true,
  autoGenerate: true,
  fidelityIterations: 2,
  fidelityTarget: 85,
  imageStrategy: "auto",
  rightsConfirmed: false,
};

// ---------------------------------------------------------------------------
// Extraction (raw, measured from the live DOM by the analysis engine)
// ---------------------------------------------------------------------------

export interface ColorStat {
  hex: string;
  /** Share of the measured surface (backgrounds) or of text characters (text). 0..1 */
  weight: number;
  count: number;
  samples: string[];
}

export interface TypeStyle {
  role: string; // h1..h6, body, nav, button, caption, label, display
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  fontStyle: string;
  color: string;
  count: number;
  /** Characters of text set in this style — the best measure of how much it is used. */
  chars?: number;
  sample: string;
}

export interface FontFaceInfo {
  family: string;
  weight: string;
  style: string;
  src: string;
  provider: "google" | "adobe" | "self-hosted" | "other";
}

export interface ButtonStyle {
  text: string;
  tag: string;
  background: string;
  color: string;
  border: string;
  radius: string;
  padding: string;
  fontSize: string;
  fontWeight: string;
  textTransform: string;
  letterSpacing: string;
  count: number;
}

export interface ImageInfo {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  aspectRatio: number;
  objectFit: string;
  objectPosition: string;
  top: number;
  kind: "img" | "picture" | "background" | "svg";
  section: number;
  loading?: string;
}

export interface VideoInfo {
  src: string;
  poster: string;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  isBackground: boolean;
  renderedWidth: number;
  renderedHeight: number;
  section: number;
  provider: "file" | "youtube" | "vimeo" | "other";
}

export interface NavLink {
  text: string;
  href: string;
  internal: boolean;
}

export interface SectionInfo {
  index: number;
  tag: string;
  selector: string;
  kind: string; // header, hero, nav, gallery, grid, split, text, cta, footer, media, carousel, form, unknown
  top: number;
  height: number;
  background: string;
  backgroundImage: string;
  textColor: string;
  headings: string[];
  excerpt: string;
  imageCount: number;
  videoCount: number;
  columns: number;
  layout: string;
  fullBleed: boolean;
  cropKey?: string;
}

export interface AnimationInfo {
  keyframes: string[];
  cssAnimations: { selector: string; name: string; duration: string; timing: string; iterations: string }[];
  transitions: { selector: string; property: string; duration: string; timing: string; count: number }[];
  scrollReveals: { selector: string; count: number; from: { opacity: string; transform: string }; to: { opacity: string; transform: string } }[];
  hoverEffects: { selector: string; text: string; changes: Record<string, [string, string]> }[];
  sticky: { selector: string; position: string; top: string; height: number }[];
  parallax: { selector: string; ratio: number }[];
  carousels: { selector: string; slides: number; library?: string }[];
  marquees: number;
  smoothScroll: boolean;
  scrollSnap: boolean;
  libraries: string[];
}

export interface PageExtraction {
  url: string;
  viewport: Viewport;
  width: number;
  documentHeight: number;
  title: string;
  description: string;
  lang: string;
  meta: Record<string, string>;
  favicon: string;
  colors: { text: ColorStat[]; background: ColorStat[]; border: ColorStat[]; accent: ColorStat[] };
  gradients: { value: string; count: number }[];
  typography: TypeStyle[];
  fonts: { families: { family: string; count: number; roles: string[] }[]; faces: FontFaceInfo[]; stylesheets: string[] };
  spacing: {
    containerWidths: { value: number; count: number }[];
    sectionPaddings: { value: string; count: number }[];
    gaps: { value: string; count: number }[];
  };
  radii: { value: string; count: number }[];
  shadows: { value: string; count: number }[];
  borders: { value: string; count: number }[];
  buttons: ButtonStyle[];
  navigation: {
    header: { links: NavLink[]; position: string; height: number; background: string; logo: { text: string; src: string } | null };
    footer: { links: NavLink[]; columns: number };
    hamburger: boolean;
  };
  internalLinks: NavLink[];
  images: ImageInfo[];
  videos: VideoInfo[];
  iframes: { src: string; width: number; height: number }[];
  sections: SectionInfo[];
  headings: { level: number; text: string }[];
  paragraphs: string[];
  forms: { action: string; method: string; fields: { type: string; name: string; label: string; required: boolean }[] }[];
  animations: AnimationInfo;
  tech: { libraries: string[]; generator: string; framework: string[] };
  responsive?: Partial<Record<"tablet" | "mobile", ResponsiveSummary>>;
  /** Pixel-true dominant colors of the rendered screenshot. */
  screenshotPalette?: { hex: string; weight: number }[];
}

export interface ResponsiveSummary {
  documentHeight: number;
  hamburger: boolean;
  headerLinksVisible: number;
  sections: { kind: string; columns: number; height: number }[];
  typography: { role: string; fontSize: number; lineHeight: string }[];
}

export interface Shot {
  key: string;
  width: number;
  height: number;
  truncated?: boolean;
}

export interface ScreenshotSet {
  desktop?: Shot;
  tablet?: Shot;
  mobile?: Shot;
  mobileMenu?: Shot;
  desktopViewport?: Shot;
}

export interface SiteAnalysis {
  origin: string;
  startUrl: string;
  robots: { checked: boolean; allowed: boolean; sitemaps: string[]; crawlDelay?: number };
  pages: { url: string; path: string; title: string; depth: number; status: "done" | "error"; error?: string }[];
  skipped: { url: string; reason: string }[];
  discovered: number;
  navigation: { text: string; href: string; path: string }[];
  tech: string[];
  blocked?: { reason: string };
  durationMs: number;
  /** Present for uploaded screenshot references. */
  image?: { width: number; height: number };
  palette?: { hex: string; weight: number }[];
}

// ---------------------------------------------------------------------------
// Design system (synthesized from the extraction — by Claude, or heuristically)
// ---------------------------------------------------------------------------

export interface DesignSystem {
  source: "ai" | "heuristic";
  summary: string;
  personality: string[];
  colors: { name: string; hex: string; role: string }[];
  typography: { family: string; role: string; weights: string[]; source: string; fallback: string; notes: string }[];
  typeScale: { token: string; size: string; lineHeight: string; weight: string; letterSpacing: string; transform: string }[];
  spacing: { containerMaxWidth: string; sectionPaddingY: string; gutter: string; notes: string };
  radii: string[];
  shadows: string[];
  components: { name: string; description: string }[];
  layoutPatterns: string[];
  motion: { name: string; description: string; implementation: string }[];
  imagery: { style: string; treatment: string; aspectRatios: string[] };
  navigation: { desktop: string; mobile: string; items: string[] };
  pages: { path: string; title: string; purpose: string; sections: string[] }[];
  responsive: string[];
}

// ---------------------------------------------------------------------------
// Versions & fidelity
// ---------------------------------------------------------------------------

export interface VersionFile {
  path: string;
  content?: string | null;
  storageKey?: string | null;
  mime: string;
  size: number;
}

export interface FidelityMetrics {
  overall: number; // 0..100
  pixel: number; // 0..1 similarity (1 = identical)
  structural: number; // 0..1 block SSIM
  layout: number; // 0..1 row-profile correlation
  color: number; // 0..1 palette similarity
  typography: number; // 0..1 font/size agreement
  sections: number; // 0..1 section count/kind agreement
  media: number; // 0..1 image/video count agreement
  heightRatio: number; // generated / reference document height
  referenceHeight: number;
  generatedHeight: number;
  rows: { top: number; height: number; diff: number }[];
}

export interface FidelityIssue {
  kind:
    | "layout"
    | "spacing"
    | "typography"
    | "color"
    | "missing-section"
    | "extra-section"
    | "missing-image"
    | "height"
    | "missing-page"
    | "navigation"
    | "runtime-error";
  severity: "high" | "medium" | "low";
  message: string;
  region?: { top: number; height: number };
}

// ---------------------------------------------------------------------------
// Job events streamed to the UI
// ---------------------------------------------------------------------------

export type JobEventType =
  | "log"
  | "stage"
  | "progress"
  | "text" // assistant text delta
  | "thinking" // progress-update summaries
  | "tool" // tool call started/finished
  | "file" // file written/edited/deleted
  | "screenshot"
  | "fidelity"
  | "error"
  | "done";

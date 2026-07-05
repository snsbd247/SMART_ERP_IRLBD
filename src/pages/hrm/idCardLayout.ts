// Single source of truth for ID-card print/preview dimensions.
// Change values here — printed PDF, browser Print, on-screen preview,
// and regression tests all stay in sync.

export const CARD_MM = { width: 54, height: 85.6 } as const;

// Back-side QR is centered horizontally at the bottom of the main column.
export const BACK_QR = {
  sizeMm: 26,
  padMm: { top: 1, right: 0, bottom: 2, left: 0 },
  // Preview canvas size (px) chosen to match ~26mm at the on-screen scale
  // of 340px = 54mm (≈ 6.3 px/mm).
  onScreenPx: 164,
} as const;


// Text-color palette matching the reference sample.
export const BACK_COLORS = {
  body: "#1e3a8a",      // navy — address text
  highlight: "#dc2626", // red — phone / email values
  header: "#000000",    // section labels + connector rules
} as const;

// Print @page config. `margin: 0` guarantees no device/browser default
// margin creeps in and shifts the QR or padding.
export const PRINT_PAGE = {
  sizeCss: `${CARD_MM.width}mm ${CARD_MM.height}mm`,
  marginCss: "0",
} as const;

/** Emit the shared BACK-side CSS used by the print/PDF template. */
export const backCssBlock = (): string => `
  .back { display: flex; }
  .back .main { flex: 1; padding: 3mm 2.5mm 2mm; display: flex; flex-direction: column; }
  .back .sec { margin-bottom: 1.5mm; }
  .back .st { display:flex; justify-content:center; margin-bottom: 0.8mm; }
  .back .st span { position: relative; font-size: 2.6mm; font-weight: 800; color: ${BACK_COLORS.header}; padding: 0 2mm; }
  .back .st span::before, .back .st span::after { content:""; position:absolute; top:50%; width: 7mm; height: 0.3mm; background: ${BACK_COLORS.header}; }
  .back .st span::before { right: 100%; } .back .st span::after { left: 100%; }
  .back .sb { font-size: 2.2mm; line-height: 1.35; color: ${BACK_COLORS.body}; text-align: center; margin: 0; }
  .back .sb .hl { color: ${BACK_COLORS.highlight}; }
  .back .qr { margin-top: auto; padding: ${BACK_QR.padMm.top}mm ${BACK_QR.padMm.right}mm ${BACK_QR.padMm.bottom}mm ${BACK_QR.padMm.left}mm; }
  .back .qr img { width: ${BACK_QR.sizeMm}mm; height: ${BACK_QR.sizeMm}mm; display: block; }
  .back .side { width: 5mm; background: #111; display:flex; align-items:center; justify-content:center; border-radius: 1mm 0 0 1mm; margin: 1mm 0 1mm 0; }
  .back .side span { color:#fff; font-size: 2.6mm; font-weight: 700; letter-spacing: 1mm; writing-mode: vertical-rl; transform: rotate(180deg); }
`;

/** Emit the shared @page + card frame CSS. */
export const pageFrameCss = (): string => `
  @page { size: ${PRINT_PAGE.sizeCss}; margin: ${PRINT_PAGE.marginCss}; }
  .card { width: ${CARD_MM.width}mm; height: ${CARD_MM.height}mm; overflow: hidden; background: #fff; position: relative; page-break-after: always; }
  .card:last-child { page-break-after: auto; }
`;

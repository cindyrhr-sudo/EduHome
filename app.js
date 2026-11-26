/**
 * /*==================================================================
 *  *  EduLayer + Klassenzimmer-Board – Fusion   (Version 1.0)         *
 *  *==================================================================
 *
 * GRUNDIDEE:
 *  - Es gibt einen Tab pro "Dokument": entweder Typ 'tafel' (leere
 *    Zeichenfläche, wie Klassenzimmer-Board) oder Typ 'pdf' (reales
 *    PDF-Dokument, wie EduLayer). Jeder Tab ist unabhängig.
 *  - Nur der AKTIVE Tab hat lebendiges DOM (Canvas etc.). Beim
 *    Tab-Wechsel wird der alte Tab abgebaut (Zustand vorher in sein
 *    Tab-Objekt gesichert) und der neue aus seinem Tab-Objekt wieder
 *    aufgebaut - Prinzip aus Klassenzimmer-Board (gatherState/
 *    restoreState), übertragen auf das PDF-Tab-System.
 *  - Die Zeichen-Engine (Stift/Marker/Linien/Undo/Redo) ist EINE
 *    gemeinsame Engine für beide Tab-Typen. Damit das funktioniert,
 *    bekommt jeder Tafel-Tab intern eine "Seite 1" - so kann exakt
 *    dieselbe seiten-basierte Annotations-/Undo-Struktur wie bei
 *    PDF-Tabs verwendet werden (tab.annotationen[seite], usw.).
 *  - Lineal/Geodreieck sind in PDF-Tabs echt auf cm kalibriert
 *    (pxProCm aus der PDF-Seitengröße), in Tafel-Tabs rein optisch
 *    (fester Bildschirm-px-pro-cm-Wert, kein Kalibrierungs-Anspruch).
 *  - Tafel-Hintergründe "Lineatur" (3line.png) und "Häuschen"
 *    (Häuschen.png) funktionieren wie das Geodreieck: pro Variante
 *    gibt es eine Hell- und eine Dunkel-PNG-Kachel; welche aktiv ist,
 *    entscheidet ausschließlich das App-Thema (Z.thema), nicht der
 *    Tab-Typ - betrifft ausschließlich die Zeichenfläche der Tafel,
 *    die Sidebars bleiben davon unberührt.
 *
 * STRUKTUR:
 *  1.  KONFIGURATION
 *  2.  ZUSTAND (Z) + TAB-DATENMODELL
 *  3.  DOM-REFERENZEN
 *  4.  HILFSFUNKTIONEN (tab-übergreifend)
 *  5.  THEMA & GESPEICHERTE EINSTELLUNGEN
 *  6.  FLYOUT-UNTERMENÜS
 *  7.  EINSTELLUNGSMENÜ
 *  8.  NOTIZEN-PANEL
 *  9.  SIDEBAR-WERKZEUGLOGIK
 * 10.  ZEICHEN-ENGINE (gemeinsam für Tafel + PDF)
 * 11.  LASERPOINTER
 * 12.  UNDO / REDO (gemeinsam)
 * 13.  GEODREIECK
 * 14.  LINEAL
 * 15.  SPOTLIGHT
 * 16.  ZOOM (nur PDF-Tabs)
 * 17.  TAB-VERWALTUNG                              [NEU]
 * 18.  TAFEL-TAB (Canvas, Hintergrund)             [NEU]
 * 19.  PDF-TAB (Laden, Rendern, Lazy, Export)
 * 20.  WIDGETS (portiert aus Klassenzimmer-Board)  [NEU]
 * 21.  TAFELN SPEICHERN / LADEN                     [NEU]
 * 22.  SERVICE WORKER
 * 23.  APP-START
 */

'use strict';


/* ===================================================================
   1. KONFIGURATION
==================================================================== */
/** Schalter-Experiment gegen "Striche reagieren manchmal nicht bei
 *  schnell aufeinanderfolgenden Kontakten": canvas.setPointerCapture()/
 *  releasePointerCapture() komplett deaktiviert. Canvas deckt die
 *  gesamte Zeichenfläche ab, daher ist Capture für normales Schreiben
 *  nicht zwingend nötig (nur relevant, falls der Stift während eines
 *  Strichs über den Canvas-Rand hinausgeht). Betrifft AUSSCHLIESSLICH
 *  diese eine Konstante - kein sonstiger Code wurde verändert.
 *  Zum Zurückstellen: einfach wieder auf true setzen. */
const POINTER_CAPTURE_AKTIV = false;

const KONFIGURATION = {
  STIFT_DUENN_PX:    4,
  STIFT_DICK_PX:     8,
  GERADE_LINIE_PX:   4,
  TEXTMARKER_PX:     18,
  TEXTMARKER_ALPHA:  0.32,
  LASER_PX:          6,
  LASER_SCHWEIF_MAX: 28,
  LASER_FADE_MS:     600,
  LASER_FARBE:       '#ff2222',
  STANDARD_FARBE:    '#1a3a6b',

  // Geodreieck (PNG-Basis), Bildverhältnis 2:1
  GEO_SEITENVERHAELTNIS: 0.5,
  GEO_CM_LAENGE:     28,
  GEO_SNAP_PX:       20,
  // Zwei Bildvarianten: PDF-Tabs (heller Hintergrund) nutzen das
  // normale Geodreieck, Tafel-Tabs (dunkler Hintergrund) die
  // farbinvertierte Variante.
  GEO_BILD_PDF:      'icons/geodreieck.png',
  GEO_BILD_TAFEL:    'icons/geodreieck-dark.png',

  // Optischer px-pro-cm-Wert für Tafel-Tabs (kein realer Kalibrierungs-
  // Anspruch, dient nur als angenehme Bildschirm-Näherung - identisch
  // zum bisherigen Wert aus Klassenzimmer-Board).
  OPTISCH_PX_PRO_CM: 37.8,

  // Tafel-Hintergrund-Kacheln (PNG, 500×400 px, enthalten JEWEILS
  // 5 identische Zeilen übereinander = 80px pro Zeile im Original).
  // Die tatsächliche Skalierung (5× --tafel-raster für die ganze
  // Kachel) steht in style.css bei .bg-lineatur/.bg-haeuschen.
  // Je Variante eine Hell- und eine Dunkel-Version, analog zum
  // Geodreieck-Bild-Wechsel.
  TAFEL_BG_BILDER: {
    lineatur:  { hell: 'icons/3line.png',    dunkel: 'icons/3line-dark.png'    },
    haeuschen: { hell: 'icons/Häuschen.png', dunkel: 'icons/Häuschen-dark.png' },
  },

  SPOTLIGHT_MIN_B:   60,
  SPOTLIGHT_MIN_H:   40,
  SPOTLIGHT_START_B: 320,
  SPOTLIGHT_START_H: 200,

  PDF_SCALE:         1.5,
  ZOOM_MIN:          0.3,
  ZOOM_MAX:          4.0,
  ZOOM_SCHRITT:      0.2,

  ZEICHEN_DPR:       Math.min(window.devicePixelRatio || 1, 3),
  GLAETTUNG_ALPHA:   0.35,

  PDFJS_WORKER:
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',

  WIDGET_ICONS: { timer: '⏲️', wheel: '🎡', qr: '🔗', image: '🖼️' },
};


/* ===================================================================
   2. ZUSTAND (Z) + TAB-DATENMODELL
   -------------------------------------------------------------------
   Tab (Typ 'tafel'):
     { id, type:'tafel', name, groesse:{w,h},
       annotationen:{1:[...]}, undoVerlauf:{1:[...]}, redoVerlauf:{1:[...]},
       widgets:[{id,type,x,y,w,h,val,theme,fullsize}], notiz:'', bgTyp }
   Tab (Typ 'pdf'):
     { id, type:'pdf', name, pdfBytes, pdfDokument, seitenAnzahl, aktiveSeite,
       annotationen:{seite:[...]}, undoVerlauf:{}, redoVerlauf:{},
       notizenProSeite:{}, viewports:{}, pxProCm:{}, zoom,
       gerenderteSeitenCanvas:Set }
==================================================================== */
const Z = {
  tabs:            [],
  aktiverTabId:    null,

  werkzeug:        'stift-duenn',
  strichfarbe:     KONFIGURATION.STANDARD_FARBE,
  strichbreite:    KONFIGURATION.STIFT_DUENN_PX,
  linienstil:      'solid',
  zeichnet:        false,
  aktiverPointerId: null,
  zeichenTyp:      null,
  letzterStiftZeit: 0,
  nurStiftZeichnet: true,
  letzterPunkt:    null,
  letzterPunktGegl: null,
  aktuellerStrich: null,
  geradeLinieStart: null,
  geradeLinieBasis: null,

  modus:           'zeichnen',
  thema:           'dunkel',
  fokusModus:      'aus',

  spotFenster:     { x: 0, y: 0, b: 320, h: 200 },
  spotGriff:       null,
  spotDragStart:   null,

  geodreieckAktiv: false,
  geoPos:          { x: 80, y: 120 },
  geoWinkel:       0,
  geoSkalierung:   1,
  geoKalibrierung: 1.0,
  geoDrag:         null,

  linealAktiv:     false,
  linealPos:       { x: 60, y: 180 },
  linealWinkel:    0,
  linealLaengeCm:  20,
  linealKalibrierung: 1.0,
  linealDrag:      null,

  pinch:           null,

  sidebarSeite:    'right',

  laserSchweif:    [],
  laserAnimFrame:  null,
  laserAktiv:      false,

  offenesFlyout:   null,

  einstellungenOffen: false,
  notizenOffen:    false,

  tafelBgTypStandard: 'none',
  tafelRasterGroesse: 30,

  widgetTimers:    {},
  wheelData:       {},

  audioCtx:        null,
  alarmBeepInterval: null,
};


/* ===================================================================
   3. DOM-REFERENZEN
==================================================================== */
const D = {
  html:              document.documentElement,
  body:              document.body,
  hauptbereich:      document.getElementById('hauptbereich'),
  startAnzeige:      document.getElementById('start-anzeige'),
  btnStartNeu:       document.getElementById('btn-start-neu'),

  zoomWrapper:       document.getElementById('zoom-wrapper'),
  zoomScaler:        document.getElementById('zoom-scaler'),
  pdfContainer:      document.getElementById('pdf-container'),

  tafelWrapper:      document.getElementById('tafel-wrapper'),
  tafelBg:           document.getElementById('tafel-bg'),
  tafelCanvas:       document.getElementById('tafel-canvas'),
  tafelWidgetsLayer: document.getElementById('tafel-widgets-layer'),

  dateiInput:        document.getElementById('datei-input'),

  gruppeScroll:      document.getElementById('gruppe-scroll'),
  btnModusWechsel:   document.getElementById('btn-modus-wechsel'),

  btnStiftAktiv:     document.getElementById('btn-stift-aktiv'),
  iconStiftAktiv:    document.getElementById('icon-stift-aktiv'),
  labelStiftAktiv:   document.getElementById('label-stift-aktiv'),
  flyoutStifte:      document.getElementById('flyout-stifte'),
  flyoutStiftBtns:   document.querySelectorAll('#flyout-stifte .flyout-btn'),

  farbDots:          document.querySelectorAll('.farb-dot'),

  btnUndo:           document.getElementById('btn-undo'),
  btnRedo:           document.getElementById('btn-redo'),
  btnSeiteLeeren:    document.getElementById('btn-seite-leeren'),

  btnFokusAktiv:     document.getElementById('btn-fokus-aktiv'),
  iconFokusAktiv:    document.getElementById('icon-fokus-aktiv'),
  labelFokusAktiv:   document.getElementById('label-fokus-aktiv'),
  flyoutFokus:       document.getElementById('flyout-fokus'),
  flyoutFokusBtns:   document.querySelectorAll('#flyout-fokus .flyout-btn'),

  fokusToolbar:      document.getElementById('fokus-toolbar'),
  fokusToolbarLabel: document.getElementById('fokus-toolbar-label'),
  btnFokusSchliessen: document.getElementById('btn-fokus-schliessen'),

  btnGeodrei:        document.getElementById('btn-geodreieck'),
  geoWrapper:        document.getElementById('geodreieck-wrapper'),
  geoBild:           document.getElementById('geodreieck-svg'),
  geoFuehrung:       document.getElementById('geo-fuehrungslinie'),
  geoMoveGriff:      document.getElementById('geo-move-griff'),
  geoDrehGriff:      document.getElementById('geo-dreh-griff'),

  btnLineal:         document.getElementById('btn-lineal'),
  linealWrapper:     document.getElementById('lineal-wrapper'),
  linealBalken:      document.getElementById('lineal-balken'),
  linealSkala:       document.getElementById('lineal-skala'),
  linealMoveGriff:   document.getElementById('lineal-move-griff'),
  linealDrehGriff:   document.getElementById('lineal-dreh-griff'),

  btnWidgetMenu:     document.getElementById('btn-widget-menu'),
  flyoutWidgets:     document.getElementById('flyout-widgets'),
  flyoutWidgetBtns:  document.querySelectorAll('#flyout-widgets .flyout-btn'),
  kindergarten:      document.getElementById('kindergarten'),

  btnNeueTafel:          document.getElementById('btn-neue-tafel'),
  neueTafelOverlay:      document.getElementById('neue-tafel-overlay'),
  neueTafelBackdrop:     document.getElementById('neue-tafel-backdrop'),
  optNeueSchultafel:     document.getElementById('opt-neue-schultafel'),
  optNeuePdf:            document.getElementById('opt-neue-pdf'),
  btnNeueTafelAbbrechen: document.getElementById('btn-neue-tafel-abbrechen'),
  tabListe:              document.getElementById('tab-liste'),

  btnNotizen:        document.getElementById('btn-notizen'),
  notizenOverlay:    document.getElementById('notizen-overlay'),
  notizenBackdrop:   document.getElementById('notizen-backdrop'),
  btnNotizenSch:     document.getElementById('btn-notizen-schliessen'),
  notizenSeiteInfo:  document.getElementById('notizen-seite-info'),
  notizenNav:        document.getElementById('notizen-nav'),
  notizenNavInfo:    document.getElementById('notizen-nav-info'),
  btnNotizenVor:     document.getElementById('btn-notizen-seite-vor'),
  btnNotizenNach:    document.getElementById('btn-notizen-seite-nach'),
  notizenTextarea:   document.getElementById('notizen-textarea'),
  vorlagenBtns:      document.querySelectorAll('.notiz-vorlage-btn'),
  btnNotizenLoeschen:    document.getElementById('btn-notizen-loeschen'),
  btnNotizenExportieren: document.getElementById('btn-notizen-exportieren'),

  btnEinstellungen:      document.getElementById('btn-einstellungen'),
  einstellungenOverlay:  document.getElementById('einstellungen-overlay'),
  einstellungenBackdrop: document.getElementById('einstellungen-backdrop'),
  btnEinstellungenSch:   document.getElementById('btn-einstellungen-schliessen'),
  btnSpeichern:          document.getElementById('btn-speichern'),
  btnTafelnSpeichern:    document.getElementById('btn-tafeln-speichern'),
  btnTafelnExport:       document.getElementById('btn-tafeln-export'),
  btnTafelnImport:       document.getElementById('btn-tafeln-import'),
  tafelnImportInput:     document.getElementById('tafeln-import-input'),
  btnThemaWechsel:       document.getElementById('btn-thema-wechsel'),
  btnStiftExklusiv:      document.getElementById('btn-stift-exklusiv'),
  btnSidebarLinks:       document.getElementById('btn-sidebar-links'),
  btnSidebarRechts:      document.getElementById('btn-sidebar-rechts'),
  sliderLaserDauer:      document.getElementById('slider-laser-dauer'),
  laserDauerAnzeige:     document.getElementById('laser-dauer-anzeige'),
  sliderGeoKalibrierung:  document.getElementById('slider-geo-kalibrierung'),
  geoKalibrierungAnzeige: document.getElementById('geo-kalibrierung-anzeige'),
  sliderLinealLaenge:     document.getElementById('slider-lineal-laenge'),
  linealLaengeAnzeige:    document.getElementById('lineal-laenge-anzeige'),
  sliderLinealKalibrierung:  document.getElementById('slider-lineal-kalibrierung'),
  linealKalibrierungAnzeige: document.getElementById('lineal-kalibrierung-anzeige'),
  sliderPdfTransparenz:   document.getElementById('slider-pdf-transparenz'),
  pdfTransparenzAnzeige:  document.getElementById('pdf-transparenz-anzeige'),
  sliderTafelRaster:      document.getElementById('slider-tafel-raster'),
  tafelRasterAnzeige:     document.getElementById('tafel-raster-anzeige'),

  spotlightOverlay:  document.getElementById('spotlight-overlay'),
  spotlightFenster:  document.getElementById('spotlight-fenster'),
  spotlightMaske:    document.getElementById('spotlight-maske'),
  spotGriffe:        null,

  zoomSteuerung:     document.getElementById('zoom-steuerung'),
  btnZoomPlus:       document.getElementById('btn-zoom-plus'),
  btnZoomMinus:      document.getElementById('btn-zoom-minus'),
  btnZoomReset:      document.getElementById('btn-zoom-reset'),
  zoomAnzeige:       document.getElementById('zoom-anzeige'),

  laserCanvas:       document.getElementById('laser-canvas'),
  toast:             document.getElementById('toast'),
  ladeOverlay:       document.getElementById('lade-overlay'),
  ladeText:          document.getElementById('lade-text'),
};


/* ===================================================================
   4. HILFSFUNKTIONEN (tab-übergreifend)
==================================================================== */

function aktuellerTab() {
  return Z.tabs.find(t => t.id === Z.aktiverTabId) || null;
}

/** Für Tafel-Tabs gibt es nur eine virtuelle "Seite 1"; PDF-Tabs
 *  nutzen ihre echte aktive Seitenzahl. Damit funktioniert die
 *  komplette Annotations-/Undo-Struktur für beide Typen identisch. */
function aktuelleSeite() {
  const tab = aktuellerTab();
  if (!tab) return 1;
  return tab.type === 'pdf' ? tab.aktiveSeite : 1;
}

function seiteVonCanvas(canvas) {
  if (canvas === D.tafelCanvas) return 1;
  const cont = canvas.closest('.seite-container');
  return cont ? +cont.dataset.seite : 1;
}

function zeichenCanvasAktiv(seite) {
  const tab = aktuellerTab();
  if (!tab) return null;
  if (tab.type === 'tafel') return D.tafelCanvas;
  return document.querySelector(`.seite-container[data-seite="${seite}"] .zeichen-canvas`);
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toast(text, typ = 'info', ms = 2400) {
  const el = D.toast;
  el.className = 'toast'; el.textContent = text;
  requestAnimationFrame(() => el.classList.add('sichtbar', typ));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('sichtbar'), ms);
}

function ladeAnzeige(an, text = 'Laden...') {
  D.ladeOverlay.style.display = an ? 'flex' : 'none';
  D.ladeOverlay.setAttribute('aria-hidden', an ? 'false' : 'true');
  D.ladeText.textContent = text;
}

function koordinaten(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  let cx, cy;
  if (e.touches?.length > 0)             { cx = e.touches[0].clientX;        cy = e.touches[0].clientY; }
  else if (e.changedTouches?.length > 0) { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; }
  else                                   { cx = e.clientX;                    cy = e.clientY; }
  return clientZuCanvas(cx, cy, canvas, rect);
}

/** Bildschirm-Koordinaten -> Zeichen-Koordinaten. canvas._skala ist nur
 *  bei der Tafel gesetzt (verkleinerte Darstellung nach dem Drehen). */
function clientZuCanvas(cx, cy, canvas, rect = canvas.getBoundingClientRect()) {
  const teiler = KONFIGURATION.ZEICHEN_DPR * (canvas._skala || 1);
  return {
    x: (cx - rect.left) * (canvas.width  / rect.width)  / teiler,
    y: (cy - rect.top)  * (canvas.height / rect.height) / teiler,
  };
}

/** Zeichnet ein Pixel-Abbild 1:1, unabhängig von der Skalierung des ctx. */
function bildDeckungsgleich(ctx, bild) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bild, 0, 0);
  ctx.restore();
}
function canvasLeeren(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
function punktZeichnen(ctx, p, farbe, breite) {
  ctx.beginPath();
  ctx.fillStyle = farbe;
  ctx.arc(p.x, p.y, breite / 2, 0, Math.PI * 2);
  ctx.fill();
}

function koordinatenGegl(rohPunkt) {
  const alpha = KONFIGURATION.GLAETTUNG_ALPHA;
  if (!Z.letzterPunktGegl) { Z.letzterPunktGegl = { ...rohPunkt }; return { ...rohPunkt }; }
  const gegl = {
    x: alpha * rohPunkt.x + (1 - alpha) * Z.letzterPunktGegl.x,
    y: alpha * rohPunkt.y + (1 - alpha) * Z.letzterPunktGegl.y,
  };
  Z.letzterPunktGegl = gegl;
  return gegl;
}

function clientKoord(e) {
  if (e.touches?.length > 0)             return { x: e.touches[0].clientX,        y: e.touches[0].clientY };
  if (e.changedTouches?.length > 0)      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function istIPad() {
  return /iPad|iPhone/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function download(daten, dateiname, mimeTyp) {
  const url = URL.createObjectURL(new Blob([daten], { type: mimeTyp }));
  const a = Object.assign(document.createElement('a'), { href: url, download: dateiname });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Auf dem iPad über das Teilen-Menü ("In Dateien sichern"), sonst Download. */
async function dateiAusgeben(daten, dateiname, mimeTyp) {
  const datei = new File([daten], dateiname, { type: mimeTyp.split(';')[0] });
  if (!istIPad() || !navigator.canShare?.({ files: [datei] })) {
    download(daten, dateiname, mimeTyp);
    toast(`Gespeichert: ${dateiname}`, 'erfolg', 3500);
    return;
  }
  try {
    await navigator.share({ files: [datei] });
  } catch (err) {
    if (err.name === 'AbortError') return; // selbst abgebrochen
    // Safari verlangt ein frisches Antippen (z. B. nach langem PDF-Aufbau)
    teilenKnopfZeigen(datei, () => download(daten, dateiname, mimeTyp));
  }
}

function teilenKnopfZeigen(datei, ersatz) {
  document.getElementById('teilen-knopf')?.remove();
  const box = document.createElement('div');
  box.id = 'teilen-knopf'; box.className = 'schwebe-box';
  const ok = Object.assign(document.createElement('button'), { className: 'start-anzeige__btn', textContent: '📤 Datei sichern' });
  const nein = Object.assign(document.createElement('button'), { className: 'einstellungen-btn', textContent: 'Abbrechen' });
  ok.onclick = async () => {
    box.remove();
    try { await navigator.share({ files: [datei] }); }
    catch (err) { if (err.name !== 'AbortError') ersatz(); }
  };
  nein.onclick = () => box.remove();
  box.append(ok, nein);
  document.body.appendChild(box);
}

function pinchAbstand(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function zeitstempel() {
  const d = new Date(), z = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}`;
}

function winkelZwischen(cx, cy, px, py) {
  return Math.atan2(py - cy, px - cx) * 180 / Math.PI;
}

function punktAufLinie(p, p1, p2) {
  const dx = p2.x-p1.x, dy = p2.y-p1.y;
  const lenSq = dx*dx+dy*dy;
  if (lenSq === 0) return { ...p1 };
  const t = Math.max(0, Math.min(1, ((p.x-p1.x)*dx+(p.y-p1.y)*dy)/lenSq));
  return { x: p1.x+t*dx, y: p1.y+t*dy };
}

function ctxReset(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

function geradeLinieZeichnen(ctx, von, bis, farbe, breite, linienstil) {
  const DASH_MUSTER = {
    'solid':    [],
    'dashed':   [breite * 4, breite * 2.5],
    'dotted':   [breite * 0.5, breite * 2.5],
    'dash-dot': [breite * 5, breite * 2, breite * 0.5, breite * 2],
  };
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.strokeStyle = farbe;
  ctx.lineWidth   = breite;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.setLineDash(DASH_MUSTER[linienstil] ?? []);
  ctx.beginPath();
  ctx.moveTo(von.x, von.y);
  ctx.lineTo(bis.x, bis.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctxReset(ctx);
}

function geoImgFallback(imgEl) {
  if (!imgEl.isConnected) return;
  // Einfaches SVG-Ersatzbild, falls icons/geodreieck.png fehlt.
  const svg = `<svg class="geodreieck-svg" viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
      <polygon points="0,200 400,200 200,0" fill="rgba(180,222,255,0.38)" stroke="#1b3a57" stroke-width="2.5"/>
    </svg>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = svg;
  const neu = wrap.firstElementChild;
  neu.id = 'geodreieck-svg';
  neu.style.cssText = imgEl.style.cssText;
  imgEl.replaceWith(neu);
  D.geoBild = neu;
}


/* ===================================================================
   5. THEMA & GESPEICHERTE EINSTELLUNGEN
==================================================================== */
function themaWechseln(thema) {
  Z.thema = thema;
  D.html.dataset.thema = thema;
  D.btnThemaWechsel.setAttribute('aria-checked', thema === 'hell' ? 'true' : 'false');
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', thema === 'hell' ? '#e8eaf0' : '#1a1f2e');
  try { localStorage.setItem('edulayer-thema', thema); } catch(_) {}
  if (Z.geodreieckAktiv) geodreieckBildAktualisieren();

  // Tafel-Hintergrund: falls gerade eine Tafel mit Lineatur/Häuschen
  // aktiv ist, die passende Hell-/Dunkel-PNG-Kachel nachladen.
  const tab = aktuellerTab();
  if (tab && tab.type === 'tafel' && (tab.bgTyp === 'lineatur' || tab.bgTyp === 'haeuschen')) {
    tafelBgBildSetzen(tab.bgTyp);
  }
}
function themaLaden() {
  let t = 'dunkel';
  try { t = localStorage.getItem('edulayer-thema') || 'dunkel'; } catch(_) {}
  themaWechseln(t);
}

function geoKalibrierungLaden() {
  let prozent = 100;
  try {
    const g = localStorage.getItem('edulayer-geo-kalibrierung');
    if (g) prozent = parseFloat(g);
  } catch(_) {}
  Z.geoKalibrierung = prozent / 100;
  if (D.sliderGeoKalibrierung)  D.sliderGeoKalibrierung.value = prozent;
  if (D.geoKalibrierungAnzeige) D.geoKalibrierungAnzeige.textContent = `${prozent} %`;
}

function pdfTransparenzLaden() {
  let prozent = 100;
  try {
    const g = localStorage.getItem('edulayer-pdf-transparenz');
    if (g) prozent = parseFloat(g);
  } catch(_) {}
  if (D.sliderPdfTransparenz)  D.sliderPdfTransparenz.value = prozent;
  if (D.pdfTransparenzAnzeige) D.pdfTransparenzAnzeige.textContent = `${prozent} %`;
  if (D.pdfContainer)          D.pdfContainer.style.opacity = prozent / 100;
}

function linealEinstellungenLaden() {
  let laenge = 20, kalibrProzent = 100;
  try {
    const l = localStorage.getItem('edulayer-lineal-laenge');
    if (l) laenge = parseFloat(l);
    const k = localStorage.getItem('edulayer-lineal-kalibrierung');
    if (k) kalibrProzent = parseFloat(k);
  } catch(_) {}
  Z.linealLaengeCm = laenge;
  Z.linealKalibrierung = kalibrProzent / 100;
  if (D.sliderLinealLaenge)       D.sliderLinealLaenge.value = laenge;
  if (D.linealLaengeAnzeige)      D.linealLaengeAnzeige.textContent = `${laenge} cm`;
  if (D.sliderLinealKalibrierung)  D.sliderLinealKalibrierung.value = kalibrProzent;
  if (D.linealKalibrierungAnzeige) D.linealKalibrierungAnzeige.textContent = `${kalibrProzent} %`;
}

function tafelBgLaden() {
  let typ = 'none';
  try { typ = localStorage.getItem('edulayer-tafel-bg') || 'none'; } catch(_) {}
  Z.tafelBgTypStandard = typ;
}
function tafelBgSetzen(typ) {
  Z.tafelBgTypStandard = typ;
  try { localStorage.setItem('edulayer-tafel-bg', typ); } catch(_) {}
  document.querySelectorAll('.bg-type-btn').forEach(b => b.classList.toggle('mode-active', b.dataset.bgtype === typ));
  const tab = aktuellerTab();
  if (tab && tab.type === 'tafel') { tab.bgTyp = typ; tafelBgAnwenden(typ); }
}

/** Setzt für die PNG-basierten Hintergründe (Lineatur/Häuschen) das
 *  passende Bild abhängig vom aktuellen App-Thema. Analog zu
 *  geodreieckBildAktualisieren(), aber ohne <img>-Fallback-Logik, da
 *  #tafel-bg ein reines Hintergrundbild-Element ist. */
function tafelBgBildSetzen(typ) {
  const eintrag = KONFIGURATION.TAFEL_BG_BILDER[typ];
  if (!eintrag) return;
  const datei = Z.thema === 'hell' ? eintrag.hell : eintrag.dunkel;
  D.tafelBg.style.backgroundImage = `url('${datei}')`;
}

function tafelBgAnwenden(typ) {
  D.tafelBg.classList.remove('bg-kariert', 'bg-liniert', 'bg-lineatur', 'bg-haeuschen');
  D.tafelBg.style.backgroundImage = '';
  if (typ === 'kariert') D.tafelBg.classList.add('bg-kariert');
  if (typ === 'liniert') D.tafelBg.classList.add('bg-liniert');
  if (typ === 'lineatur' || typ === 'haeuschen') {
    D.tafelBg.classList.add('bg-' + typ);
    tafelBgBildSetzen(typ);
  }
  document.querySelectorAll('.bg-type-btn').forEach(b => b.classList.toggle('mode-active', b.dataset.bgtype === typ));
}

function tafelRasterSetzen(px) {
  Z.tafelRasterGroesse = px;
  document.documentElement.style.setProperty('--tafel-raster', px + 'px');
  if (D.tafelRasterAnzeige) D.tafelRasterAnzeige.textContent = px + 'px';
  try { localStorage.setItem('edulayer-tafel-raster', String(px)); } catch(_) {}
}
function tafelRasterLaden() {
  let px = 30;
  try { px = parseFloat(localStorage.getItem('edulayer-tafel-raster')) || 30; } catch(_) {}
  if (D.sliderTafelRaster) D.sliderTafelRaster.value = px;
  tafelRasterSetzen(px);
}

/** Handballenschutz: wenn aktiv, zeichnen nur Stift (pointerType 'pen')
 *  und Maus ('mouse') - Finger-/Handballenberührungen ('touch') werden
 *  beim Zeichnen ignoriert. Werkzeuge wie Lineal/Geodreieck/Widgets
 *  lassen sich davon unabhängig weiterhin mit dem Finger bedienen. */
function stiftExklusivSetzen(aktiv) {
  Z.nurStiftZeichnet = aktiv;
  if (D.btnStiftExklusiv) D.btnStiftExklusiv.setAttribute('aria-checked', aktiv ? 'true' : 'false');
  try { localStorage.setItem('edulayer-stift-exklusiv', aktiv ? '1' : '0'); } catch(_) {}
}
function stiftExklusivLaden() {
  let aktiv = true;
  try {
    const gespeichert = localStorage.getItem('edulayer-stift-exklusiv');
    if (gespeichert !== null) aktiv = gespeichert === '1';
  } catch(_) {}
  stiftExklusivSetzen(aktiv);
}


/* ===================================================================
   6. FLYOUT-UNTERMENÜS
==================================================================== */
function flyoutPositionieren(flyout, button) {
  flyout.style.visibility = 'hidden';
  flyout.style.display = 'flex';

  const btnRect     = button.getBoundingClientRect();
  const flyoutB     = flyout.offsetWidth;
  const flyoutH     = flyout.offsetHeight;
  const sidebarSeite = D.body.dataset.sidebar || 'right';
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left, top;
  // Werkzeug-Sidebar liegt auf sidebarSeite; Flyouts der Werkzeug-
  // Sidebar öffnen zur gegenüberliegenden Seite.
  if (sidebarSeite === 'right') left = btnRect.left - flyoutB - 6;
  else left = btnRect.right + 6;

  top = btnRect.top + (btnRect.height / 2) - (flyoutH / 2);
  top  = Math.max(8, Math.min(top,  vh - flyoutH - 8));
  left = Math.max(8, Math.min(left, vw - flyoutB - 8));

  flyout.style.left       = `${left}px`;
  flyout.style.top        = `${top}px`;
  flyout.style.visibility = 'visible';
}

function flyoutsSchliessen() {
  D.flyoutStifte.style.display = 'none';
  D.flyoutFokus.style.display  = 'none';
  D.flyoutWidgets.style.display = 'none';
  D.btnStiftAktiv.setAttribute('aria-expanded', 'false');
  D.btnFokusAktiv.setAttribute('aria-expanded', 'false');
  Z.offenesFlyout = null;
}

function stiftFlyoutUmschalten() {
  if (Z.offenesFlyout === 'stifte') { flyoutsSchliessen(); return; }
  flyoutsSchliessen();
  flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
  D.btnStiftAktiv.setAttribute('aria-expanded', 'true');
  Z.offenesFlyout = 'stifte';
}

function fokusFlyoutUmschalten() {
  if (Z.offenesFlyout === 'fokus') { flyoutsSchliessen(); return; }
  flyoutsSchliessen();
  flyoutPositionieren(D.flyoutFokus, D.btnFokusAktiv);
  D.btnFokusAktiv.setAttribute('aria-expanded', 'true');
  Z.offenesFlyout = 'fokus';
}

function widgetFlyoutUmschalten() {
  const tab = aktuellerTab();
  if (!tab || tab.type !== 'tafel') { toast('Objekte gibt es nur in Tafel-Tabs.', 'info', 2000); return; }
  if (Z.offenesFlyout === 'widgets') { flyoutsSchliessen(); return; }
  flyoutsSchliessen();
  flyoutPositionieren(D.flyoutWidgets, D.btnWidgetMenu);
  Z.offenesFlyout = 'widgets';
}

const WERKZEUG_ICONS = {
  'stift-duenn': {
    svg: `<path d="M19 3l2 2-12.5 12.5L5 18l.5-3.5L19 3z" stroke-width="1.3"/>
          <line x1="16.5" y1="5.5" x2="20.5" y2="9.5" stroke-width="1.3"/>
          <line x1="3" y1="21" x2="10" y2="21" stroke-width="1"/>`,
    label: 'Fein',
  },
  'stift-dick': {
    svg: `<path d="M19 3l2 2-12.5 12.5L5 18l.5-3.5L19 3z" stroke-width="2.8" stroke-linejoin="round"/>
          <line x1="16.5" y1="5.5" x2="20.5" y2="9.5" stroke-width="2.8"/>
          <line x1="3" y1="21" x2="10" y2="21" stroke-width="3.5"/>`,
    label: 'Dick',
  },
  'textmarker': {
    svg: `<rect x="9" y="3" width="6" height="14" rx="1"
              transform="rotate(-45 12 10)" stroke-width="1.4" fill="none"/>
          <rect x="3" y="19" width="12" height="3" rx="1"
              fill="currentColor" opacity="0.45" stroke="none"/>`,
    label: 'Marker',
  },
  'gerade-linie-solid': {
    svg: `<line x1="3" y1="12" x2="21" y2="12" stroke-width="2" stroke-linecap="round"/>
          <line x1="3" y1="6" x2="21" y2="6" stroke-width="0.8" opacity="0.4"/>`,
    label: 'Gerade',
  },
  'gerade-linie-dashed': {
    svg: `<line x1="3" y1="12" x2="21" y2="12" stroke-width="2"
              stroke-dasharray="4,3" stroke-linecap="round"/>
          <line x1="3" y1="6" x2="21" y2="6" stroke-width="0.8" opacity="0.4"/>`,
    label: 'Gestrich.',
  },
  'gerade-linie-dotted': {
    svg: `<line x1="3" y1="12" x2="21" y2="12" stroke-width="2.5"
              stroke-dasharray="0.5,3" stroke-linecap="round"/>
          <line x1="3" y1="6" x2="21" y2="6" stroke-width="0.8" opacity="0.4"/>`,
    label: 'Gepunkt.',
  },
  'gerade-linie-dash-dot': {
    svg: `<line x1="3" y1="12" x2="21" y2="12" stroke-width="2"
              stroke-dasharray="6,2,1,2" stroke-linecap="round"/>
          <line x1="3" y1="6" x2="21" y2="6" stroke-width="0.8" opacity="0.4"/>`,
    label: 'Str-Pkt',
  },
};

const FOKUS_ICONS = {
  'oval': {
    svg: `<ellipse cx="12" cy="12" rx="9" ry="6" stroke-width="1.8" fill="none"/>
          <path d="M3 2h18v20H3z" fill="currentColor" opacity="0.08" stroke="none"/>`,
    label: 'Oval',
  },
  'rechteck': {
    svg: `<rect x="4" y="7" width="16" height="10" rx="1" stroke-width="1.8" fill="none"/>
          <path d="M3 2h18v20H3z" fill="currentColor" opacity="0.08" stroke="none"/>`,
    label: 'Eckig',
  },
  'laser': {
    svg: `<circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>
          <line x1="12" y1="2"  x2="12" y2="6.5" stroke-width="1.8"/>
          <line x1="12" y1="17.5" x2="12" y2="22" stroke-width="1.8"/>
          <line x1="2"  y1="12" x2="6.5" y2="12" stroke-width="1.8"/>
          <line x1="17.5" y1="12" x2="22" y2="12" stroke-width="1.8"/>`,
    label: 'Laser',
  },
};

function stiftButtonAktualisieren(werkzeug) {
  const iconKey = werkzeug === 'gerade-linie' ? `gerade-linie-${Z.linienstil}` : werkzeug;
  const info = WERKZEUG_ICONS[iconKey];
  if (!info) return;
  D.iconStiftAktiv.innerHTML = info.svg;
  D.labelStiftAktiv.textContent = info.label;
  D.flyoutStiftBtns.forEach(b => {
    const a = b.dataset.werkzeug === werkzeug &&
      (werkzeug !== 'gerade-linie' || b.dataset.linienstil === Z.linienstil);
    b.classList.toggle('aktiv', a);
    b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

function fokusButtonAktualisieren(modus) {
  const info = FOKUS_ICONS[modus];
  if (info) {
    D.iconFokusAktiv.innerHTML = info.svg;
    D.labelFokusAktiv.textContent = info.label;
  } else {
    D.iconFokusAktiv.innerHTML = `
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      <path d="M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12"/>
      <path d="M19.07 4.93l-2.12 2.12M6.05 16.95l-2.12 2.12"/>`;
    D.labelFokusAktiv.textContent = 'Fokus';
  }
  D.btnFokusAktiv.setAttribute('aria-pressed', modus !== 'aus' ? 'true' : 'false');
  D.btnFokusAktiv.classList.toggle('aktiv', modus !== 'aus');
  D.flyoutFokusBtns.forEach(b => {
    const a = b.dataset.fokus === modus;
    b.classList.toggle('aktiv', a);
    b.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

function fokusModusSetzen(modus) {
  if (Z.fokusModus === 'oval' || Z.fokusModus === 'rechteck') spotlightAus();
  if (Z.fokusModus === 'laser') laserModeAus();

  Z.fokusModus = modus;
  fokusButtonAktualisieren(modus);

  if (modus === 'oval' || modus === 'rechteck') {
    spotlightAn(modus);
    D.fokusToolbar.style.display = 'flex';
    D.fokusToolbarLabel.textContent = modus === 'oval' ? 'Spotlight Oval' : 'Spotlight Eckig';
  } else if (modus === 'laser') {
    D.fokusToolbar.style.display = 'flex';
    D.fokusToolbarLabel.textContent = 'Laserpointer';
    werkzeugWaehlen('laser');
  } else {
    D.fokusToolbar.style.display = 'none';
  }

  flyoutsSchliessen();
}

function fokusModusAus() { fokusModusSetzen('aus'); }


/* ===================================================================
   7. EINSTELLUNGSMENÜ
==================================================================== */
function einstellungenOeffnen() {
  Z.einstellungenOffen = true;
  D.einstellungenOverlay.style.display = 'block';
  D.einstellungenOverlay.setAttribute('aria-hidden', 'false');
  D.btnEinstellungen.classList.add('aktiv');
  const tab = aktuellerTab();
  D.btnSpeichern.classList.toggle('werkzeug-btn--deaktiviert', !tab || tab.type !== 'pdf');
  requestAnimationFrame(() => D.btnEinstellungenSch.focus());
}
function einstellungenSchliessen() {
  Z.einstellungenOffen = false;
  D.einstellungenOverlay.style.display = 'none';
  D.einstellungenOverlay.setAttribute('aria-hidden', 'true');
  D.btnEinstellungen.classList.remove('aktiv');
}
function sidebarPositionSetzen(seite) {
  Z.sidebarSeite = seite;
  D.body.dataset.sidebar = seite;
  D.btnSidebarRechts.classList.toggle('aktiv', seite === 'right');
  D.btnSidebarLinks.classList.toggle('aktiv',  seite === 'left');
  D.btnSidebarRechts.setAttribute('aria-pressed', seite === 'right' ? 'true' : 'false');
  D.btnSidebarLinks.setAttribute('aria-pressed',  seite === 'left'  ? 'true' : 'false');
  if (Z.offenesFlyout === 'stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
  if (Z.offenesFlyout === 'fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
  if (Z.offenesFlyout === 'widgets') flyoutPositionieren(D.flyoutWidgets, D.btnWidgetMenu);
  try { localStorage.setItem('edulayer-sidebar-seite', seite); } catch(_) {}
}
function sidebarPositionLaden() {
  let seite = 'right';
  try { seite = localStorage.getItem('edulayer-sidebar-seite') || 'right'; } catch(_) {}
  sidebarPositionSetzen(seite);
}
function einstellungenInit() {
  D.btnEinstellungen.addEventListener('click', () =>
    Z.einstellungenOffen ? einstellungenSchliessen() : einstellungenOeffnen()
  );
  D.einstellungenBackdrop.addEventListener('click', einstellungenSchliessen);
  D.btnEinstellungenSch.addEventListener('click',   einstellungenSchliessen);
  D.btnSpeichern.addEventListener('click', () => {
    const tab = aktuellerTab();
    if (!tab || tab.type !== 'pdf') { toast('Nur in PDF-Tabs möglich.', 'info'); return; }
    einstellungenSchliessen(); pdfSpeichern();
  });
  D.btnTafelnSpeichern.addEventListener('click', () => { tafelnSpeichern(); });
  D.btnTafelnExport.addEventListener('click', () => { tafelnExportieren(); });
  D.btnTafelnImport.addEventListener('click', () => { D.tafelnImportInput.click(); });
  D.tafelnImportInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) tafelnImportieren(f);
    e.target.value = '';
  });
  D.btnThemaWechsel.addEventListener('click', () =>
    themaWechseln(Z.thema === 'dunkel' ? 'hell' : 'dunkel')
  );
  D.btnStiftExklusiv.addEventListener('click', () => stiftExklusivSetzen(!Z.nurStiftZeichnet));
  D.btnSidebarLinks.addEventListener('click',  () => sidebarPositionSetzen('left'));
  D.btnSidebarRechts.addEventListener('click', () => sidebarPositionSetzen('right'));
  D.sliderLaserDauer.addEventListener('input', () => {
    KONFIGURATION.LASER_FADE_MS = +D.sliderLaserDauer.value;
    D.laserDauerAnzeige.textContent = `${D.sliderLaserDauer.value} ms`;
  });
  if (D.sliderGeoKalibrierung) {
    D.sliderGeoKalibrierung.addEventListener('input', () => {
      const prozent = +D.sliderGeoKalibrierung.value;
      Z.geoKalibrierung = prozent / 100;
      if (D.geoKalibrierungAnzeige) D.geoKalibrierungAnzeige.textContent = `${prozent} %`;
      try { localStorage.setItem('edulayer-geo-kalibrierung', String(prozent)); } catch(_) {}
      if (Z.geodreieckAktiv) geodreieckSkalieren();
      if (Z.linealAktiv) linealSkalieren();
    });
  }
  if (D.sliderLinealLaenge) {
    D.sliderLinealLaenge.addEventListener('input', () => {
      Z.linealLaengeCm = +D.sliderLinealLaenge.value;
      if (D.linealLaengeAnzeige) D.linealLaengeAnzeige.textContent = `${Z.linealLaengeCm} cm`;
      try { localStorage.setItem('edulayer-lineal-laenge', String(Z.linealLaengeCm)); } catch(_) {}
      if (Z.linealAktiv) linealSkalieren();
    });
  }
  if (D.sliderLinealKalibrierung) {
    D.sliderLinealKalibrierung.addEventListener('input', () => {
      const prozent = +D.sliderLinealKalibrierung.value;
      Z.linealKalibrierung = prozent / 100;
      if (D.linealKalibrierungAnzeige) D.linealKalibrierungAnzeige.textContent = `${prozent} %`;
      try { localStorage.setItem('edulayer-lineal-kalibrierung', String(prozent)); } catch(_) {}
      if (Z.linealAktiv) linealSkalieren();
    });
  }
  if (D.sliderPdfTransparenz) {
    D.sliderPdfTransparenz.addEventListener('input', () => {
      const prozent = +D.sliderPdfTransparenz.value;
      D.pdfContainer.style.opacity = prozent / 100;
      if (D.pdfTransparenzAnzeige) D.pdfTransparenzAnzeige.textContent = `${prozent} %`;
      try { localStorage.setItem('edulayer-pdf-transparenz', String(prozent)); } catch(_) {}
    });
  }
  if (D.sliderTafelRaster) {
    D.sliderTafelRaster.addEventListener('input', () => {
      tafelRasterSetzen(+D.sliderTafelRaster.value);
    });
  }
}


/* ===================================================================
   8. NOTIZEN-PANEL
   PDF-Tabs: Notiz pro Seite (mit Vor/Zurück-Navigation).
   Tafel-Tabs: eine Notiz für die ganze Tafel (Navigation ausgeblendet).
==================================================================== */
const VORLAGEN = {
  lernziele:       'Lernziele dieser Stunde:\n- \n- \n- ',
  aufgaben:        'Aufgaben:\n1. \n2. \n3. ',
  material:        'Benötigtes Material:\n- Schulbuch S. \n- Arbeitsblatt: \n- ',
  differenzierung: 'Differenzierung:\n^ Erweiterung: \no Standard: \nv Unterstützung: ',
};

function notizenOeffnen() {
  const tab = aktuellerTab(); if (!tab) return;
  Z.notizenOffen = true;
  D.notizenOverlay.style.display = 'block';
  D.notizenOverlay.setAttribute('aria-hidden', 'false');
  D.btnNotizen.classList.add('aktiv');
  D.btnNotizen.setAttribute('aria-pressed', 'true');
  D.notizenNav.style.display = tab.type === 'pdf' ? 'flex' : 'none';
  notizenAktualisieren();
  requestAnimationFrame(() => D.notizenTextarea.focus());
}
function notizenSchliessen() {
  notizenSpeichern();
  Z.notizenOffen = false;
  D.notizenOverlay.style.display = 'none';
  D.notizenOverlay.setAttribute('aria-hidden', 'true');
  D.btnNotizen.classList.remove('aktiv');
  D.btnNotizen.setAttribute('aria-pressed', 'false');
}
function notizenSpeichern() {
  const tab = aktuellerTab(); if (!tab) return;
  if (tab.type === 'pdf') tab.notizenProSeite[tab.aktiveSeite] = D.notizenTextarea.value;
  else { tab.notiz = D.notizenTextarea.value; autoSpeichernPlanen(); }
}
function notizenAktualisieren() {
  const tab = aktuellerTab(); if (!tab) return;
  if (tab.type === 'pdf') {
    const s = tab.aktiveSeite, g = tab.seitenAnzahl || 1;
    D.notizenTextarea.value = tab.notizenProSeite[s] || '';
    D.notizenSeiteInfo.textContent = `Seite ${s}`;
    D.notizenNavInfo.textContent   = `Seite ${s} / ${g}`;
  } else {
    D.notizenTextarea.value = tab.notiz || '';
    D.notizenSeiteInfo.textContent = tab.name;
  }
}
function notizenInit() {
  D.btnNotizen.addEventListener('click', () => Z.notizenOffen ? notizenSchliessen() : notizenOeffnen());
  D.notizenBackdrop.addEventListener('click', notizenSchliessen);
  D.btnNotizenSch.addEventListener('click',   notizenSchliessen);
  D.btnNotizenVor.addEventListener('click', () => {
    const tab = aktuellerTab(); if (!tab || tab.type !== 'pdf') return;
    notizenSpeichern();
    tab.aktiveSeite = Math.max(1, tab.aktiveSeite - 1);
    notizenAktualisieren();
  });
  D.btnNotizenNach.addEventListener('click', () => {
    const tab = aktuellerTab(); if (!tab || tab.type !== 'pdf') return;
    notizenSpeichern();
    tab.aktiveSeite = Math.min(tab.seitenAnzahl || 1, tab.aktiveSeite + 1);
    notizenAktualisieren();
  });
  D.notizenTextarea.addEventListener('input', notizenSpeichern);
  D.vorlagenBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const text = VORLAGEN[btn.dataset.vorlage] || '';
      const ta = D.notizenTextarea, pos = ta.selectionStart;
      const v = ta.value.slice(0, pos), n = ta.value.slice(ta.selectionEnd);
      const tr = v.length > 0 && !v.endsWith('\n') ? '\n\n' : '';
      ta.value = v + tr + text + '\n' + n;
      ta.selectionStart = ta.selectionEnd = pos + tr.length + text.length + 1;
      ta.focus(); notizenSpeichern();
    });
  });
  D.btnNotizenLoeschen.addEventListener('click', () => {
    const tab = aktuellerTab(); if (!tab) return;
    if (!window.confirm('Notiz wirklich löschen?')) return;
    if (tab.type === 'pdf') tab.notizenProSeite[tab.aktiveSeite] = '';
    else tab.notiz = '';
    D.notizenTextarea.value = '';
    autoSpeichernPlanen();
    toast('Notiz gelöscht.', 'info');
  });
  D.btnNotizenExportieren.addEventListener('click', () => {
    const tab = aktuellerTab(); if (!tab) return;
    let inhalt = `EduLayer - Lehrer-Notizen (${tab.name})\nExportiert: ${new Date().toLocaleString('de-DE')}\n${'='.repeat(40)}\n\n`;
    if (tab.type === 'pdf') {
      for (let s = 1; s <= (tab.seitenAnzahl||1); s++) {
        const n = tab.notizenProSeite[s];
        if (n?.trim()) inhalt += `-- Seite ${s} --\n${n}\n\n`;
      }
    } else {
      inhalt += tab.notiz || '';
    }
    if (inhalt.trim().split('\n').length <= 3) { toast('Keine Notizen vorhanden.', 'info'); return; }
    dateiAusgeben(new TextEncoder().encode(inhalt), `EduLayer_Notizen_${zeitstempel()}.txt`, 'text/plain;charset=utf-8');
  });
}


/* ===================================================================
   9. SIDEBAR-WERKZEUGLOGIK
==================================================================== */
function werkzeugWaehlen(name) {
  if (Z.fokusModus === 'laser' && name !== 'laser') {
    Z.fokusModus = 'aus';
    fokusButtonAktualisieren('aus');
    D.fokusToolbar.style.display = 'none';
  }

  Z.werkzeug = name;
  Z.strichbreite = ({
    'stift-duenn':  KONFIGURATION.STIFT_DUENN_PX,
    'stift-dick':   KONFIGURATION.STIFT_DICK_PX,
    'textmarker':   KONFIGURATION.TEXTMARKER_PX,
    'gerade-linie': KONFIGURATION.GERADE_LINIE_PX,
    'laser':        KONFIGURATION.LASER_PX,
  })[name] ?? KONFIGURATION.STIFT_DUENN_PX;

  if (['stift-duenn','stift-dick','textmarker','gerade-linie'].includes(name)) {
    D.btnStiftAktiv.classList.add('aktiv');
    D.btnStiftAktiv.setAttribute('aria-pressed', 'true');
    stiftButtonAktualisieren(name);
  } else {
    D.btnStiftAktiv.classList.remove('aktiv');
    D.btnStiftAktiv.setAttribute('aria-pressed', 'false');
  }

  document.querySelectorAll('.zeichen-canvas, .tafel-canvas').forEach(c => c.dataset.werkzeug = name);
}

function farbeWaehlen(farbe) {
  Z.strichfarbe = farbe;
  D.farbDots.forEach(d => {
    const a = d.dataset.farbe === farbe;
    d.classList.toggle('aktiv', a);
    d.setAttribute('aria-pressed', a ? 'true' : 'false');
  });
}

function scrollModusUmschalten() {
  const tab = aktuellerTab();
  if (!tab || tab.type !== 'pdf') { toast('Nur in PDF-Tabs verfügbar.', 'info'); return; }
  const war = Z.modus === 'scrollen';
  Z.modus = war ? 'zeichnen' : 'scrollen';
  D.body.classList.toggle('scroll-modus', !war);
  D.body.dataset.modus = Z.modus;
  D.btnModusWechsel.setAttribute('aria-pressed', war ? 'false' : 'true');
  toast(war ? 'Zeichnen aktiv' : 'Scroll-Modus - Finger scrollt das PDF', 'info', 1800);
}

/** Blendet Werkzeuge ein/aus, die nur für einen Tab-Typ Sinn ergeben. */
function werkzeugSidebarAnpassen() {
  const tab = aktuellerTab();
  const istPdf   = !!tab && tab.type === 'pdf';
  const istTafel = !!tab && tab.type === 'tafel';
  D.btnModusWechsel.classList.toggle('werkzeug-btn--deaktiviert', !istPdf);
  D.btnModusWechsel.setAttribute('aria-pressed', istPdf && Z.modus === 'scrollen' ? 'true' : 'false');
  if (!istPdf && Z.modus === 'scrollen') { Z.modus = 'zeichnen'; D.body.classList.remove('scroll-modus'); }
  D.zoomSteuerung.style.display = istPdf ? 'flex' : 'none';
  D.btnWidgetMenu.classList.toggle('werkzeug-btn--deaktiviert', !istTafel);
}

function sidebarInit() {
  // "PDF laden" läuft jetzt ausschließlich über den "+"-Dialog
  // (rechte Sidebar), der denselben datei-input auslöst.
  D.btnStartNeu.addEventListener('click', neueTafelOeffnen);

  D.dateiInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f?.type === 'application/pdf') {
      const tab = tabErzeugenPdf(f.name.replace(/\.pdf$/i, ''));
      tabHinzufuegen(tab, true);
      pdfDateiInTab(tab, f);
    }
    D.dateiInput.value = '';
  });

  D.btnStiftAktiv.addEventListener('click', stiftFlyoutUmschalten);
  D.flyoutStiftBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.linienstil) Z.linienstil = btn.dataset.linienstil;
      werkzeugWaehlen(btn.dataset.werkzeug);
      flyoutsSchliessen();
    });
  });

  D.farbDots.forEach(dot => {
    dot.addEventListener('click', () => { if (dot.dataset.farbe) farbeWaehlen(dot.dataset.farbe); });
  });

  D.btnUndo.addEventListener('click',        undoAusfuehren);
  D.btnRedo.addEventListener('click',        redoAusfuehren);
  D.btnSeiteLeeren.addEventListener('click', seiteLeeren);

  D.btnModusWechsel.addEventListener('click', scrollModusUmschalten);

  D.btnFokusAktiv.addEventListener('click', fokusFlyoutUmschalten);
  D.flyoutFokusBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const modus = btn.dataset.fokus;
      if (Z.fokusModus === modus) fokusModusSetzen('aus');
      else fokusModusSetzen(modus);
    });
  });

  D.btnFokusSchliessen.addEventListener('click', fokusModusAus);
  D.btnGeodrei.addEventListener('click', geodreieckUmschalten);
  D.btnLineal.addEventListener('click', linealUmschalten);

  D.btnWidgetMenu.addEventListener('click', widgetFlyoutUmschalten);
  D.flyoutWidgetBtns.forEach(btn => {
    btn.addEventListener('click', () => { flyoutsSchliessen(); widgetErstellen(btn.dataset.widget); });
  });

  document.addEventListener('keydown', e => {
    const imTextfeld = e.target.matches?.('input, textarea');
    if ((e.ctrlKey || e.metaKey) && !imTextfeld) {
      if (e.key === 'z') { e.preventDefault(); undoAusfuehren(); }
      if (e.key === 'y') { e.preventDefault(); redoAusfuehren(); }
    }
    if (e.key === 'Escape') {
      if (Z.einstellungenOffen) { einstellungenSchliessen(); return; }
      if (Z.notizenOffen)       { notizenSchliessen(); return; }
      if (Z.offenesFlyout)      { flyoutsSchliessen(); return; }
      if (Z.fokusModus !== 'aus') { fokusModusAus(); return; }
      if (Z.geodreieckAktiv)    { geodreieckAus(); return; }
      if (Z.linealAktiv)        { linealAus(); return; }
    }
  });

  document.addEventListener('touchstart', e => {
    if (!Z.offenesFlyout) return;
    const ziel = e.target;
    if (!ziel.closest('#gruppe-stifte') && !ziel.closest('#gruppe-fokus') &&
        !ziel.closest('#gruppe-widgets') && !ziel.closest('.flyout')) {
      flyoutsSchliessen();
    }
  }, { passive: true });
  document.addEventListener('mousedown', e => {
    if (!Z.offenesFlyout) return;
    if (!e.target.closest('#gruppe-stifte') && !e.target.closest('#gruppe-fokus') &&
        !e.target.closest('#gruppe-widgets') && !e.target.closest('.flyout')) {
      flyoutsSchliessen();
    }
  });
}


/* ===================================================================
   10. ZEICHEN-ENGINE (gemeinsam für Tafel + PDF)
==================================================================== */
function linealUndGeoSnap(e, canvas, fallbackPunkt) {
  let beste = null, besterAbstand = Infinity;
  if (Z.geodreieckAktiv) {
    const snap = geodreieckSnap(e, canvas);
    if (snap) {
      const client = clientKoord(e);
      const d = Math.hypot(client.x - snap.x, client.y - snap.y);
      if (d < besterAbstand) { besterAbstand = d; beste = snap; }
    }
  }
  if (Z.linealAktiv) {
    const snap = linealSnap(e, canvas);
    if (snap) {
      const client = clientKoord(e);
      const d = Math.hypot(client.x - snap.x, client.y - snap.y);
      if (d < besterAbstand) { besterAbstand = d; beste = snap; }
    }
  }
  return beste || fallbackPunkt;
}

function vorschauBasisErfassen(canvas) {
  const basis = document.createElement('canvas');
  basis.width = canvas.width; basis.height = canvas.height;
  basis.getContext('2d').drawImage(canvas, 0, 0);
  return basis;
}

function vorschauBasisWiederherstellen(ctx, canvas, basis) {
  canvasLeeren(canvas);
  bildDeckungsgleich(ctx, basis);
}

function strichStarten(e, canvas) {
  const tab = aktuellerTab(); if (!tab) return;
  if (Z.modus === 'scrollen') return;
  if (Z.fokusModus === 'oval' || Z.fokusModus === 'rechteck') return;
  if (Z.fokusModus === 'laser') { laserStarten(e); return; }
  if (Z.nurStiftZeichnet && e.pointerType === 'touch') return;

  if (Z.zeichnet) {
    // Derselbe Kontakt meldet sich nochmal (z.B. doppeltes pointerdown)
    // -> ignorieren. Meldet sich ein ANDERER Kontakt, während Z.zeichnet
    // noch aktiv ist, wurde der vorige Strich offenbar ohne sauberes
    // pointerup/pointercancel beendet (bekannt bei sehr schnellem
    // Absetzen/Neuansetzen des Apple Pencil) - dann jetzt erzwungen sauber
    // abschließen, statt den neuen Aufsatzpunkt zu verschlucken.
    if (e.pointerId === Z.aktiverPointerId) return;
    strichAbschliessen(canvas);
  }

  e.preventDefault();
  Z.zeichnet = true;
  Z.aktiverPointerId = e.pointerId;
  Z.zeichenTyp = e.pointerType;
  if (POINTER_CAPTURE_AKTIV) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
  Z.letzterPunktGegl = null;

  let p = koordinaten(e, canvas);
  p = koordinatenGegl(p);
  p = linealUndGeoSnap(e, canvas, p);
  Z.letzterPunkt = p;

  const seite = seiteVonCanvas(canvas);
  if (tab.type === 'pdf') tab.aktiveSeite = seite;

  if (Z.werkzeug === 'gerade-linie') {
    Z.geradeLinieStart = { ...p };
    Z.geradeLinieBasis = vorschauBasisErfassen(canvas);
    Z.aktuellerStrich = null;
    return;
  }

  if (Z.werkzeug === 'textmarker') {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const offCtx = off.getContext('2d');
    offCtx.setTransform(canvas.getContext('2d').getTransform());
    offCtx.lineCap = 'round'; offCtx.lineJoin = 'round';
    offCtx.lineWidth = Z.strichbreite;
    offCtx.strokeStyle = Z.strichfarbe;
    offCtx.globalAlpha = 1;
    Z.aktuellerStrich = {
      punkte: [{ ...p }], farbe: Z.strichfarbe,
      breite: Z.strichbreite, werkzeug: 'textmarker',
      alpha: KONFIGURATION.TEXTMARKER_ALPHA,
      offCanvas: off, offCtx,
      basisSnapshot: vorschauBasisErfassen(canvas),
    };
    if (!tab.annotationen[seite]) tab.annotationen[seite] = [];
  } else {
    if (!tab.annotationen[seite]) tab.annotationen[seite] = [];
    Z.aktuellerStrich = {
      punkte: [{ ...p }], farbe: Z.strichfarbe,
      breite: Z.strichbreite, werkzeug: Z.werkzeug,
    };
  }
}

function strichBewegen(e, canvas) {
  if (Z.modus === 'scrollen') return;
  if (Z.fokusModus === 'laser') { laserBewegen(e); return; }

  // Selbstheilung: pointerdown wurde von WebKit nicht ausgeliefert (bekannter
  // Sonderfall bei sehr schnellem Neuaufsetzen, besonders bei Stiften wie dem
  // Logitech Crayon, die nicht das native Apple-Pencil-Protokoll nutzen).
  // pointermove kommt aber mit aktivem Kontakt (buttons/pressure > 0) an -
  // in dem Fall den Strich hier nachträglich starten, statt auf ein
  // pointerdown zu warten, das u.U. nie kommt.
  if (!Z.zeichnet && e.pointerId !== Z.aktiverPointerId) {
    const kontaktAktiv = e.buttons > 0 || (e.pressure && e.pressure > 0);
    const werkzeugErlaubtStart =
      Z.modus !== 'scrollen' &&
      Z.fokusModus !== 'oval' && Z.fokusModus !== 'rechteck' && Z.fokusModus !== 'laser';
    if (kontaktAktiv && werkzeugErlaubtStart && !(Z.nurStiftZeichnet && istHandflaeche(e))) {
      strichStarten(e, canvas);
      return; // strichStarten hat bereits den ersten Punkt gesetzt und gezeichnet
    }
  }

  if (!Z.zeichnet || e.pointerId !== Z.aktiverPointerId) return;
  e.preventDefault();

  let p = koordinaten(e, canvas);
  p = koordinatenGegl(p);
  p = linealUndGeoSnap(e, canvas, p);

  if (Z.werkzeug === 'gerade-linie' && Z.geradeLinieStart && Z.geradeLinieBasis) {
    const ctx = canvas.getContext('2d');
    vorschauBasisWiederherstellen(ctx, canvas, Z.geradeLinieBasis);
    geradeLinieZeichnen(ctx, Z.geradeLinieStart, p, Z.strichfarbe, Z.strichbreite, Z.linienstil);
    Z.letzterPunkt = p;
    return;
  }

  if (Z.werkzeug === 'textmarker' && Z.aktuellerStrich?.offCtx) {
    const offCtx = Z.aktuellerStrich.offCtx;
    offCtx.beginPath();
    offCtx.moveTo(Z.letzterPunkt.x, Z.letzterPunkt.y);
    offCtx.lineTo(p.x, p.y);
    offCtx.stroke();
    const ctx = canvas.getContext('2d');
    vorschauBasisWiederherstellen(ctx, canvas, Z.aktuellerStrich.basisSnapshot);
    ctx.globalAlpha = KONFIGURATION.TEXTMARKER_ALPHA;
    bildDeckungsgleich(ctx, Z.aktuellerStrich.offCanvas);
    ctx.globalAlpha = 1;
    Z.aktuellerStrich.punkte.push({ ...p });
  } else {
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = Z.strichfarbe; ctx.lineWidth = Z.strichbreite;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(Z.letzterPunkt.x,Z.letzterPunkt.y); ctx.lineTo(p.x,p.y); ctx.stroke();
    ctxReset(ctx);
    if (Z.aktuellerStrich) Z.aktuellerStrich.punkte.push({ ...p });
  }
  Z.letzterPunkt = p;
}

/** Schließt den aktuell offenen Strich ab und speichert ihn in die
 *  Annotationen. endPunkt ist optional - fehlt er (z.B. beim
 *  erzwungenen Abschluss ohne aktuelles Pointer-Event), wird der
 *  zuletzt bekannte Punkt verwendet. Zentral ausgelagert, damit sowohl
 *  das normale pointerup/pointercancel als auch alle Sicherheitsnetze
 *  (lostpointercapture, erzwungener Neustart bei hängendem Zustand)
 *  exakt denselben, korrekten Abschluss durchlaufen. */
function strichAbschliessen(canvas, endPunkt) {
  const tab = aktuellerTab();
  if (tab) {
    const seite = seiteVonCanvas(canvas);
    const ctx = canvas.getContext('2d');
    let neu = null;
    if (Z.werkzeug === 'gerade-linie' && Z.geradeLinieStart) {
      const pEnd = endPunkt || Z.letzterPunkt || Z.geradeLinieStart;
      if (Z.geradeLinieBasis) vorschauBasisWiederherstellen(ctx, canvas, Z.geradeLinieBasis);
      // Bloßes Antippen erzeugt keine (unsichtbare) Linie
      if (Math.hypot(pEnd.x - Z.geradeLinieStart.x, pEnd.y - Z.geradeLinieStart.y) >= 2) {
        geradeLinieZeichnen(ctx, Z.geradeLinieStart, pEnd, Z.strichfarbe, Z.strichbreite, Z.linienstil);
        neu = {
          werkzeug: 'gerade-linie', punkte: [Z.geradeLinieStart, pEnd],
          farbe: Z.strichfarbe, breite: Z.strichbreite, linienstil: Z.linienstil,
        };
      }
    } else if (Z.werkzeug === 'textmarker' && Z.aktuellerStrich?.offCanvas) {
      const s = Z.aktuellerStrich;
      neu = { punkte: s.punkte, farbe: s.farbe, breite: s.breite, werkzeug: 'textmarker', alpha: s.alpha };
    } else if (Z.aktuellerStrich) {
      neu = Z.aktuellerStrich;
    }
    if (neu) {
      undoSnapshot(seite);
      if (!tab.annotationen[seite]) tab.annotationen[seite] = [];
      tab.annotationen[seite].push(neu);
      // Marker sauber neu aufbauen; einzelne Punkte (i-Punkt) sichtbar machen
      if (neu.werkzeug === 'textmarker') canvasNeuZeichnen(seite);
      else if (neu.punkte.length === 1) punktZeichnen(ctx, neu.punkte[0], neu.farbe, neu.breite);
      autoSpeichernPlanen();
    }
  }
  if (POINTER_CAPTURE_AKTIV) { try { if (Z.aktiverPointerId !== null) canvas.releasePointerCapture(Z.aktiverPointerId); } catch (_) {} }
  strichZustandZuruecksetzen();
}

function strichZustandZuruecksetzen() {
  if (Z.zeichenTyp === 'pen') Z.letzterStiftZeit = Date.now();
  Z.zeichnet = false;
  Z.aktiverPointerId = null;
  Z.zeichenTyp = null;
  Z.aktuellerStrich = null;
  Z.geradeLinieStart = null;
  Z.geradeLinieBasis = null;
  Z.letzterPunkt = null;
  Z.letzterPunktGegl = null;
}

function strichBeenden(e, canvas) {
  if (Z.fokusModus === 'laser') { laserBeenden(); return; }
  if (!Z.zeichnet || e.pointerId !== Z.aktiverPointerId) {
    return;
  }
  e.preventDefault();

  let pEnd = null;
  if (Z.werkzeug === 'gerade-linie' && Z.geradeLinieStart) {
    pEnd = koordinaten(e, canvas);
    pEnd = linealUndGeoSnap(e, canvas, pEnd);
  } else if (e.type === 'pointerup' && Z.aktuellerStrich) {
    // Die Glättung hinkt hinterher: Strich bis zum Absetzpunkt verlängern
    const ende = linealUndGeoSnap(e, canvas, koordinaten(e, canvas));
    const s = Z.aktuellerStrich;
    const letzter = s.punkte[s.punkte.length - 1];
    if (s.punkte.length > 1 && Math.hypot(ende.x - letzter.x, ende.y - letzter.y) > 0.5) {
      const ctx = s.offCtx || canvas.getContext('2d');
      if (!s.offCtx) { ctx.strokeStyle = s.farbe; ctx.lineWidth = s.breite; ctx.lineCap = 'round'; }
      ctx.beginPath(); ctx.moveTo(letzter.x, letzter.y); ctx.lineTo(ende.x, ende.y); ctx.stroke();
      s.punkte.push({ ...ende });
    }
  }
  strichAbschliessen(canvas, pEnd);
}

function zeichenListeners(canvas) {
  canvas.addEventListener('pointerdown',   e => strichStarten(e, canvas));
  canvas.addEventListener('pointermove',   e => strichBewegen(e, canvas));
  canvas.addEventListener('pointerup',     e => strichBeenden(e, canvas));
  canvas.addEventListener('pointercancel', e => strichBeenden(e, canvas));
  // Sicherheitsnetz: lostpointercapture feuert zuverlässig, sobald der
  // Kontakt endet - auch wenn pointerup/pointercancel vom System
  // verschluckt werden (bekanntes Verhalten bei sehr schnellem Absetzen
  // des Apple Pencil unter Safari/iPadOS). Verhindert, dass Z.zeichnet
  // dauerhaft "hängen" bleibt und der nächste Strich stillschweigend
  // ignoriert wird.
  canvas.addEventListener('lostpointercapture', e => {
    if (e.pointerId === Z.aktiverPointerId) strichAbschliessen(canvas);
  });
}

function stricheZeichnen(ctx, striche) {
  if (!striche?.length) return;
  striche.forEach(s => {
    if (!s?.punkte?.length) return;
    if (s.punkte.length === 1 && s.werkzeug !== 'textmarker' && s.werkzeug !== 'gerade-linie') {
      punktZeichnen(ctx, s.punkte[0], s.farbe, s.breite); return;
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.breite;
    if (s.werkzeug === 'gerade-linie') {
      geradeLinieZeichnen(ctx, s.punkte[0], s.punkte[1], s.farbe, s.breite, s.linienstil ?? 'solid');
    } else if (s.werkzeug === 'textmarker') {
      const off = document.createElement('canvas');
      off.width = ctx.canvas.width; off.height = ctx.canvas.height;
      const offCtx = off.getContext('2d');
      offCtx.setTransform(ctx.getTransform());
      offCtx.lineCap = 'round'; offCtx.lineJoin = 'round';
      offCtx.lineWidth = s.breite; offCtx.strokeStyle = s.farbe;
      offCtx.beginPath(); offCtx.moveTo(s.punkte[0].x,s.punkte[0].y);
      for (let i=1;i<s.punkte.length;i++) offCtx.lineTo(s.punkte[i].x,s.punkte[i].y);
      offCtx.stroke();
      ctx.globalAlpha = s.alpha ?? KONFIGURATION.TEXTMARKER_ALPHA;
      bildDeckungsgleich(ctx, off);
      ctx.globalAlpha = 1;
      off.width = 0; off.height = 0; // Speicher auf dem iPad sofort freigeben
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = s.farbe; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(s.punkte[0].x,s.punkte[0].y);
      for (let i=1;i<s.punkte.length-1;i++) {
        const mx=(s.punkte[i].x+s.punkte[i+1].x)/2, my=(s.punkte[i].y+s.punkte[i+1].y)/2;
        ctx.quadraticCurveTo(s.punkte[i].x,s.punkte[i].y,mx,my);
      }
      const lp=s.punkte[s.punkte.length-1]; ctx.lineTo(lp.x,lp.y); ctx.stroke();
      ctxReset(ctx);
    }
  });
}
function istHandflaeche(e) {
  if (e.pointerType !== 'touch') return false;
  const SCHWELLE_PX = 20;
  const breite = e.width  || 0;
  const hoehe  = e.height || 0;
  if (breite === 0 && hoehe === 0) return true;
  return Math.max(breite, hoehe) > SCHWELLE_PX;
}

/* ===================================================================
   11. LASERPOINTER
==================================================================== */
function laserCanvasAnpassen() {
  D.laserCanvas.width = window.innerWidth; D.laserCanvas.height = window.innerHeight;
}
function laserZeichnen() {
  const lc = D.laserCanvas, ctx = lc.getContext('2d');
  ctx.clearRect(0,0,lc.width,lc.height);
  const sw = Z.laserSchweif; if (!sw.length) return;
  const jetzt = Date.now(), fade = KONFIGURATION.LASER_FADE_MS, r = KONFIGURATION.LASER_PX;
  for (let i=0;i<sw.length-1;i++) {
    const alter = jetzt-sw[i].t;
    const alpha = Math.max(0, 0.65*(1-alter/(fade*1.5)));
    if (alpha<=0) continue;
    ctx.beginPath(); ctx.moveTo(sw[i].x,sw[i].y); ctx.lineTo(sw[i+1].x,sw[i+1].y);
    ctx.strokeStyle=KONFIGURATION.LASER_FARBE; ctx.globalAlpha=alpha;
    ctx.lineWidth=r*0.4*((i+1)/sw.length); ctx.lineCap='round';
    ctx.shadowBlur=8; ctx.shadowColor=KONFIGURATION.LASER_FARBE; ctx.stroke();
  }
  if (sw.length>0) {
    const lp=sw[sw.length-1], alter=jetzt-lp.t;
    ctx.beginPath(); ctx.arc(lp.x,lp.y,r,0,Math.PI*2);
    ctx.fillStyle=KONFIGURATION.LASER_FARBE;
    ctx.globalAlpha=Z.laserAktiv?1:Math.max(0,1-alter/fade);
    ctx.shadowBlur=22; ctx.shadowColor=KONFIGURATION.LASER_FARBE; ctx.fill();
  }
  ctx.globalAlpha=1; ctx.shadowBlur=0;
  const nochSichtbar=Z.laserAktiv||(sw[0]&&jetzt-sw[0].t<fade*2);
  if (nochSichtbar) { Z.laserAnimFrame=requestAnimationFrame(laserZeichnen); }
  else { ctx.clearRect(0,0,lc.width,lc.height); Z.laserAnimFrame=null; Z.laserSchweif=[]; }
}
function laserPunkt(cx,cy) {
  Z.laserSchweif.push({x:cx,y:cy,t:Date.now()});
  if (Z.laserSchweif.length>KONFIGURATION.LASER_SCHWEIF_MAX) Z.laserSchweif.shift();
}
function laserStarten(e) {
  e.preventDefault(); Z.laserAktiv=true; Z.laserSchweif=[];
  const t=e.touches?.[0]??e; laserPunkt(t.clientX,t.clientY);
  if (!Z.laserAnimFrame) Z.laserAnimFrame=requestAnimationFrame(laserZeichnen);
}
function laserBewegen(e) {
  if (!Z.laserAktiv) return; e.preventDefault();
  const t=e.touches?.[0]??e; laserPunkt(t.clientX,t.clientY);
}
function laserBeenden() { Z.laserAktiv=false; }
function laserModeAus() {
  laserBeenden();
  if (Z.werkzeug === 'laser') werkzeugWaehlen('stift-duenn');
}


/* ===================================================================
   12. UNDO / REDO (gemeinsam für Tafel + PDF)
==================================================================== */
function undoSnapshot(seite) {
  const tab = aktuellerTab(); if (!tab) return;
  if (!tab.undoVerlauf[seite]) tab.undoVerlauf[seite] = [];
  const v = tab.undoVerlauf[seite];
  v.push((tab.annotationen[seite] || []).slice());
  if (v.length > 50) v.shift();
  tab.redoVerlauf[seite] = [];
}

function canvasNeuZeichnen(seite) {
  const canvas = zeichenCanvasAktiv(seite);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvasLeeren(canvas);
  const tab = aktuellerTab(); if (!tab) return;
  const striche = tab.annotationen[seite];
  if (striche?.length) stricheZeichnen(ctx, striche);
}

function canvasNeuZeichnenAktuellerTab() {
  canvasNeuZeichnen(aktuelleSeite());
}

function verlaufSchritt(von, nach, leerText) {
  const tab = aktuellerTab(); if (!tab || Z.zeichnet) return;
  const seite = aktuelleSeite();
  if (!tab[von][seite]?.length) { toast(leerText, 'info', 1500); return; }
  if (!tab[nach][seite]) tab[nach][seite] = [];
  tab[nach][seite].push((tab.annotationen[seite] || []).slice());
  tab.annotationen[seite] = tab[von][seite].pop();
  canvasNeuZeichnen(seite);
  autoSpeichernPlanen();
}
function undoAusfuehren() { verlaufSchritt('undoVerlauf', 'redoVerlauf', 'Kein Rückgängig-Schritt.'); }
function redoAusfuehren() { verlaufSchritt('redoVerlauf', 'undoVerlauf', 'Kein Wiederholen-Schritt.'); }

function seiteLeeren() {
  const tab = aktuellerTab(); if (!tab) return;
  const seite = aktuelleSeite();
  const label = tab.type === 'pdf' ? `Seite ${seite}` : `"${tab.name}"`;
  if (!tab.annotationen[seite]?.length) { toast(`${label} ist schon leer.`, 'info', 1500); return; }
  if (!window.confirm(`Alle Annotationen auf ${label} löschen?`)) return;
  undoSnapshot(seite);
  tab.annotationen[seite] = [];
  canvasNeuZeichnen(seite);
  autoSpeichernPlanen();
  toast(`${label} geleert.`, 'info');
}


/* ===================================================================
   13. GEODREIECK
==================================================================== */
function aktuellePxProCm() {
  const tab = aktuellerTab();
  if (tab && tab.type === 'pdf') return tab.pxProCm[tab.aktiveSeite] || (KONFIGURATION.PDF_SCALE * 72 / 2.54);
  return KONFIGURATION.OPTISCH_PX_PRO_CM;
}
function aktuellerZoomFaktor() {
  const tab = aktuellerTab();
  return (tab && tab.type === 'pdf') ? (tab.zoom || 1) : 1;
}
function istOptischerModus() {
  const tab = aktuellerTab();
  return !tab || tab.type !== 'pdf';
}

/** Wechselt zwischen der hellen (PDF-Tabs) und der dunklen,
 *  farbinvertierten Variante (Tafel-Tabs) des Geodreieck-Bilds.
 *  Greift nicht, falls das SVG-Fallback aktiv ist (kein <img> mehr). */
function geodreieckBildAktualisieren() {
  if (!D.geoBild || D.geoBild.tagName !== 'IMG') return;
  const tab = aktuellerTab();
  const istTafel = !!tab && tab.type === 'tafel';
  // Die dunkle, farbinvertierte Variante ergibt nur bei dunklem Tafel-
  // Hintergrund Sinn. Im Hellmodus ist der Tafel-Hintergrund hell (siehe
  // --tafel-bg-farbe), dann passt das normale Bild besser - genau wie
  // bei PDF-Tabs, deren Seiten ohnehin immer hell sind.
  const brauchtDunkleVariante = istTafel && Z.thema === 'dunkel';
  const soll = brauchtDunkleVariante ? KONFIGURATION.GEO_BILD_TAFEL : KONFIGURATION.GEO_BILD_PDF;
  if (D.geoBild.dataset.aktuellesBild !== soll) {
    D.geoBild.src = soll;
    D.geoBild.dataset.aktuellesBild = soll;
  }
}

function geodreieckAn() {
  Z.geodreieckAktiv = true;
  D.geoWrapper.style.display = 'block';
  D.geoWrapper.classList.toggle('optisch-modus', istOptischerModus());
  D.geoWrapper.setAttribute('aria-hidden', 'false');
  D.btnGeodrei.classList.add('aktiv');
  D.btnGeodrei.setAttribute('aria-pressed', 'true');
  geodreieckSkalieren();
  geodreieckTransformAnwenden();
  toast('Geodreieck: runder Knopf = Verschieben · Dreh-Griff = Drehen', 'info', 3000);
}
function geodreieckAus() {
  Z.geodreieckAktiv = false;
  D.geoWrapper.style.display = 'none';
  D.geoWrapper.setAttribute('aria-hidden', 'true');
  D.btnGeodrei.classList.remove('aktiv');
  D.btnGeodrei.setAttribute('aria-pressed', 'false');
  D.geoFuehrung.setAttribute('display', 'none');
}
function geodreieckUmschalten() { Z.geodreieckAktiv ? geodreieckAus() : geodreieckAn(); }

function geodreieckSkalieren() {
  geodreieckBildAktualisieren();
  const pxProCm = aktuellePxProCm();
  const breite  = KONFIGURATION.GEO_CM_LAENGE * pxProCm * aktuellerZoomFaktor() * Z.geoKalibrierung;
  const hoehe   = breite * KONFIGURATION.GEO_SEITENVERHAELTNIS;
  Z.geoSkalierung = breite;
  D.geoBild.style.width  = `${breite}px`;
  D.geoBild.style.height = `${hoehe}px`;
  D.geoWrapper.classList.toggle('optisch-modus', istOptischerModus());
}

function geodreieckTransformAnwenden() {
  D.geoWrapper.style.transform =
    `translate(${Z.geoPos.x}px, ${Z.geoPos.y}px) rotate(${Z.geoWinkel}deg)`;
}

function geodreieckSnap(e, canvas) {
  if (!Z.geodreieckAktiv) return null;
  const client = clientKoord(e);
  const kanten = geodreieckKantenClient();
  const snapPx = KONFIGURATION.GEO_SNAP_PX;
  let best = null, minDist = Infinity;

  for (const k of kanten) {
    const proj = punktAufLinie(client, k.p1, k.p2);
    const dist = Math.hypot(client.x-proj.x, client.y-proj.y);
    if (dist < snapPx && dist < minDist) { minDist = dist; best = proj; }
  }

  if (best) {
    D.geoFuehrung.setAttribute('display', 'inline');
    D.geoFuehrung.setAttribute('x1', best.x);
    D.geoFuehrung.setAttribute('y1', best.y);
    D.geoFuehrung.setAttribute('x2', best.x);
    D.geoFuehrung.setAttribute('y2', best.y);
    return clientZuCanvas(best.x, best.y, canvas);
  }
  D.geoFuehrung.setAttribute('display', 'none');
  return null;
}

/** Bildschirm-Position der linken oberen Ecke eines (ungedrehten)
 *  Werkzeugs: Hauptbereich + CSS-Grundposition + Verschiebung. */
function werkzeugUrsprung(wrapper, pos) {
  const basis = wrapper.offsetParent.getBoundingClientRect();
  return { x: basis.left + wrapper.offsetLeft + pos.x, y: basis.top + wrapper.offsetTop + pos.y };
}

/** Dreht Punkte (relativ zum Werkzeug) um den Drehpunkt in Bildschirm-Koordinaten. */
function werkzeugPunkte(wrapper, pos, winkel, pivot, ecken) {
  const rad = winkel * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const u = werkzeugUrsprung(wrapper, pos);
  return ecken.map(p => {
    const rx = p.x - pivot.x, ry = p.y - pivot.y;
    return { x: u.x + pivot.x + rx * cos - ry * sin, y: u.y + pivot.y + rx * sin + ry * cos };
  });
}

function geodreieckKantenClient() {
  // parseFloat statt offsetWidth: funktioniert auch mit dem SVG-Ersatzbild
  const B = parseFloat(D.geoBild.style.width);
  const H = parseFloat(D.geoBild.style.height);
  const punkte = werkzeugPunkte(D.geoWrapper, Z.geoPos, Z.geoWinkel, { x: B / 2, y: H },
    [{ x: B / 2, y: 0 }, { x: 0, y: H }, { x: B, y: H }]);
  return [
    { p1: punkte[0], p2: punkte[1], name: 'kathete-links'  },
    { p1: punkte[1], p2: punkte[2], name: 'basis'          },
    { p1: punkte[0], p2: punkte[2], name: 'kathete-rechts' },
  ];
}

/** Verschieben/Drehen eines Werkzeugs per Maus oder genau EINEM Finger/Stift. */
function griffBinden(griff, istAktiv, starten, bewegen, beenden) {
  let fingerId = null;
  const eigener = liste => Array.from(liste).find(t => t.identifier === fingerId);
  griff.addEventListener('touchstart', e => {
    if (!istAktiv()) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.changedTouches[0];
    fingerId = t.identifier;
    starten(t.clientX, t.clientY);
  }, { passive: false });
  griff.addEventListener('mousedown', e => {
    if (!istAktiv()) return;
    e.preventDefault(); e.stopPropagation();
    starten(e.clientX, e.clientY);
  });
  document.addEventListener('touchmove', e => {
    if (fingerId === null) return;
    const t = eigener(e.changedTouches);
    if (!t) return;
    e.preventDefault();
    bewegen(t.clientX, t.clientY);
  }, { passive: false });
  const ende = e => { if (fingerId !== null && eigener(e.changedTouches)) { fingerId = null; beenden(); } };
  document.addEventListener('touchend', ende);
  document.addEventListener('touchcancel', ende);
  document.addEventListener('mousemove', e => { if (fingerId === null) bewegen(e.clientX, e.clientY); });
  document.addEventListener('mouseup', () => { if (fingerId === null) beenden(); });
}

function geodreieckInit() {
  const aktiv = () => Z.geodreieckAktiv;
  const beenden = () => { Z.geoDrag = null; };
  griffBinden(D.geoMoveGriff, aktiv,
    (cx, cy) => { Z.geoDrag = { art: 'move', startX: cx, startY: cy, startPos: { ...Z.geoPos } }; },
    (cx, cy) => { if (Z.geoDrag?.art === 'move') _geoBewegen(cx, cy); }, beenden);
  griffBinden(D.geoDrehGriff, aktiv, (cx, cy) => {
    const B = parseFloat(D.geoBild.style.width), H = parseFloat(D.geoBild.style.height);
    const u = werkzeugUrsprung(D.geoWrapper, Z.geoPos);
    const pivotX = u.x + B / 2, pivotY = u.y + H;
    Z.geoDrag = { art: 'rotate', pivotX, pivotY, startWinkel: winkelZwischen(pivotX, pivotY, cx, cy) - Z.geoWinkel };
  }, (cx, cy) => { if (Z.geoDrag?.art === 'rotate') _geoBewegen(cx, cy); }, beenden);
}

function _geoBewegen(cx, cy) {
  if (!Z.geoDrag) return;
  if (Z.geoDrag.art === 'move') {
    const dx = cx - Z.geoDrag.startX, dy = cy - Z.geoDrag.startY;
    Z.geoPos = { x: Z.geoDrag.startPos.x + dx, y: Z.geoDrag.startPos.y + dy };
  } else if (Z.geoDrag.art === 'rotate') {
    Z.geoWinkel = Math.round(winkelZwischen(Z.geoDrag.pivotX, Z.geoDrag.pivotY, cx, cy) - Z.geoDrag.startWinkel);
  }
  geodreieckTransformAnwenden();
}


/* ===================================================================
   14. LINEAL
==================================================================== */
function linealAn() {
  Z.linealAktiv = true;
  D.linealWrapper.style.display = 'block';
  D.linealWrapper.classList.toggle('optisch-modus', istOptischerModus());
  D.linealWrapper.setAttribute('aria-hidden', 'false');
  D.btnLineal.classList.add('aktiv');
  D.btnLineal.setAttribute('aria-pressed', 'true');
  linealSkalieren();
  linealZeichnenSkala();
  linealTransformAnwenden();
  toast('Lineal: runder Knopf = Verschieben · Dreh-Griff = Drehen', 'info', 2600);
}
function linealAus() {
  Z.linealAktiv = false;
  D.linealWrapper.style.display = 'none';
  D.linealWrapper.setAttribute('aria-hidden', 'true');
  D.btnLineal.classList.remove('aktiv');
  D.btnLineal.setAttribute('aria-pressed', 'false');
  D.geoFuehrung.setAttribute('display', 'none');
}
function linealUmschalten() { Z.linealAktiv ? linealAus() : linealAn(); }

function linealSkalieren() {
  const pxProCm = aktuellePxProCm();
  const breite  = Z.linealLaengeCm * pxProCm * aktuellerZoomFaktor() * Z.linealKalibrierung;
  D.linealBalken.style.width = `${breite}px`;
  D.linealWrapper.classList.toggle('optisch-modus', istOptischerModus());
  linealZeichnenSkala();
}

function linealTransformAnwenden() {
  D.linealWrapper.style.transform = `translate(${Z.linealPos.x}px, ${Z.linealPos.y}px) rotate(${Z.linealWinkel}deg)`;
}

function linealZeichnenSkala() {
  const breitePx = D.linealBalken.offsetWidth;
  const hoehePx  = D.linealBalken.offsetHeight;
  const cm       = Z.linealLaengeCm;
  const pxProCmAktuell = breitePx / cm;

  D.linealSkala.setAttribute('viewBox', `0 0 ${breitePx} ${hoehePx}`);

  let html = '';
  const mmGesamt = cm * 10;
  for (let mm = 0; mm <= mmGesamt; mm++) {
    const x     = (mm / 10) * pxProCmAktuell;
    const isCm  = mm % 10 === 0;
    const isHCm = mm % 5  === 0 && !isCm;
    const len   = isCm ? hoehePx * 0.55 : isHCm ? hoehePx * 0.38 : hoehePx * 0.22;
    const klasse = isCm ? 'lineal-strich--cm' : isHCm ? 'lineal-strich--halb' : 'lineal-strich--mm';
    html += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${len.toFixed(1)}" class="lineal-strich ${klasse}"/>`;
    if (isCm) html += `<text x="${x.toFixed(1)}" y="${(len + 13).toFixed(1)}" class="lineal-zahl">${mm / 10}</text>`;
  }
  D.linealSkala.innerHTML = html;
}

function linealSnap(e, canvas) {
  if (!Z.linealAktiv) return null;
  const client = clientKoord(e);
  const kante  = linealKanteClient();
  const snapPx = KONFIGURATION.GEO_SNAP_PX;

  const proj = punktAufLinie(client, kante.p1, kante.p2);
  const dist = Math.hypot(client.x - proj.x, client.y - proj.y);

  if (dist < snapPx) {
    D.geoFuehrung.setAttribute('display', 'inline');
    D.geoFuehrung.setAttribute('x1', proj.x);
    D.geoFuehrung.setAttribute('y1', proj.y);
    D.geoFuehrung.setAttribute('x2', proj.x);
    D.geoFuehrung.setAttribute('y2', proj.y);
    return clientZuCanvas(proj.x, proj.y, canvas);
  }
  D.geoFuehrung.setAttribute('display', 'none');
  return null;
}

function linealKanteClient() {
  const B = D.linealBalken.offsetWidth;
  const H = D.linealBalken.offsetHeight;
  const [p1, p2] = werkzeugPunkte(D.linealWrapper, Z.linealPos, Z.linealWinkel, { x: B / 2, y: H / 2 },
    [{ x: 0, y: 0 }, { x: B, y: 0 }]);
  return { p1, p2 };
}

function linealInit() {
  const aktiv = () => Z.linealAktiv;
  const beenden = () => { Z.linealDrag = null; };
  griffBinden(D.linealMoveGriff, aktiv,
    (cx, cy) => { Z.linealDrag = { art: 'move', startX: cx, startY: cy, startPos: { ...Z.linealPos } }; },
    (cx, cy) => { if (Z.linealDrag?.art === 'move') _linealBewegen(cx, cy); }, beenden);
  griffBinden(D.linealDrehGriff, aktiv, (cx, cy) => {
    const u = werkzeugUrsprung(D.linealWrapper, Z.linealPos);
    const pivotX = u.x + D.linealBalken.offsetWidth / 2, pivotY = u.y + D.linealBalken.offsetHeight / 2;
    Z.linealDrag = { art: 'rotate', pivotX, pivotY, startWinkel: winkelZwischen(pivotX, pivotY, cx, cy) - Z.linealWinkel };
  }, (cx, cy) => { if (Z.linealDrag?.art === 'rotate') _linealBewegen(cx, cy); }, beenden);
}

function _linealBewegen(cx, cy) {
  if (!Z.linealDrag) return;
  if (Z.linealDrag.art === 'move') {
    const dx = cx - Z.linealDrag.startX, dy = cy - Z.linealDrag.startY;
    Z.linealPos = { x: Z.linealDrag.startPos.x + dx, y: Z.linealDrag.startPos.y + dy };
  } else if (Z.linealDrag.art === 'rotate') {
    Z.linealWinkel = Math.round(winkelZwischen(Z.linealDrag.pivotX, Z.linealDrag.pivotY, cx, cy) - Z.linealDrag.startWinkel);
  }
  linealTransformAnwenden();
}


/* ===================================================================
   15. SPOTLIGHT
==================================================================== */
function spotlightAn(form) {
  Z.spotFenster = {
    x: (window.innerWidth  - KONFIGURATION.SPOTLIGHT_START_B) / 2,
    y: (window.innerHeight - KONFIGURATION.SPOTLIGHT_START_H) / 2,
    b: KONFIGURATION.SPOTLIGHT_START_B, h: KONFIGURATION.SPOTLIGHT_START_H,
    form,
  };
  D.spotlightOverlay.style.display = 'block';
  D.spotlightOverlay.setAttribute('aria-hidden', 'false');
  D.spotlightFenster.classList.toggle('oval', form === 'oval');
  spotlightAktualisieren();
}
function spotlightAus() {
  D.spotlightOverlay.style.display = 'none';
  D.spotlightOverlay.setAttribute('aria-hidden', 'true');
}
function spotlightAktualisieren() {
  const f = Z.spotFenster;
  D.spotlightFenster.style.cssText = `left:${f.x}px;top:${f.y}px;width:${f.b}px;height:${f.h}px;`;
  D.spotlightFenster.classList.toggle('oval', f.form === 'oval');
  const m = D.spotlightMaske, W = window.innerWidth, H = window.innerHeight;
  if (f.form === 'oval') {
    const mask = `radial-gradient(ellipse ${f.b/2}px ${f.h/2}px at ${f.x+f.b/2}px ${f.y+f.h/2}px, transparent 99%, black 100%)`;
    m.style.webkitMaskImage = mask; m.style.maskImage = mask; m.style.clipPath = '';
  } else {
    m.style.webkitMaskImage = ''; m.style.maskImage = '';
    m.style.clipPath = `polygon(0 0,${W}px 0,${W}px ${H}px,0 ${H}px,0 0,${f.x}px ${f.y}px,${f.x}px ${f.y+f.h}px,${f.x+f.b}px ${f.y+f.h}px,${f.x+f.b}px ${f.y}px,${f.x}px ${f.y}px)`;
  }
}
function spotDragStart(griff, cx, cy) {
  Z.spotGriff = griff;
  Z.spotDragStart = { startX:cx,startY:cy,fx:Z.spotFenster.x,fy:Z.spotFenster.y,fb:Z.spotFenster.b,fh:Z.spotFenster.h };
}
function spotZiehen(cx, cy) {
  if (!Z.spotGriff || !Z.spotDragStart) return;
  const s=Z.spotDragStart, f=Z.spotFenster, dx=cx-s.startX, dy=cy-s.startY;
  const MB=KONFIGURATION.SPOTLIGHT_MIN_B, MH=KONFIGURATION.SPOTLIGHT_MIN_H;
  switch (Z.spotGriff) {
    case 'mitte': f.x=Math.max(0,Math.min(s.fx+dx,window.innerWidth-f.b)); f.y=Math.max(0,Math.min(s.fy+dy,window.innerHeight-f.h)); break;
    case 'se':    f.b=Math.max(MB,s.fb+dx); f.h=Math.max(MH,s.fh+dy); break;
    case 'sw':    f.b=Math.max(MB,s.fb-dx); f.x=s.fx+s.fb-f.b; f.h=Math.max(MH,s.fh+dy); break;
    case 'ne':    f.b=Math.max(MB,s.fb+dx); f.h=Math.max(MH,s.fh-dy); f.y=s.fy+s.fh-f.h; break;
    case 'nw':    f.b=Math.max(MB,s.fb-dx); f.h=Math.max(MH,s.fh-dy); f.x=s.fx+s.fb-f.b; f.y=s.fy+s.fh-f.h; break;
    case 'e':     f.b=Math.max(MB,s.fb+dx); break;
    case 'w':     f.b=Math.max(MB,s.fb-dx); f.x=s.fx+s.fb-f.b; break;
    case 'n':     f.h=Math.max(MH,s.fh-dy); f.y=s.fy+s.fh-f.h; break;
    case 's':     f.h=Math.max(MH,s.fh+dy); break;
  }
  spotlightAktualisieren();
}
function spotlightInit() {
  D.spotGriffe = document.querySelectorAll('.spot-griff');
  D.spotGriffe.forEach(g => {
    g.addEventListener('touchstart', e => {
      if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
      e.preventDefault(); e.stopPropagation();
      spotDragStart(g.dataset.griff, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    g.addEventListener('mousedown', e => {
      if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
      e.preventDefault(); e.stopPropagation();
      spotDragStart(g.dataset.griff, e.clientX, e.clientY);
    });
  });
  const fen = D.spotlightFenster;
  const innen = (x,y) => {
    const f=Z.spotFenster,r=22;
    return x>f.x+r&&x<f.x+f.b-r&&y>f.y+r&&y<f.y+f.h-r;
  };
  fen.addEventListener('touchstart', e => {
    if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
    if (e.target.classList.contains('spot-griff')) return;
    e.preventDefault();
    const t=e.touches[0]; if(innen(t.clientX,t.clientY)) spotDragStart('mitte',t.clientX,t.clientY);
  }, { passive: false });
  fen.addEventListener('mousedown', e => {
    if (Z.fokusModus!=='oval'&&Z.fokusModus!=='rechteck') return;
    if (e.target.classList.contains('spot-griff')) return;
    if (innen(e.clientX,e.clientY)) spotDragStart('mitte',e.clientX,e.clientY);
  });
  document.addEventListener('touchmove', e => {
    if ((Z.fokusModus==='oval'||Z.fokusModus==='rechteck')&&Z.spotGriff) {
      e.preventDefault(); spotZiehen(e.touches[0].clientX,e.touches[0].clientY);
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { Z.spotGriff=null; Z.spotDragStart=null; }, { passive: false });
  document.addEventListener('mousemove', e => {
    if((Z.fokusModus==='oval'||Z.fokusModus==='rechteck')&&Z.spotGriff) spotZiehen(e.clientX,e.clientY);
  });
  document.addEventListener('mouseup', () => { Z.spotGriff=null; Z.spotDragStart=null; });
}


/* ===================================================================
   16. ZOOM (nur PDF-Tabs)
==================================================================== */
function zoomSetzen(n) {
  const tab = aktuellerTab();
  if (!tab || tab.type !== 'pdf') return;
  tab.zoom = Math.min(KONFIGURATION.ZOOM_MAX, Math.max(KONFIGURATION.ZOOM_MIN, n));
  D.zoomScaler.style.transform       = `scale(${tab.zoom})`;
  D.zoomScaler.style.transformOrigin = 'top left';

  const vpBreite   = D.zoomWrapper.clientWidth;
  const containerB = D.pdfContainer.scrollWidth || vpBreite;
  const skaliert   = containerB * tab.zoom;
  const marginLeft = Math.max(0, (vpBreite - skaliert) / 2);
  D.zoomScaler.style.marginLeft = `${marginLeft}px`;

  const containerH = D.pdfContainer.scrollHeight || 600;
  D.zoomScaler.style.height = `${containerH * tab.zoom}px`;

  D.zoomAnzeige.textContent = `${Math.round(tab.zoom * 100)}%`;

  if (Z.geodreieckAktiv) geodreieckSkalieren();
  if (Z.linealAktiv) linealSkalieren();
  if (Z.offenesFlyout === 'stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
  if (Z.offenesFlyout === 'fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
}

function zoomZentrierungAktualisieren() {
  const tab = aktuellerTab();
  if (tab && tab.type === 'pdf') zoomSetzen(tab.zoom || 1.0);
}

function pinchBewegen(e) {
  if (e.touches.length!==2) return; e.preventDefault();
  const tab = aktuellerTab(); if (!tab || tab.type !== 'pdf') return;
  const ab=pinchAbstand(e.touches);
  if (!Z.pinch) { Z.pinch={abstand:ab,zoomStart:tab.zoom}; return; }
  zoomSetzen(Z.pinch.zoomStart*(ab/Z.pinch.abstand));
}

function zoomInit() {
  D.btnZoomPlus.addEventListener('click',  () => { const t=aktuellerTab(); if(t) zoomSetzen((t.zoom||1)+KONFIGURATION.ZOOM_SCHRITT); });
  D.btnZoomMinus.addEventListener('click', () => { const t=aktuellerTab(); if(t) zoomSetzen((t.zoom||1)-KONFIGURATION.ZOOM_SCHRITT); });
  D.btnZoomReset.addEventListener('click', () => zoomSetzen(1.0));

  // Beim Schreiben mit dem Stift (und kurz danach) darf eine aufliegende
  // Hand weder zoomen noch den laufenden Strich verwerfen.
  const stiftSchreibt = e =>
    (Z.zeichnet && Z.zeichenTyp === 'pen') || Date.now() - Z.letzterStiftZeit < 500 ||
    Array.from(e.touches).some(t => t.touchType === 'stylus');
  D.zoomWrapper.addEventListener('touchstart', e => {
    if (e.touches.length !== 2 || stiftSchreibt(e)) return;
    Z.pinch = null;
    if (Z.zeichnet) { // Fingerstrich abbrechen: es wird gezoomt
      strichZustandZuruecksetzen();
      D.pdfContainer.querySelectorAll('.seite-container .zeichen-canvas')
        .forEach(c => canvasNeuZeichnen(seiteVonCanvas(c)));
    }
  }, { passive: false });
  D.zoomWrapper.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || Z.modus !== 'zeichnen') return;
    e.preventDefault();
    if (stiftSchreibt(e)) { Z.pinch = null; return; }
    pinchBewegen(e);
  }, { passive: false });
  D.zoomWrapper.addEventListener('touchend', () => { if(Z.pinch) Z.pinch=null; }, { passive:true });
  D.zoomWrapper.addEventListener('scroll', aktiveSeiteErmitteln, { passive: true });
  D.zoomWrapper.addEventListener('wheel', e => {
    if (e.ctrlKey||e.metaKey) {
      const tab = aktuellerTab(); if (!tab || tab.type !== 'pdf') return;
      e.preventDefault();
      zoomSetzen(tab.zoom+(e.deltaY>0?-KONFIGURATION.ZOOM_SCHRITT:KONFIGURATION.ZOOM_SCHRITT));
    }
  }, { passive: false });

  window.addEventListener('resize', () => {
    laserCanvasAnpassen();
    const tab = aktuellerTab();
    if (tab && tab.type === 'pdf') zoomZentrierungAktualisieren();
    if (tab && tab.type === 'tafel') tafelCanvasAufbauen(tab);
    if (Z.geodreieckAktiv) geodreieckSkalieren();
    if (Z.linealAktiv) linealSkalieren();
    if (Z.offenesFlyout === 'stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
    if (Z.offenesFlyout === 'fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
    if (Z.offenesFlyout === 'widgets') flyoutPositionieren(D.flyoutWidgets, D.btnWidgetMenu);
  });
}


/* ===================================================================
   17. TAB-VERWALTUNG                                            [NEU]
==================================================================== */
function tabErzeugenTafel(name) {
  const id = 'tab-' + Date.now() + Math.floor(Math.random()*1000);
  return {
    id, type: 'tafel', name: name || naechsterTafelName(),
    groesse: null,
    annotationen: {1:[]}, undoVerlauf: {1:[]}, redoVerlauf: {1:[]},
    widgets: [], notiz: '', bgTyp: Z.tafelBgTypStandard || 'none',
  };
}
function tabErzeugenPdf(name) {
  const id = 'tab-' + Date.now() + Math.floor(Math.random()*1000);
  return {
    id, type: 'pdf', name: name || 'PDF',
    pdfBytes: null, pdfDokument: null, seitenAnzahl: 0, aktiveSeite: 1,
    annotationen: {}, undoVerlauf: {}, redoVerlauf: {}, notizenProSeite: {},
    viewports: {}, pxProCm: {}, zoom: 1.0, gerenderteSeitenCanvas: new Set(),
  };
}
function naechsterTafelName() {
  const nummern = Z.tabs.map(t => +(/^Tafel (\d+)$/.exec(t.name)?.[1] || 0));
  return 'Tafel ' + (Math.max(0, ...nummern) + 1);
}

function tabHinzufuegen(tab, aktivieren = true) {
  Z.tabs.push(tab);
  tabsRendern();
  if (aktivieren) tabAktivieren(tab.id);
  autoSpeichernPlanen();
}

function tabAktivieren(id) {
  if (Z.aktiverTabId === id) return;
  tabAbbauen(Z.aktiverTabId);
  Z.aktiverTabId = id;
  D.startAnzeige.style.display = 'none';
  tabAufbauen(id);
  tabsRendern();
  werkzeugSidebarAnpassen();
}

function tabAbbauen(id) {
  const tab = Z.tabs.find(t => t.id === id);
  flyoutsSchliessen();
  geodreieckAus();
  linealAus();
  fokusModusAus();
  if (Z.notizenOffen) notizenSchliessen();
  if (!tab) return;
  if (tab.type === 'tafel') {
    tafelStatusSichern(tab);
    Z.wheelData = {};
    D.tafelWidgetsLayer.innerHTML = '';
    D.kindergarten.innerHTML = '';
  } else if (tab.type === 'pdf') {
    // Alle noch aktiven IntersectionObserver der Seiten-Container explizit
    // trennen, BEVOR das DOM geleert wird. Ohne das würden bei jedem
    // Tab-Wechsel bzw. jedem Scrollen die Sichtbarkeits-Observer der
    // Seiten weiterleben und ihre (jetzt losgelösten) Container-Elemente
    // dauerhaft im Speicher halten - ein klassisches, sich über eine
    // lange Session aufsummierendes Leck.
    D.pdfContainer.querySelectorAll('.seite-container').forEach(containerAufraeumen);
    D.pdfContainer.innerHTML = '';
  }
}

/** Trennt alle an einem Seiten-Container hängenden IntersectionObserver
 *  (Platzhalter-, Sichtbarkeits- und Entladungs-Beobachter). Wird sowohl
 *  beim kompletten Tab-Abbau als auch beim Entladen einer einzelnen,
 *  weit weggescrollten Seite aufgerufen. */
function containerAufraeumen(container) {
  container._obsPlatzhalter?.disconnect();
  container._obsSichtbarkeit?.disconnect();
  container._obsEntladung?.disconnect();
  container._obsPlatzhalter = null;
  container._obsSichtbarkeit = null;
  container._obsEntladung = null;
}

function tabAufbauen(id) {
  const tab = Z.tabs.find(t => t.id === id);
  if (!tab) return;
  if (tab.type === 'tafel') {
    D.zoomWrapper.style.display = 'none';
    D.tafelWrapper.style.display = 'block';
    tafelCanvasAufbauen(tab);
    tafelWidgetsAufbauen(tab);
    tafelBgAnwenden(tab.bgTyp || 'none');
    document.querySelectorAll('.tafel-canvas').forEach(c => c.dataset.werkzeug = Z.werkzeug);
  } else {
    D.tafelWrapper.style.display = 'none';
    D.zoomWrapper.style.display = 'block';
    pdfTabAufbauen(tab);
  }
}

function tabsRendern() {
  D.tabListe.innerHTML = '';
  Z.tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab-eintrag' + (tab.id === Z.aktiverTabId ? ' aktiv' : '');
    el.setAttribute('role', 'listitem');
    el.innerHTML = `
      <span class="tab-eintrag-icon">${tab.type === 'pdf' ? '📄' : '🖊️'}</span>
      <span class="tab-eintrag-name">${escapeHtml(tab.name)}</span>
      ${Z.tabs.length > 1 ? `<span class="tab-eintrag-schliessen" data-schliessen="1">×</span>` : ''}
    `;
    el.addEventListener('click', e => { if (!e.target.closest('[data-schliessen]')) tabAktivieren(tab.id); });
    el.addEventListener('dblclick', () => tabUmbenennen(tab.id));
    const closeBtn = el.querySelector('[data-schliessen]');
    if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); tabSchliessen(tab.id); });
    D.tabListe.appendChild(el);
  });
}

function tabUmbenennen(id) {
  const tab = Z.tabs.find(t => t.id === id); if (!tab) return;
  const neu = window.prompt('Name:', tab.name);
  if (neu && neu.trim()) { tab.name = neu.trim(); tabsRendern(); autoSpeichernPlanen(); }
}

function tabSchliessen(id) {
  if (Z.tabs.length <= 1) { toast('Mindestens ein Tab muss bestehen bleiben.', 'info'); return; }
  const tab = Z.tabs.find(t => t.id === id); if (!tab) return;
  if (!window.confirm(`"${tab.name}" wirklich schließen?`)) return;
  const warAktiv = id === Z.aktiverTabId;
  if (warAktiv) tabAbbauen(id);
  Z.tabs = Z.tabs.filter(t => t.id !== id);
  (tab.widgets || []).forEach(w => timerEntfernen(w.id));
  autoSpeichernPlanen();
  if (warAktiv) {
    Z.aktiverTabId = null;
    tabAktivieren(Z.tabs[0].id);
  } else {
    tabsRendern();
  }
}

function neueTafelOeffnen() {
  D.neueTafelOverlay.style.display = 'flex';
  D.neueTafelOverlay.setAttribute('aria-hidden', 'false');
}
function neueTafelSchliessen() {
  D.neueTafelOverlay.style.display = 'none';
  D.neueTafelOverlay.setAttribute('aria-hidden', 'true');
}
function neueTafelInit() {
  D.btnNeueTafel.addEventListener('click', neueTafelOeffnen);
  D.btnNeueTafelAbbrechen.addEventListener('click', neueTafelSchliessen);
  D.neueTafelBackdrop.addEventListener('click', neueTafelSchliessen);
  D.optNeueSchultafel.addEventListener('click', () => {
    neueTafelSchliessen();
    const tab = tabErzeugenTafel();
    tabHinzufuegen(tab, true);
    toast(`"${tab.name}" angelegt.`, 'erfolg', 1500);
  });
  D.optNeuePdf.addEventListener('click', () => {
    neueTafelSchliessen();
    D.dateiInput.click();
  });
}


/* ===================================================================
   18. TAFEL-TAB (Canvas, Hintergrund)                           [NEU]
==================================================================== */
function tafelCanvasAufbauen(tab) {
  const dpr = KONFIGURATION.ZEICHEN_DPR;
  const rect = D.tafelWrapper.getBoundingClientRect();
  const W = Math.floor(rect.width), H = Math.floor(rect.height);
  if (W <= 0 || H <= 0) return;

  tab.groesse = { w: W, h: H };

  // Die Striche selbst werden nie verändert. Passen sie (z.B. im
  // Hochformat) nicht auf die Fläche, wird nur die Darstellung
  // gleichmäßig verkleinert.
  let maxX = 0, maxY = 0;
  (tab.annotationen[1] || []).forEach(s => s.punkte?.forEach(p => {
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }));
  const skala = Math.min(1, W / (maxX || 1), H / (maxY || 1));
  D.tafelCanvas._skala = skala;

  D.tafelCanvas.width  = W * dpr;
  D.tafelCanvas.height = H * dpr;
  D.tafelCanvas.style.width  = `${W}px`;
  D.tafelCanvas.style.height = `${H}px`;
  const ctx = D.tafelCanvas.getContext('2d');
  ctx.setTransform(dpr * skala, 0, 0, dpr * skala, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  canvasNeuZeichnen(1);
}

function tafelWidgetsAufbauen(tab) {
  D.tafelWidgetsLayer.innerHTML = '';
  D.kindergarten.innerHTML = '';
  (tab.widgets || []).forEach(cfg => widgetErstellen(cfg.type, cfg));
}

function tafelStatusSichern(tab) {
  if (!tab || tab.type !== 'tafel') return;
  const widgetData = [];
  D.tafelWidgetsLayer.querySelectorAll('.widget').forEach(w => {
    const t = w.getAttribute('data-type');
    let v = '';
    if (t === 'timer') {
      const modeEl = document.getElementById('t-mode-' + w.id);
      const textEl = document.getElementById('t-text-' + w.id);
      v = JSON.stringify({
        mode: modeEl ? modeEl.value : '1',
        text: textEl ? textEl.value : '',
        sec: Z.widgetTimers[w.id] ? Z.widgetTimers[w.id].sec : 300,
      });
    } else if (t === 'wheel') {
      const namesEl = document.getElementById('wheel-names-' + w.id);
      const modeEl  = document.getElementById('wheel-mode-' + w.id);
      v = JSON.stringify({ names: namesEl ? namesEl.value : '', mode: modeEl ? modeEl.value : 'keep' });
    } else {
      v = w.querySelector('input')?.value || '';
    }
    widgetData.push({
      id: w.id, type: t, x: w.style.left, y: w.style.top, w: w.style.width, h: w.style.height,
      val: v, theme: w.classList.contains('theme-dark') ? 'dark' : 'sepia',
      fullsize: w.classList.contains('fullsize'),
      hidden: w.classList.contains('hidden'),
    });
  });
  tab.widgets = widgetData;
}


/* ===================================================================
   19. PDF-TAB (Laden, Rendern, Lazy, Export)
==================================================================== */
const PDF_NORMALISIERUNG = {
  SCHWELLE_PUNKTE:   1400,
  ZIEL_MAX_PUNKTE:   842,
};

function pdfSeitenNormalisieren(pdfDoc) {
  let veraendert = false;
  for (const seite of pdfDoc.getPages()) {
    const { width, height } = seite.getSize();
    const groessteKante = Math.max(width, height);
    if (groessteKante > PDF_NORMALISIERUNG.SCHWELLE_PUNKTE) {
      const faktor = PDF_NORMALISIERUNG.ZIEL_MAX_PUNKTE / groessteKante;
      seite.scale(faktor, faktor);
      veraendert = true;
    }
  }
  return veraendert;
}

/** Holt den Worker über die Seite selbst (damit der Service Worker ihn
 *  zwischenspeichert) und startet ihn aus einer lokalen Blob-Adresse. */
async function pdfWorkerVorbereiten() {
  if (pdfjsLib.GlobalWorkerOptions.workerSrc) return;
  try {
    const antwort = await fetch(KONFIGURATION.PDFJS_WORKER);
    if (!antwort.ok) throw new Error(antwort.status);
    const code = await antwort.blob();
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  } catch (_) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = KONFIGURATION.PDFJS_WORKER;
  }
}

/** Lädt eine Datei erstmalig in einen (bereits erzeugten, aktiven) PDF-Tab. */
async function pdfDateiInTab(tab, datei) {
  ladeAnzeige(true, 'PDF wird geöffnet...');
  try {
    const ab = await datei.arrayBuffer();
    let bytes = new Uint8Array(ab);
    try {
      const normDoc = await PDFLib.PDFDocument.load(bytes);
      if (pdfSeitenNormalisieren(normDoc)) bytes = await normDoc.save();
    } catch (normErr) {
      console.warn('[EduLayer] Seiten-Normalisierung übersprungen:', normErr);
      toast('Seitenmaße konnten nicht geprüft werden - Original wird geladen.', 'fehler', 4500);
    }
    tab.pdfBytes = bytes;
    tab.name = datei.name.replace(/\.pdf$/i, '');
    tabsRendern();
    if (tab.id === Z.aktiverTabId) await pdfTabAufbauen(tab);
    toast(`"${datei.name}" geladen`, 'erfolg');
  } catch (err) {
    console.error('[EduLayer] PDF-Ladefehler:', err);
    toast('Fehler beim Laden der PDF.', 'fehler', 4000);
  } finally { ladeAnzeige(false); }
}

/** Baut das DOM für einen (bereits geladenen) PDF-Tab auf - beim
 *  ersten Öffnen genauso wie bei jeder Reaktivierung des Tabs. */
async function pdfTabAufbauen(tab) {
  D.pdfContainer.querySelectorAll('.seite-container').forEach(containerAufraeumen);
  D.pdfContainer.innerHTML = '';
  if (!tab.pdfBytes) return;
  ladeAnzeige(true, `"${tab.name}" wird geöffnet...`);
  try {
    if (!tab.pdfDokument) {
      await pdfWorkerVorbereiten();
      tab.pdfDokument = await pdfjsLib.getDocument({ data: tab.pdfBytes.slice() }).promise;
      tab.seitenAnzahl = tab.pdfDokument.numPages;
    }
    tab.gerenderteSeitenCanvas = new Set();

    await pdfSeiteRendern(tab, 1);

    if (tab.seitenAnzahl > 1) {
      const vp1 = tab.viewports[1];
      for (let i = 2; i <= tab.seitenAnzahl; i++) {
        seitePlatzhalterAnlegen(tab, i, vp1.breite, vp1.hoehe);
      }
    }

    D.zoomSteuerung.style.display = 'flex';
    requestAnimationFrame(() => zoomZentrierungAktualisieren());
    if (Z.geodreieckAktiv) geodreieckSkalieren();
    if (Z.linealAktiv) linealSkalieren();
    tab.aktiveSeite = 1;
  } catch (err) {
    console.error('[EduLayer] PDF-Aufbaufehler:', err);
    toast('Fehler beim Öffnen des Tabs.', 'fehler', 4000);
  } finally { ladeAnzeige(false); }
}

function seitePlatzhalterAnlegen(tab, nr, breite, hoehe) {
  const cont = document.createElement('div');
  cont.className = 'seite-container seite-container--platzhalter';
  cont.dataset.seite = nr;
  cont.style.width  = `${breite}px`;
  cont.style.height = `${hoehe}px`;
  cont.innerHTML = `<div class="seite-platzhalter-label">Seite ${nr}</div>`;
  D.pdfContainer.appendChild(cont);
  seitePlatzhalterBeobachten(tab, cont, nr);
  return cont;
}

function seitePlatzhalterBeobachten(tab, cont, nr) {
  const observer = new IntersectionObserver(async ee => {
    for (const entry of ee) {
      if (entry.isIntersecting) {
        observer.disconnect();
        cont._obsPlatzhalter = null;
        await seiteLazyRendern(tab, nr);
      }
    }
  }, { root: D.zoomWrapper, rootMargin: '200px', threshold: 0.01 });
  cont._obsPlatzhalter = observer;
  observer.observe(cont);
}

async function seiteContainerAufbauen(tab, nr, container) {
  const seite    = await tab.pdfDokument.getPage(nr);
  const dpr      = KONFIGURATION.ZEICHEN_DPR;
  const viewport = seite.getViewport({ scale: KONFIGURATION.PDF_SCALE });
  const W = Math.floor(viewport.width), H = Math.floor(viewport.height);
  tab.viewports[nr] = { breite: W, hoehe: H };
  tab.pxProCm[nr]   = KONFIGURATION.PDF_SCALE * 72 / 2.54;

  container.classList.remove('seite-container--platzhalter');
  container.style.width  = `${W}px`;
  container.style.height = `${H}px`;
  container.innerHTML = '';

  const pdfC = document.createElement('canvas');
  pdfC.className = 'pdf-canvas';
  pdfC.width = W * dpr; pdfC.height = H * dpr;
  pdfC.style.width = `${W}px`; pdfC.style.height = `${H}px`;
  const pdfCtx = pdfC.getContext('2d');
  pdfCtx.scale(dpr, dpr);
  pdfCtx.imageSmoothingEnabled = true;
  pdfCtx.imageSmoothingQuality = 'high';
  container.appendChild(pdfC);

  const zC = document.createElement('canvas');
  zC.className = 'zeichen-canvas';
  zC.width = W * dpr; zC.height = H * dpr;
  zC.style.width = `${W}px`; zC.style.height = `${H}px`;
  zC.dataset.werkzeug = Z.werkzeug;
  const zCtx = zC.getContext('2d');
  zCtx.scale(dpr, dpr);
  zCtx.imageSmoothingEnabled = true;
  zCtx.imageSmoothingQuality = 'high';
  container.appendChild(zC);

  await seite.render({ canvasContext: pdfCtx, viewport }).promise;
  zeichenListeners(zC);
  if (tab.annotationen[nr]?.length) {
    const ctx = zC.getContext('2d');
    stricheZeichnen(ctx, tab.annotationen[nr]);
  }

  tab.gerenderteSeitenCanvas.add(nr);
  seitenEntladungBeobachten(tab, container, nr);
}

function aktiveSeiteErmitteln() {
  const tab = aktuellerTab();
  if (!tab || tab.type !== 'pdf' || Z.notizenOffen) return;
  const sicht = D.zoomWrapper.getBoundingClientRect();
  let beste = null, hoehe = 0;
  D.pdfContainer.querySelectorAll('.seite-container').forEach(c => {
    const r = c.getBoundingClientRect();
    const h = Math.min(r.bottom, sicht.bottom) - Math.max(r.top, sicht.top);
    if (h > hoehe) { hoehe = h; beste = +c.dataset.seite; }
  });
  if (beste && beste !== tab.aktiveSeite) {
    tab.aktiveSeite = beste;
    if (Z.geodreieckAktiv) geodreieckSkalieren();
    if (Z.linealAktiv) linealSkalieren();
  }
}

function seitenEntladungBeobachten(tab, container, nr) {
  const observer = new IntersectionObserver(ee => {
    ee.forEach(e => {
      if (!e.isIntersecting) {
        observer.disconnect();
        container._obsEntladung = null;
        if (tab.id === Z.aktiverTabId) seiteEntladen(tab, nr, container);
      }
    });
  }, { root: D.zoomWrapper, rootMargin: '1500px', threshold: 0 });
  container._obsEntladung = observer;
  observer.observe(container);
}

function seiteEntladen(tab, nr, container) {
  if (nr === tab.aktiveSeite) return;
  if (!tab.gerenderteSeitenCanvas?.has(nr)) return;

  // Sichtbarkeits-Observer dieser (jetzt entladenen) Seite trennen - sonst
  // bleibt er aktiv, obwohl der Container gleich zum Platzhalter wird, und
  // beim nächsten Wieder-Einblenden käme ein zweiter Observer dazu.
  container._obsSichtbarkeit?.disconnect();
  container._obsSichtbarkeit = null;

  container.querySelectorAll('canvas').forEach(c => { c.width = 0; c.height = 0; });
  const vp = tab.viewports[nr];
  container.innerHTML = '';
  container.classList.add('seite-container--platzhalter');
  if (vp) { container.style.width = `${vp.breite}px`; container.style.height = `${vp.hoehe}px`; }
  container.innerHTML = `<div class="seite-platzhalter-label">Seite ${nr}</div>`;

  tab.gerenderteSeitenCanvas.delete(nr);
  seitePlatzhalterBeobachten(tab, container, nr);
}

async function pdfSeiteRendern(tab, nr) {
  const cont = document.createElement('div');
  cont.className = 'seite-container';
  cont.dataset.seite = nr;
  D.pdfContainer.appendChild(cont);
  await seiteContainerAufbauen(tab, nr, cont);
}

async function seiteLazyRendern(tab, nr) {
  if (tab.id !== Z.aktiverTabId) return;
  if (tab.gerenderteSeitenCanvas?.has(nr)) return;
  const platzhalter = D.pdfContainer.querySelector(`.seite-container[data-seite="${nr}"]`);
  if (!platzhalter) return;
  try {
    await seiteContainerAufbauen(tab, nr, platzhalter);
  } catch (err) {
    console.warn(`[EduLayer] Lazy-Render Seite ${nr}:`, err);
  }
}

/* ---- PDF-Export (Vektor, aus Punktdaten) ---- */
function hexZuRgbNormiert(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const zahl = parseInt(h, 16);
  return { r: ((zahl >> 16) & 255) / 255, g: ((zahl >> 8) & 255) / 255, b: (zahl & 255) / 255 };
}
const EXPORT_DASH_MUSTER = {
  solid: null, dashed: [4, 2.5], dotted: [0.5, 2.5], 'dash-dot': [5, 2, 0.5, 2],
};
/** umrechnen: Bildschirm-Punkt -> PDF-Punkt (berücksichtigt Drehung und
 *  Beschnitt der Seite). skala: Faktor für Strichbreiten. */
function strichInPdfZeichnen(pdfSeite, strich, umrechnen, skala) {
  if (!strich?.punkte?.length) return;
  const { r, g, b } = hexZuRgbNormiert(strich.farbe);
  const farbe = PDFLib.rgb(r, g, b);
  const dicke = strich.breite * skala;

  if (strich.werkzeug === 'gerade-linie') {
    const [von, bis] = strich.punkte;
    const muster = EXPORT_DASH_MUSTER[strich.linienstil ?? 'solid'];
    pdfSeite.drawLine({
      start: umrechnen(von), end: umrechnen(bis),
      thickness: dicke, color: farbe, opacity: 1,
      dashArray: muster ? muster.map(w => w * dicke) : undefined,
      lineCap: PDFLib.LineCapStyle.Round,
    });
    return;
  }
  const marker = strich.werkzeug === 'textmarker';
  const deckkraft = marker ? (strich.alpha ?? KONFIGURATION.TEXTMARKER_ALPHA) : 1;
  const pts = strich.punkte.map(umrechnen);
  if (pts.length === 1) {
    if (!marker) pdfSeite.drawCircle({ x: pts[0].x, y: pts[0].y, size: dicke / 2, color: farbe });
    return;
  }
  // Ein zusammenhängender Pfad: keine dunklen Flecken beim Textmarker.
  // drawSvgPath spiegelt die y-Achse, daher -y.
  const pfad = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join(' ');
  pdfSeite.pushOperators(PDFLib.pushGraphicsState(), PDFLib.setLineJoin(PDFLib.LineJoinStyle.Round));
  pdfSeite.drawSvgPath(pfad, {
    x: 0, y: 0, borderColor: farbe, borderWidth: dicke,
    borderOpacity: deckkraft, borderLineCap: PDFLib.LineCapStyle.Round,
  });
  pdfSeite.pushOperators(PDFLib.popGraphicsState());
}
async function pdfSpeichern() {
  const tab = aktuellerTab();
  if (!tab || tab.type !== 'pdf' || !tab.pdfBytes) { toast('Keine PDF geladen.', 'fehler'); return; }
  ladeAnzeige(true, 'PDF wird gespeichert...');
  try {
    const pdfDoc = await PDFLib.PDFDocument.load(tab.pdfBytes);
    const seiten = pdfDoc.getPages();
    for (let s = 1; s <= tab.seitenAnzahl; s++) {
      const striche = tab.annotationen[s];
      if (!striche?.length) continue;
      const pdfSeite = seiten[s - 1];
      if (!pdfSeite) continue;
      const ansicht = (await tab.pdfDokument.getPage(s)).getViewport({ scale: KONFIGURATION.PDF_SCALE });
      const fx = ansicht.width / Math.floor(ansicht.width), fy = ansicht.height / Math.floor(ansicht.height);
      const umrechnen = p => {
        const [x, y] = ansicht.convertToPdfPoint(p.x * fx, p.y * fy);
        return { x, y };
      };
      for (const strich of striche) strichInPdfZeichnen(pdfSeite, strich, umrechnen, 1 / KONFIGURATION.PDF_SCALE);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    pdfDoc.setCreator('EduLayer + Board Fusion');
    pdfDoc.setModificationDate(new Date());
    const name = `${tab.name}_${zeitstempel()}.pdf`;
    dateiAusgeben(await pdfDoc.save(), name, 'application/pdf');
  } catch (err) {
    console.error('[EduLayer] Speicherfehler:', err);
    toast('Fehler beim Speichern.', 'fehler', 4000);
  } finally { ladeAnzeige(false); }
}


/* ===================================================================
   20. WIDGETS (portiert aus Klassenzimmer-Board)                [NEU]
   Nur in Tafel-Tabs sichtbar/erzeugbar.
==================================================================== */
function ensureAudioCtx() {
  if (!Z.audioCtx) Z.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (Z.audioCtx.state !== 'running') Z.audioCtx.resume(); // iOS: auch 'interrupted'
  return Z.audioCtx;
}
function playBeepOnce() {
  const ac = ensureAudioCtx();
  const osc = ac.createOscillator(); const gain = ac.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(880, ac.currentTime);
  gain.gain.setValueAtTime(0.0001, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
  osc.connect(gain); gain.connect(ac.destination);
  osc.start(); osc.stop(ac.currentTime + 0.4);
}
function startAlarmSound() { stopAlarmSound(); playBeepOnce(); Z.alarmBeepInterval = setInterval(playBeepOnce, 600); }
function stopAlarmSound() { if (Z.alarmBeepInterval) { clearInterval(Z.alarmBeepInterval); Z.alarmBeepInterval = null; } }
function speakAnnouncement(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.resume(); window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(text); msg.lang = 'de-DE';
    const voices = window.speechSynthesis.getVoices();
    const deVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('de'));
    if (deVoice) msg.voice = deVoice;
    window.speechSynthesis.speak(msg);
  } catch (e) { console.error('Sprachausgabe fehlgeschlagen', e); }
}

function widgetErstellen(typ, config = {}) {
  const tab = aktuellerTab();
  if (!tab || tab.type !== 'tafel') { toast('Objekte gibt es nur in Tafel-Tabs.', 'info'); return; }
  const id = config.id || 'w-' + Date.now() + Math.floor(Math.random() * 1000);
  const theme = config.theme || (Z.thema === 'hell' ? 'sepia' : 'dark');
  const w = document.createElement('div');
  w.className = `widget theme-${theme}`;
  w.id = id;
  w.style.left = config.x || '80px';
  w.style.top = config.y || '80px';
  w.style.width = config.w || '320px';
  w.style.height = config.h || '380px';
  w.setAttribute('data-type', typ);
  w.style.zIndex = 10;

  let inner = '';
  if (typ === 'image') {
    inner = `<div class="settings-panel"><input type="text" placeholder="Bild-URL..." onchange="widgetBildAktualisieren('${id}', this.value)" value="${escapeHtml(config.val)}" style="width:100%"></div>
             <img id="img-${id}" class="img-display" src="${escapeHtml(config.val)}">`;
  } else if (typ === 'timer') {
    let tConf = { mode: '1', text: '', sec: 300 };
    if (config.val) { try { tConf = Object.assign(tConf, JSON.parse(config.val)); } catch (e) {} }
    inner = `
      <div class="settings-panel">
        <select id="t-mode-${id}">
          <option value="1" ${tConf.mode == '1' ? 'selected' : ''}>Nur Klingeln</option>
          <option value="2" ${tConf.mode == '2' ? 'selected' : ''}>Klingeln + Ansage</option>
        </select>
        <input type="text" id="t-text-${id}" placeholder="Ansagetext..." value="${escapeHtml(tConf.text)}" style="width:100%; margin-top:5px;">
      </div>
      <div class="timer-display" id="t-disp-${id}">00:00</div>
      <button class="ctrl-btn alarm-stop-btn" id="t-stop-${id}" onclick="widgetAlarmStop('${id}')">ALARM STOPPEN</button>
      <div style="display:flex; justify-content:center; gap:10px; margin-top:8px;">
        <button class="ctrl-btn" onclick="widgetTimerAdj('${id}', -60)">-1m</button>
        <button class="ctrl-btn" onclick="widgetTimerAdj('${id}', 60)">+1m</button>
        <button class="ctrl-btn" onclick="widgetTimerStart('${id}')">▶️</button>
        <button class="ctrl-btn" onclick="widgetTimerPause('${id}')">⏸️</button>
      </div>`;
    // Läuft der Timer schon (Tabwechsel), bleibt er unangetastet
    if (!Z.widgetTimers[id]) Z.widgetTimers[id] = { sec: tConf.sec !== undefined ? tConf.sec : 300, interval: null, ende: 0, alarm: false };
  } else if (typ === 'wheel') {
    let wConf = { names: 'Anna, Tom, Lisa', mode: 'keep' };
    if (config.val) { try { wConf = Object.assign(wConf, JSON.parse(config.val)); } catch (e) { wConf.names = config.val; } }
    inner = `<div class="winner-overlay" id="winner-overlay-${id}"><h1 id="winner-name-${id}"></h1><button class="ctrl-btn" onclick="widgetWinnerSchliessen('${id}')">OK</button></div>
             <div class="wheel-wrap"><canvas class="wheel-canvas" id="canvas-wheel-${id}"></canvas><div class="wheel-zeiger" id="zeiger-${id}"></div></div>
             <div class="settings-panel">
                <input type="text" id="wheel-names-${id}" onchange="widgetWheelInit('${id}')" value="${escapeHtml(wConf.names)}" style="width:100%">
                <select id="wheel-mode-${id}">
                    <option value="keep" ${wConf.mode === 'keep' ? 'selected' : ''}>Behalten</option>
                    <option value="remove" ${wConf.mode === 'remove' ? 'selected' : ''}>Einmal</option>
                </select>
                <button class="ctrl-btn" onclick="widgetWheelInit('${id}')" style="margin-top:5px">Reset Liste</button>
             </div>
             <button class="ctrl-btn" style="width:100%; background:var(--akzent); color:white;" onclick="widgetWheelSpin('${id}')">DREHEN</button>`;
  } else if (typ === 'qr') {
    inner = `<div class="settings-panel"><input type="text" placeholder="URL..." onchange="widgetQrAktualisieren('${id}', this.value)" value="${escapeHtml(config.val)}" style="width:100%"></div><img id="qr-${id}" class="qr-bild" alt="">`;
  }

  w.innerHTML = `
    <div class="widget-header" data-drag="${id}">
      <span>${KONFIGURATION.WIDGET_ICONS[typ]}</span>
      <div class="header-controls">
        <span class="header-icon" title="Vollbild" onclick="widgetVollbild('${id}')">⛶</span>
        <span class="header-icon" onclick="widgetSettingsUmschalten('${id}')">⚙️</span>
        <span class="header-icon" onclick="widgetThemeUmschalten('${id}')">🌓</span>
        <span class="header-icon" onclick="widgetEntfernen('${id}')">×</span>
      </div>
    </div>
    <div class="widget-content">${inner}</div>
    <div class="widget-resizer" data-resize="${id}"></div>`;

  D.tafelWidgetsLayer.appendChild(w);
  widgetZuKindergarten(id, typ);
  widgetDragBinden(w.querySelector('[data-drag]'), w);
  widgetResizeBinden(w.querySelector('[data-resize]'), w);
  w.addEventListener('pointerdown', () => widgetFokussieren(id));

  if (typ === 'wheel') {
    setTimeout(() => widgetWheelInit(id), 100);
    if (window.ResizeObserver) new ResizeObserver(() => widgetZeigerSetzen(id)).observe(w.querySelector('.wheel-wrap'));
  }
  if (typ === 'qr') widgetQrAktualisieren(id, config.val || '');
  if (typ === 'timer') {
    widgetTimerAnzeigeAktualisieren(id);
    if (Z.widgetTimers[id].alarm) document.getElementById('t-stop-' + id).style.display = 'block';
  }
  if (config.hidden) { w.classList.add('hidden'); document.getElementById('kg-' + id)?.classList.remove('aktiv'); }
  autoSpeichernPlanen();
  if (config.fullsize) { w.classList.add('fullsize'); const kg = document.getElementById('kg-' + id); if (kg) kg.classList.add('fullsize'); }
  widgetFokussieren(id);
}

function widgetDragBinden(header, w) {
  header.addEventListener('pointerdown', e => {
    if (w.classList.contains('fullsize') || e.target.closest('.header-controls') || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    widgetFokussieren(w.id);
    header.setPointerCapture(e.pointerId);
    const sX = e.clientX - w.offsetLeft, sY = e.clientY - w.offsetTop;
    const move = m => { w.style.left = (m.clientX - sX) + 'px'; w.style.top = (m.clientY - sY) + 'px'; };
    const stop = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', stop);
      header.removeEventListener('pointercancel', stop);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', stop);
    header.addEventListener('pointercancel', stop);
  });
}
function widgetResizeBinden(handle, w) {
  handle.addEventListener('pointerdown', e => {
    if (w.classList.contains('fullsize')) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const sW = w.offsetWidth, sH = w.offsetHeight, sX = e.clientX, sY = e.clientY;
    const move = m => { w.style.width = (sW + (m.clientX - sX)) + 'px'; w.style.height = (sH + (m.clientY - sY)) + 'px'; };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
}
function widgetFokussieren(id) {
  D.tafelWidgetsLayer.querySelectorAll('.widget').forEach(w => w.style.zIndex = 10);
  const aktiv = document.getElementById(id);
  if (aktiv) aktiv.style.zIndex = 100;
}
function widgetVollbild(id) {
  document.getElementById(id).classList.toggle('fullsize');
  const kg = document.getElementById('kg-' + id);
  if (kg) kg.classList.toggle('fullsize', document.getElementById(id).classList.contains('fullsize'));
}
function widgetSettingsUmschalten(id) { document.getElementById(id).classList.toggle('show-settings'); }
function widgetThemeUmschalten(id) {
  document.getElementById(id).classList.toggle('theme-sepia');
  document.getElementById(id).classList.toggle('theme-dark');
}
function widgetEntfernen(id) {
  document.getElementById(id)?.remove();
  const kg = document.getElementById('kg-' + id); if (kg) kg.remove();
  timerEntfernen(id);
  delete Z.wheelData[id];
}
function widgetZuKindergarten(id, typ) {
  const b = document.createElement('button');
  b.className = 'btn-parked aktiv'; b.id = 'kg-' + id; b.innerHTML = KONFIGURATION.WIDGET_ICONS[typ];
  b.onclick = () => {
    const w = document.getElementById(id);
    if (w.classList.contains('hidden')) { w.classList.remove('hidden'); b.classList.add('aktiv'); widgetFokussieren(id); }
    else { w.classList.add('hidden'); b.classList.remove('aktiv'); }
  };
  D.kindergarten.appendChild(b);
}

/* Timer laufen über eine Endzeit: unabhängig vom aktiven Tab und auch
   dann richtig, wenn iPadOS die App im Hintergrund angehalten hat. */
function widgetTimerAdj(id, d) {
  const t = Z.widgetTimers[id]; if (!t) return;
  t.sec = Math.max(0, t.sec + d);
  if (t.interval) t.ende = Date.now() + t.sec * 1000;
  widgetTimerAnzeigeAktualisieren(id);
}
function widgetTimerAnzeigeAktualisieren(id) {
  const t = Z.widgetTimers[id]; if (!t) return;
  const m = Math.floor(t.sec / 60), s = t.sec % 60;
  const el = document.getElementById('t-disp-' + id);
  if (el) el.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
}
/** iOS erlaubt Ton und Sprache nur nach einem Antippen - hier freischalten. */
function tonFreischalten() {
  try {
    const ac = ensureAudioCtx();
    const quelle = ac.createBufferSource();
    quelle.buffer = ac.createBuffer(1, 1, 22050);
    quelle.connect(ac.destination); quelle.start();
    if ('speechSynthesis' in window) {
      const stumm = new SpeechSynthesisUtterance(' '); stumm.volume = 0;
      window.speechSynthesis.speak(stumm);
    }
  } catch (_) {}
}
function widgetTimerStart(id) {
  const t = Z.widgetTimers[id]; if (!t || t.interval || t.sec <= 0) return;
  tonFreischalten();
  // Modus und Ansagetext merken: Widget ist evtl. beim Ablauf nicht sichtbar
  const textEinlesen = () => {
    const modeEl = document.getElementById('t-mode-' + id);
    if (!modeEl) return;
    t.ansage = modeEl.value === '2' ? (document.getElementById('t-text-' + id)?.value || 'Die Zeit ist abgelaufen') : '';
  };
  textEinlesen();
  t.ende = Date.now() + t.sec * 1000;
  t.interval = setInterval(() => {
    textEinlesen();
    t.sec = Math.max(0, Math.ceil((t.ende - Date.now()) / 1000));
    widgetTimerAnzeigeAktualisieren(id);
    if (t.sec === 0) { clearInterval(t.interval); t.interval = null; widgetAlarmSequenzStart(id); }
  }, 250);
}
function widgetTimerPause(id) { const t = Z.widgetTimers[id]; if (t) { clearInterval(t.interval); t.interval = null; } }
function widgetAlarmSequenzStart(id) {
  const t = Z.widgetTimers[id]; if (!t) return;
  t.alarm = true;
  startAlarmSound();
  const stopBtn = document.getElementById('t-stop-' + id);
  if (stopBtn) stopBtn.style.display = 'block';
  alarmKnopfAktualisieren();
  if (t.ansage) speakAnnouncement(t.ansage);
}
/** Stopp-Knopf, der auch in anderen Tabs sichtbar bleibt. */
function alarmKnopfAktualisieren() {
  const klingelt = Object.keys(Z.widgetTimers).some(k => Z.widgetTimers[k].alarm);
  let knopf = document.getElementById('alarm-global');
  if (!klingelt) { knopf?.remove(); return; }
  if (knopf) return;
  knopf = Object.assign(document.createElement('button'), { id: 'alarm-global', textContent: '⏰ ALARM STOPPEN' });
  knopf.onclick = () => Object.keys(Z.widgetTimers).forEach(widgetAlarmStop);
  document.body.appendChild(knopf);
}
function widgetAlarmStop(id) {
  const t = Z.widgetTimers[id];
  if (t) t.alarm = false;
  const stopBtn = document.getElementById('t-stop-' + id);
  if (stopBtn) stopBtn.style.display = 'none';
  if (!Object.keys(Z.widgetTimers).some(k => Z.widgetTimers[k].alarm)) {
    stopAlarmSound();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
  alarmKnopfAktualisieren();
}
function timerEntfernen(id) {
  const t = Z.widgetTimers[id]; if (!t) return;
  clearInterval(t.interval);
  widgetAlarmStop(id);
  delete Z.widgetTimers[id];
}

function widgetBildAktualisieren(id, url) { const el = document.getElementById('img-' + id); if (el) el.src = url; }
/** QR-Code wird direkt auf dem Gerät erzeugt (offline, nichts verlässt das iPad). */
function widgetQrAktualisieren(id, v) {
  const el = document.getElementById('qr-' + id); if (!el) return;
  if (!v) { el.removeAttribute('src'); return; }
  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, 'M');
    qr.addData(v); qr.make();
    el.src = qr.createDataURL(8, 32);
  } catch (e) { el.removeAttribute('src'); toast('Text ist zu lang für einen QR-Code.', 'fehler'); }
}

function widgetWheelInit(id) {
  const input = document.getElementById('wheel-names-' + id)?.value || '';
  const names = input.split(',').map(n => n.trim()).filter(n => n);
  Z.wheelData[id] = { angle: 0, currentNames: [...names] };
  widgetWheelZeichnen(id);
}
function widgetWheelZeichnen(id) {
  const data = Z.wheelData[id]; if (!data) return;
  const names = data.currentNames;
  const c = document.getElementById('canvas-wheel-' + id); if (!c) return;
  const ctx2 = c.getContext('2d'); c.width = 800; c.height = 800;
  if (names.length === 0) { ctx2.clearRect(0, 0, 800, 800); return; }
  const arc = (Math.PI * 2) / names.length;
  names.forEach((n, i) => {
    ctx2.beginPath(); ctx2.fillStyle = `hsl(${i * (360 / names.length)}, 70%, 60%)`;
    ctx2.moveTo(400, 400); ctx2.arc(400, 400, 380, i * arc, (i + 1) * arc); ctx2.fill();
    ctx2.save(); ctx2.translate(400, 400); ctx2.rotate(i * arc + arc / 2);
    ctx2.fillStyle = 'white'; ctx2.font = 'bold 30px Arial'; ctx2.fillText(n.substring(0, 12), 160, 10); ctx2.restore();
  });
  widgetZeigerSetzen(id);
}
/** Zeiger unten am Rad (dort wertet widgetWheelSpin den Gewinner aus). */
function widgetZeigerSetzen(id) {
  const c = document.getElementById('canvas-wheel-' + id), z = document.getElementById('zeiger-' + id);
  if (!c || !z) return;
  const radius = Math.min(c.offsetWidth, c.offsetHeight) / 2 * 0.95;
  z.style.top = (c.offsetTop + c.offsetHeight / 2 + radius - 14) + 'px';
}
function widgetWheelSpin(id) {
  const data = Z.wheelData[id];
  if (!data || data.dreht || data.currentNames.length === 0) return;
  data.dreht = true;
  const extra = 1800 + Math.random() * 2000; data.angle += extra;
  const c = document.getElementById('canvas-wheel-' + id);
  if (c) c.style.transform = `rotate(${data.angle}deg)`;
  setTimeout(() => {
    data.dreht = false;
    const deg = data.angle % 360;
    const idx = Math.floor(((360 - deg + 90) % 360) / (360 / data.currentNames.length));
    const winner = data.currentNames[idx];
    const nameEl = document.getElementById('winner-name-' + id);
    if (nameEl) nameEl.innerText = winner;
    const overlay = document.getElementById('winner-overlay-' + id);
    if (overlay) overlay.style.display = 'flex';
    const modeEl = document.getElementById('wheel-mode-' + id);
    if (modeEl && modeEl.value === 'remove') {
      data.currentNames.splice(idx, 1);
      setTimeout(() => widgetWheelZeichnen(id), 500);
    }
  }, 4100);
}
function widgetWinnerSchliessen(id) { const el = document.getElementById('winner-overlay-' + id); if (el) el.style.display = 'none'; }


/* ===================================================================
   21. TAFELN SPEICHERN / LADEN                                  [NEU]
   -------------------------------------------------------------------
   Bewusst getrennt von den PDF-Tabs, genau wie in den beiden
   Ursprungs-Programmen:
    - PDF-Tabs verhalten sich wie im ursprünglichen EduLayer: keine
      automatische Zwischenspeicherung, nur expliziter Vektor-Export
      der annotierten PDF-Datei (siehe pdfSpeichern() weiter oben).
      Schließt man die App ohne Export, ist die PDF-Annotation weg -
      das war im Original genauso.
    - Alle Tafel-Tabs zusammen verhalten sich wie Klassenzimmer-Board:
      automatisches Laden beim Start, manueller "Lokal speichern"-
      Button, sowie Datei-Export/Import als ein gemeinsames JSON-
      Dokument (mehrere Tafeln = mehrere "Seiten" wie im Original).
      PDF-Tabs bleiben davon komplett unberührt.
==================================================================== */
const TAFELN_STORAGE_KEY = 'edulayer-tafeln-v1';

/** Sichert - falls gerade eine Tafel aktiv ist - deren Live-DOM-Stand
 *  (Widgets etc.) ins Tab-Objekt, damit gatherState auch den aktuell
 *  offenen Tab korrekt erfasst (alle anderen Tafel-Tabs sind bereits
 *  beim letzten Tab-Wechsel synchronisiert worden). */
function alleTafelnSynchronisieren() {
  const tab = aktuellerTab();
  if (tab && tab.type === 'tafel') tafelStatusSichern(tab);
}

function tafelnGesamtDokument() {
  alleTafelnSynchronisieren();
  const tafeln = Z.tabs.filter(t => t.type === 'tafel');
  return {
    tafeln: tafeln.map(t => ({
      id: t.id, name: t.name, groesse: t.groesse,
      annotationen: t.annotationen, widgets: t.widgets, notiz: t.notiz, bgTyp: t.bgTyp,
    })),
    gespeichertAm: new Date().toISOString(),
  };
}

/** Entfernt leere/defekte Einträge (stammen aus dem früheren Undo-Fehler). */
function stricheBereinigen(liste) {
  return Array.isArray(liste) ? liste.filter(s => s && Array.isArray(s.punkte) && s.punkte.length) : [];
}

function tafelnAusDatenErzeugen(doc) {
  const liste = (doc.tafeln || []).map(data => {
    const tab = tabErzeugenTafel(data.name);
    if (data.id) tab.id = data.id;
    tab.groesse = data.groesse || null;
    tab.annotationen = { 1: stricheBereinigen(data.annotationen?.[1]) };
    tab.widgets = data.widgets || [];
    tab.notiz = data.notiz || '';
    tab.bgTyp = data.bgTyp || 'none';
    return tab;
  });
  // fortlaufende Namen, falls Daten ohne Namen kommen
  return liste.length ? liste : [tabErzeugenTafel()];
}

/* ---- Automatisches Speichern ---- */
let autoSpeicherTimer = null;
let autoSpeichernGesperrt = false;
let speicherFehlerGemeldet = false;

function autoSpeichernPlanen() {
  clearTimeout(autoSpeicherTimer);
  autoSpeicherTimer = setTimeout(() => {
    // Nie mitten in einen Strich hinein speichern
    if (Z.zeichnet) autoSpeichernPlanen();
    else autoSpeichern();
  }, 1200);
}
function autoSpeichern() {
  clearTimeout(autoSpeicherTimer);
  if (autoSpeichernGesperrt || !Z.aktiverTabId) return;
  try {
    localStorage.setItem(TAFELN_STORAGE_KEY, JSON.stringify(tafelnGesamtDokument()));
    speicherFehlerGemeldet = false;
  } catch (e) {
    if (!speicherFehlerGemeldet) toast('Automatisches Speichern fehlgeschlagen - bitte als Datei sichern!', 'fehler', 6000);
    speicherFehlerGemeldet = true;
  }
}
function autoSpeichernInit() {
  window.addEventListener('pagehide', autoSpeichern);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoSpeichern(); });
  // Objekte (verschieben, Größe, Einstellungen, parken, entfernen)
  [D.tafelWidgetsLayer, D.kindergarten].forEach(el =>
    ['pointerup', 'click', 'change', 'input'].forEach(typ => el.addEventListener(typ, autoSpeichernPlanen)));
  // Hintergrund
  document.querySelectorAll('.bg-type-btn').forEach(b => b.addEventListener('click', autoSpeichernPlanen));
}

function tafelnSpeichern() {
  try {
    localStorage.setItem(TAFELN_STORAGE_KEY, JSON.stringify(tafelnGesamtDokument()));
    toast('Tafeln lokal gespeichert.', 'erfolg');
  } catch (e) {
    toast('Speichern fehlgeschlagen (evtl. zu wenig Speicherplatz): ' + e.message, 'fehler', 4000);
  }
}

function tafelnExportieren() {
  return dateiAusgeben(JSON.stringify(tafelnGesamtDokument()), `tafeln-${zeitstempel()}.json`, 'application/json');
}

function tafelnImportieren(datei) {
  const reader = new FileReader();
  reader.onload = async e => {
    let neueTafeln;
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed?.tafeln) || !parsed.tafeln.length) throw new Error('keine Tafeln');
      neueTafeln = tafelnAusDatenErzeugen(parsed);
    } catch (err) { toast('Öffnen fehlgeschlagen: keine Tafel-Datei.', 'fehler'); return; }
    if (!window.confirm('Alle aktuellen Tafeln durch die Datei ersetzen?\n\n„Abbrechen" = nichts ändern')) return;
    // Sicherheitskopie des bisherigen Stands im Gerätespeicher
    try { localStorage.setItem(TAFELN_STORAGE_KEY + '-vor-import', JSON.stringify(tafelnGesamtDokument())); } catch (_) {}
    if (window.confirm('Bisherige Tafeln zusätzlich als Datei sichern?\n\n„OK" = sichern\n„Abbrechen" = ohne Datei weiter')) {
      await tafelnExportieren();
    }
    tafelnErsetzen(neueTafeln);
    autoSpeichern();
    toast('Tafeln geladen.', 'erfolg');
  };
  reader.readAsText(datei);
}

/** Ersetzt ausschließlich die Tafel-Tabs im Tab-Array; PDF-Tabs
 *  bleiben unverändert erhalten und aktiv, falls einer offen war. */
function tafelnErsetzen(neueTafeln) {
  const aktiverTab = aktuellerTab();
  const aktivWarTafel = aktiverTab && aktiverTab.type === 'tafel';
  if (aktivWarTafel) tabAbbauen(Z.aktiverTabId);
  Object.keys(Z.widgetTimers).forEach(timerEntfernen);

  const pdfTabs = Z.tabs.filter(t => t.type === 'pdf');
  Z.tabs = [...neueTafeln, ...pdfTabs];

  if (aktivWarTafel || !aktiverTab) {
    Z.aktiverTabId = null;
    tabAktivieren(neueTafeln[0].id);
  } else {
    tabsRendern();
  }
}

/** Wird beim App-Start aufgerufen: lädt gespeicherte Tafeln (falls
 *  vorhanden) direkt ins Tab-Array, OHNE sie zu aktivieren - die
 *  eigentliche Aktivierung übernimmt appStart() im Anschluss. */
function tafelnAutoLaden() {
  let raw = null;
  try {
    raw = localStorage.getItem(TAFELN_STORAGE_KEY);
    if (!raw) return false;
    const tafeln = tafelnAusDatenErzeugen(JSON.parse(raw));
    Z.tabs.push(...tafeln);
    return true;
  } catch (e) {
    console.error('[EduLayer] Tafeln laden fehlgeschlagen:', e);
    // Unlesbaren Stand aufheben, bevor automatisch gespeichert wird
    try { if (raw) localStorage.setItem(TAFELN_STORAGE_KEY + '-defekt', raw); }
    catch (_) { autoSpeichernGesperrt = true; }
    return false;
  }
}


/* ===================================================================
   22. SERVICE WORKER
==================================================================== */
function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;
  const registrieren = async () => {
    try {
      const hatteVorher = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && hatteVorher)
            toast('Update verfügbar - App neu öffnen.', 'info', 6000);
        });
      });
    } catch (e) { console.warn('[EduLayer] SW:', e); }
  };
  if (document.readyState === 'complete') registrieren();
  else window.addEventListener('load', registrieren);
}


/* ===================================================================
   23. APP-START
==================================================================== */
function appStart() {
  console.log('[EduLayer + Board Fusion] v1.0 startet...');

  laserCanvasAnpassen();
  themaLaden();
  geoKalibrierungLaden();
  pdfTransparenzLaden();
  linealEinstellungenLaden();
  tafelBgLaden();
  tafelRasterLaden();
  stiftExklusivLaden();
  sidebarPositionLaden();

  sidebarInit();
  einstellungenInit();
  notizenInit();
  spotlightInit();
  geodreieckInit();
  linealInit();
  // Falls das Bild schon vor dem Laden dieses Skripts gescheitert ist
  if (D.geoBild.tagName === 'IMG' && D.geoBild.complete && !D.geoBild.naturalWidth) geoImgFallback(D.geoBild);
  zoomInit();
  neueTafelInit();

  // Zeichen-Listener für die Tafel-Canvas werden EINMALIG gebunden,
  // da es sich um ein persistentes, wiederverwendetes Element handelt
  // (im Gegensatz zu den PDF-Seiten-Canvases, die pro Tab neu entstehen).
  zeichenListeners(D.tafelCanvas);

  werkzeugWaehlen('stift-duenn');
  farbeWaehlen(KONFIGURATION.STANDARD_FARBE);

  swRegistrieren();
  autoSpeichernInit();
  // Bittet den Browser, den Gerätespeicher nicht eigenmächtig zu löschen
  navigator.storage?.persist?.();

  // Gespeicherte Tafeln automatisch laden (wie Klassenzimmer-Board);
  // PDF-Tabs werden bewusst NICHT automatisch wiederhergestellt (wie
  // im ursprünglichen EduLayer) - PDFs müssen pro Sitzung neu geöffnet
  // und bei Bedarf explizit exportiert werden.
  const tafelnGeladen = tafelnAutoLaden();
  if (!tafelnGeladen) Z.tabs.push(tabErzeugenTafel());
  tabsRendern();
  tabAktivieren(Z.tabs[0].id);

  // Drag & Drop von PDFs direkt auf die Fläche -> neuer PDF-Tab
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f?.type === 'application/pdf') {
      const tab = tabErzeugenPdf(f.name.replace(/\.pdf$/i, ''));
      tabHinzufuegen(tab, true);
      pdfDateiInTab(tab, f);
    }
  });

  // iOS Bounce verhindern
  document.addEventListener('touchmove', e => {
    const ziel = e.target;
    const erlaubt =
      ziel.closest('.zoom-wrapper')       ||
      ziel.closest('.tafel-wrapper')      ||
      ziel.closest('#sidebar')            ||
      ziel.closest('#sidebar-tabs')       ||
      ziel.closest('.spotlight-overlay')  ||
      ziel.closest('.zoom-steuerung')     ||
      ziel.closest('.fokus-toolbar')      ||
      ziel.closest('.einstellungen-panel')||
      ziel.closest('.notizen-panel')      ||
      ziel.closest('.geodreieck-wrapper') ||
      ziel.closest('.lineal-wrapper')     ||
      ziel.closest('.flyout')             ||
      ziel.closest('.widget');
    if (!erlaubt) e.preventDefault();
  }, { passive: false });

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      laserCanvasAnpassen();
      const tab = aktuellerTab();
      if (tab && tab.type === 'pdf') zoomZentrierungAktualisieren();
      if (tab && tab.type === 'tafel') tafelCanvasAufbauen(tab);
      if (Z.geodreieckAktiv) geodreieckSkalieren();
      if (Z.linealAktiv) linealSkalieren();
      if (Z.offenesFlyout === 'stifte') flyoutPositionieren(D.flyoutStifte, D.btnStiftAktiv);
      if (Z.offenesFlyout === 'fokus')  flyoutPositionieren(D.flyoutFokus,  D.btnFokusAktiv);
      if (Z.offenesFlyout === 'widgets') flyoutPositionieren(D.flyoutWidgets, D.btnWidgetMenu);
    }, 350);
  });

  console.log('[EduLayer + Board Fusion] v1.0 bereit.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', appStart);
} else { appStart(); }

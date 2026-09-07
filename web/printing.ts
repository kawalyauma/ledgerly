// @ts-nocheck

export type PrintDocumentOptions = {
  title?: string;
  landscape?: boolean;
  reservedWindow?: Window | null;
};

const UNIVERSAL_PRINT_CSS = `
  <style data-ledgerly-print>
    @page{size:auto;margin:12mm}
    @media print{
      html,body{width:100%!important;min-width:0!important;background:#fff!important}
      .no-print,button,[data-no-print]{display:none!important}
      thead{display:table-header-group}
      tfoot{display:table-footer-group}
      tr,img,.card,.report-card{break-inside:avoid;page-break-inside:avoid}
    }
    *{box-sizing:border-box}
    html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;background:#fff;color:#17201d;font-family:Arial,Helvetica,sans-serif;line-height:1.35}
    img,svg{max-width:100%;height:auto}
    table{width:100%;max-width:100%;border-collapse:collapse;table-layout:auto}
    th,td{overflow-wrap:anywhere;word-break:normal}
    .table-scroll,.table-wrap,.exam-table-wrap{overflow:visible!important;max-height:none!important}
  </style>`;

function normalizeHtml(html: string, title = "Ledgerly print") {
  let output = String(html || "");
  // Legacy print pages in Ledgerly often contain their own automatic print script.
  // The shared service owns printing, so remove only scripts that explicitly invoke print().
  output = output.replace(/<script\b[^>]*>[\s\S]*?(?:window\.)?print\s*\(\s*\)[\s\S]*?<\/script>/gi, "");
  if (!/<html[\s>]/i.test(output)) {
    output = `<!doctype html><html><head><title>${title}</title></head><body>${output}</body></html>`;
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1><meta name="viewport" content="width=device-width,initial-scale=1">`);
  }
  if (!/data-ledgerly-print/i.test(output)) {
    output = output.replace(/<\/head>/i, `${UNIVERSAL_PRINT_CSS}</head>`);
  }
  return output;
}

function waitForImages(doc: Document) {
  const images = [...doc.images].filter(img => !img.complete);
  return Promise.all(images.map(img => new Promise<void>(resolve => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    setTimeout(done, 2500);
  })));
}

async function ready(doc: Document) {
  try {
    if ("fonts" in doc) await Promise.race([(doc as any).fonts.ready, new Promise(r => setTimeout(r, 1200))]);
  } catch {}
  await waitForImages(doc);
}

function cleanupFrame(frame: HTMLIFrameElement | null) {
  if (!frame) return;
  setTimeout(() => frame.remove(), 1000);
}

export function reservePrintWindow(message = "Preparing print preview…") {
  const popup = window.open("about:blank", "_blank");
  if (!popup) return null;
  try { popup.opener = null; } catch {}
  try {
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preparing print</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#334155">${message}</body></html>`);
    popup.document.close();
  } catch {}
  return popup;
}

export function printHtmlDocument(html: string, options: PrintDocumentOptions = {}) {
  const title = options.title || "Ledgerly print";
  const normalized = normalizeHtml(html, title);
  let target = options.reservedWindow || null;
  let frame: HTMLIFrameElement | null = null;

  if (!target || target.closed) {
    frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    frame.style.opacity = "0";
    document.body.appendChild(frame);
    target = frame.contentWindow;
  }

  if (!target) return false;
  const doc = target.document;
  try {
    doc.open();
    doc.write(normalized.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`));
    doc.close();
  } catch {
    cleanupFrame(frame);
    return false;
  }

  void ready(doc).then(() => {
    try {
      target!.focus();
      target!.print();
    } catch {}
    if (frame) cleanupFrame(frame);
    else {
      const close = () => { try { target?.close(); } catch {} };
      try { target.addEventListener("afterprint", close, { once: true }); } catch {}
    }
  });
  return true;
}

export function installLegacyPrintBridge() {
  const nativeOpen = window.open.bind(window);
  if ((window as any).__ledgerlyPrintBridgeInstalled) return;
  (window as any).__ledgerlyPrintBridgeInstalled = true;

  window.open = function(url?: string | URL, target?: string, features?: string) {
    const rawUrl = url == null ? "" : String(url);
    const legacyPrintPopup = rawUrl === "" && (target == null || target === "_blank") && /(?:width|height)\s*=/i.test(features || "");
    if (!legacyPrintPopup) return nativeOpen(url as any, target, features);

    const reserved = nativeOpen("about:blank", "_blank");
    if (reserved) {
      try { reserved.opener = null; } catch {}
    }
    let buffer = "";
    let flushed = false;

    const flush = () => {
      if (flushed) return;
      flushed = true;
      printHtmlDocument(buffer, {
        title: (buffer.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "Ledgerly print").replace(/<[^>]+>/g, ""),
        reservedWindow: reserved,
      });
    };

    const fakeDocument = {
      open() { buffer = ""; flushed = false; return this; },
      write(value: any) { buffer += String(value ?? ""); },
      writeln(value: any) { buffer += `${String(value ?? "")}\n`; },
      close() { flush(); },
    };

    return {
      document: fakeDocument,
      close() { try { reserved?.close(); } catch {} },
      focus() { try { reserved?.focus(); } catch {} },
      print() { flush(); },
      get closed() { return Boolean(reserved?.closed); },
    } as unknown as Window;
  } as typeof window.open;
}

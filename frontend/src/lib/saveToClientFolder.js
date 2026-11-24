import { createElement } from "react";
import { createRoot } from "react-dom/client";
import api from "@/lib/api";
import DocumentPreview from "@/components/DocumentPreview";

const A4_W = 210; // mm
const A4_H = 297; // mm

// Wait until every image inside the node (logo etc.) has loaded, so it is not
// missing from the PDF.
const waitForImages = (node) =>
  Promise.all(
    Array.from(node.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          })
    )
  );

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Draws the document (same DocumentPreview used on screen, with letterhead) in a
 * hidden container and turns it into an A4 PDF Blob. Long documents continue on
 * extra pages.
 */
export async function renderDocumentPdf(doc, company) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-10000px;top:0;width:210mm;background:#fff;";
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    root.render(createElement(DocumentPreview, { doc, company, showHeader: true }));
    // let React commit + layout, then wait for images
    await nextFrame();
    await nextFrame();
    const page = host.firstElementChild;
    if (!page) throw new Error("Document preview did not render");
    await waitForImages(page);

    const canvas = await html2canvas(page, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: page.scrollWidth,
      windowHeight: page.scrollHeight,
    });

    const img = canvas.toDataURL("image/jpeg", 0.95);
    const imgH = (canvas.height * A4_W) / canvas.width; // full height in mm at A4 width
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    // Same image placed on each page, shifted up by one page height every time,
    // so anything taller than A4 simply carries on to the next page.
    const pages = Math.max(1, Math.ceil((imgH - 0.5) / A4_H));
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(img, "JPEG", 0, -i * A4_H, A4_W, imgH);
    }
    return pdf.output("blob");
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * Called right after a bill / quotation / challan is saved: builds its PDF and
 * stores it in that client's folder (sub-folder bill / quotation / challan).
 * Saving the same document again replaces the earlier PDF on the server.
 * Returns the server response ({ file, client_id }).
 */
export async function saveDocumentToClientFolder(doc, company) {
  const blob = await renderDocumentPdf(doc, company);
  const form = new FormData();
  form.append("file", blob, "document.pdf");
  const { data } = await api.post(`/documents/${doc.id}/file`, form);
  return data;
}
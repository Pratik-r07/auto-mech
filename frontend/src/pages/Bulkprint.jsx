import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import DocumentPreview from "@/components/DocumentPreview";
import { Button } from "@/components/ui/button";
import { DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function BulkPrint() {
  const { docType } = useParams();
  const [searchParams] = useSearchParams();
  const ids = (searchParams.get("ids") || "").split(",").filter(Boolean);

  const [company, setCompany] = useState({});
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [companyRes, ...docRes] = await Promise.all([
        api.get("/company"),
        ...ids.map((id) => api.get(`/documents/${id}`)),
      ]);
      if (cancelled) return;
      setCompany(companyRes.data);
      setDocs(docRes.map((r) => r.data));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, []);

  const downloadPdf = async () => {
    if (!containerRef.current || docs.length === 0) return;
    setGenerating(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      // Capture only the actual 210mm document (first child of each wrapper),
      // not the centering/padding wrapper around it — otherwise the blank
      // margin gets baked into the image and the real content ends up
      // squished and offset once stretched to fill the PDF page.
      const pages = containerRef.current.querySelectorAll(".bulk-print-doc > div");
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          windowWidth: pages[i].scrollWidth,
          windowHeight: pages[i].scrollHeight,
        });
        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        if (i > 0) pdf.addPage();
        // A4 is 210 x 297mm. Fit the image to the full page width and scale
        // height proportionally so nothing is stretched out of aspect ratio;
        // cap at 297mm in case content runs slightly long.
        const pageWidth = 210;
        const pageHeight = Math.min((canvas.height * pageWidth) / canvas.width, 297);
        pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight);
      }

      const filename = `${docType}s-${docs.map((d) => d.number).join("_")}.pdf`;
      pdf.save(filename);
    } catch (err) {
      toast.error("Could not generate PDF: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-sm">Loading {ids.length} document(s)…</div>;
  }

  return (
    <div>
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 p-4 flex items-center justify-between">
        <div className="text-sm text-slate-600">
          {docs.length} document{docs.length === 1 ? "" : "s"} selected
        </div>
        <Button onClick={downloadPdf} disabled={generating} className="bg-orange-600 hover:bg-orange-700 text-white rounded-md">
          <DownloadSimple size={16} weight="bold" className="mr-2" />
          {generating ? "Generating…" : "Download PDF"}
        </Button>
      </div>

      <div ref={containerRef} className="bg-slate-100">
        {docs.map((doc) => (
          <div key={doc.id} className="bulk-print-doc flex justify-center py-6">
            <DocumentPreview doc={doc} company={company} showHeader={true} />
          </div>
        ))}
      </div>
    </div>
  );
}
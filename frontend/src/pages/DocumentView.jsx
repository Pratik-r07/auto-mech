import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import DocumentPreview from "@/components/DocumentPreview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Printer, PencilSimple, ArrowLeft, Truck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { docFileName } from "@/lib/pdfName";

export default function DocumentView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [company, setCompany] = useState({});
  const [showHeader, setShowHeader] = useState(true);

  useEffect(() => {
    api.get(`/documents/${id}`).then((r) => setDoc(r.data));
    api.get("/company").then((r) => setCompany(r.data));
  }, [id]);

  // Browsers use the page title as the default file name in "Save as PDF",
  // so set it to "<Client>_<Type>_<Number>" while this document is open.
  useEffect(() => {
    if (!doc) return undefined;
    const previousTitle = document.title;
    document.title = docFileName(doc);
    return () => {
      document.title = previousTitle;
    };
  }, [doc]);

  if (!doc)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="h-8 w-8 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-200">
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={16} weight="bold" /> Back
        </button>
        <div className="flex items-center gap-4">
          <label
            className="flex items-center gap-2 text-sm text-slate-700 select-none cursor-pointer"
            data-testid="print-with-header-toggle"
          >
            <Checkbox
              checked={showHeader}
              onCheckedChange={(v) => setShowHeader(!!v)}
              data-testid="print-with-header-checkbox"
            />
            <span>Print with letterhead</span>
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              (uncheck if using pre-printed letterhead paper)
            </span>
          </label>
          <Button
            data-testid="edit-doc-button"
            onClick={() => navigate(`/edit/${id}`)}
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md"
          >
            <PencilSimple size={16} weight="bold" className="mr-2" /> Edit
          </Button>
          {doc.doc_type === "bill" && (
            <Button
              data-testid="view-to-challan-button"
              onClick={async () => {
                try {
                  const { data } = await api.post(`/documents/${id}/to_challan`);
                  toast.success(`Challan ${data.number} created`);
                  navigate(`/edit/${data.id}`);
                } catch (e) {
                  toast.error(e.response?.data?.detail || e.message);
                }
              }}
              variant="outline"
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-md"
            >
              <Truck size={16} weight="bold" className="mr-2" /> Create Challan
            </Button>
          )}
          <Button
            data-testid="print-button"
            onClick={() => window.print()}
            className="bg-orange-600 hover:bg-orange-700 text-white rounded-md"
          >
            <Printer size={16} weight="bold" className="mr-2" /> Print / Save PDF
          </Button>
        </div>
      </div>

      <div className="py-8 px-4 flex justify-center overflow-x-auto">
        <div className="doc-view-zoom">
          <DocumentPreview doc={doc} company={company} showHeader={showHeader} />
        </div>
      </div>
    </div>
  );
}
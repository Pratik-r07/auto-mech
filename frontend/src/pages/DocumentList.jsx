import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Eye, PencilSimple, Trash, ArrowsClockwise, FileText, Receipt, MagnifyingGlass, Truck } from "@phosphor-icons/react";
import { toast } from "sonner";

const money = (n) =>
  "₹ " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DocumentList({ docType }) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const isBill = docType === "bill";
  const isChallan = docType === "challan";
  const title = isBill ? "Bills / Invoices" : isChallan ? "Delivery Challans" : "Quotations";
  const singular = isBill ? "Bill" : isChallan ? "Challan" : "Quotation";

  const load = () => api.get(`/documents?doc_type=${docType}`).then((r) => setDocs(r.data));
  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [docType]);

  const remove = async () => {
    await api.delete(`/documents/${toDelete}`);
    setToDelete(null);
    toast.success("Deleted");
    load();
  };

  const convert = async (id) => {
    const { data } = await api.post(`/documents/${id}/convert`);
    toast.success("Converted to bill");
    navigate(`/edit/${data.id}`);
  };

  const toChallan = async (id) => {
    const { data } = await api.post(`/documents/${id}/to_challan`);
    toast.success(`Delivery Challan ${data.number} created`);
    navigate(`/edit/${data.id}`);
  };

  const filtered = docs.filter(
    (d) =>
      d.number?.toLowerCase().includes(search.toLowerCase()) ||
      d.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Documents</p>
          <h1 className="font-head text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 mt-1 flex items-center gap-3">
            {isBill ? <Receipt size={30} weight="duotone" className="text-orange-600" /> : isChallan ? <Truck size={30} weight="duotone" className="text-orange-600" /> : <FileText size={30} weight="duotone" className="text-orange-600" />}
            {title}
          </h1>
        </div>
        <Button
          data-testid="create-document-button"
          onClick={() => navigate(`/new/${docType}`)}
          className="bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors duration-150"
        >
          <Plus size={16} weight="bold" className="mr-2" /> New {singular}
        </Button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          data-testid="search-input"
          placeholder="Search by number or customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10 border-slate-300 focus:ring-2 focus:ring-orange-500"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto shadow-sm">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            No {isBill ? "bills" : isChallan ? "challans" : "quotations"} found. Create one to get started.
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {(isChallan ? ["Number", "Customer", "Date", "PO No.", ""] : ["Number", "Customer", "Date", "Amount", ""]).map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  data-testid={`doc-row-${d.id}`}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors duration-150"
                >
                  <td className="px-4 py-3 font-mono-num font-semibold text-slate-900">{d.number}</td>
                  <td className="px-4 py-3 text-slate-700">{d.customer_name || "—"}</td>
                  <td className="px-4 py-3 font-mono-num text-slate-600">{d.date}</td>
                  <td className="px-4 py-3 font-mono-num font-semibold text-slate-900">{isChallan ? (d.po_number || "—") : money(d.grand_total)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="View / Print"
                        data-testid={`view-${d.id}`}
                        onClick={() => navigate(`/view/${d.id}`)}
                        className="p-2 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
                      >
                        <Eye size={16} weight="bold" />
                      </button>
                      <button
                        title="Edit"
                        data-testid={`edit-${d.id}`}
                        onClick={() => navigate(`/edit/${d.id}`)}
                        className="p-2 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
                      >
                        <PencilSimple size={16} weight="bold" />
                      </button>
                      {!isBill && !isChallan && (
                        <button
                          title="Convert to Bill"
                          data-testid={`convert-${d.id}`}
                          onClick={() => convert(d.id)}
                          className="p-2 rounded hover:bg-orange-50 text-slate-500 hover:text-orange-600 transition-colors"
                        >
                          <ArrowsClockwise size={16} weight="bold" />
                        </button>
                      )}
                      {isBill && (
                        <button
                          title="Create Delivery Challan"
                          data-testid={`to-challan-${d.id}`}
                          onClick={() => toChallan(d.id)}
                          className="p-2 rounded hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 transition-colors"
                        >
                          <Truck size={16} weight="bold" />
                        </button>
                      )}
                      <button
                        title="Delete"
                        data-testid={`delete-${d.id}`}
                        onClick={() => setToDelete(d.id)}
                        className="p-2 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                      >
                        <Trash size={16} weight="bold" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-delete-button"
              onClick={remove}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

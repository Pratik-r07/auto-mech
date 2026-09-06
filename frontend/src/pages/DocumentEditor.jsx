import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import DocumentPreview from "@/components/DocumentPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, Trash, FloppyDisk, ArrowLeft, CaretDown } from "@phosphor-icons/react";
import { toast } from "sonner";

const DEFAULT_TERMS = {
  payment: "After delivery.",
  taxes: "GST @ 18% as applicable.",
  delivery: "Within two weeks.",
  freight: "Extra to your account.",
  guarantee: "To your satisfaction.",
};

const blank = (docType) => ({
  doc_type: docType || "quotation",
  number: "",
  date: "",
  po_number: "",
  po_date: "",
  challan_number: "",
  challan_date: "",
  invoice_number: "",
  invoice_date: "",
  subject: "",
  intro: "",
  closing: "",
  customer_name: "",
  customer_address: "",
  customer_gstin: "",
  customer_attention: "",
  items: [{ description: "", hsn: "", qty: 1, unit: "Nos", rate: 0 }],
  gst_type: "cgst_sgst",
  gst_rate: 18,
  discount_percent: 0,
  terms: docType === "challan" ? {} : DEFAULT_TERMS,
  notes: "",
  status: "draft",
});

export default function DocumentEditor() {
  const { id, docType } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(blank(docType));
  const [company, setCompany] = useState({});
  const [clients, setClients] = useState([]);
  const [saving, setSaving] = useState(false);
  const editing = !!id;
  const isBill = doc.doc_type === "bill";
  const isChallan = doc.doc_type === "challan";
  const isQuotation = doc.doc_type === "quotation";

  useEffect(() => {
    api.get("/company").then((r) => setCompany(r.data));
    api.get("/clients").then((r) => setClients(r.data));
    if (id) {
      api.get(`/documents/${id}`).then((r) => setDoc(r.data));
    } else if (docType !== "challan") {
      api.get("/company").then((r) => {
        const t = r.data.default_terms && Object.keys(r.data.default_terms).length ? r.data.default_terms : DEFAULT_TERMS;
        setDoc((d) => ({ ...d, terms: t }));
      });
    }
  }, [id, docType]);

  const set = useCallback((k, v) => setDoc((d) => ({ ...d, [k]: v })), []);
  const setItem = (i, k, v) =>
    setDoc((d) => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const addItem = () =>
    setDoc((d) => ({
      ...d,
      items: [...d.items, { description: "", hsn: "", qty: 1, unit: "Nos", rate: 0 }],
    }));
  const removeItem = (i) => setDoc((d) => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }));
  const setTerm = (k, v) => setDoc((d) => ({ ...d, terms: { ...d.terms, [k]: v } }));

  const pickClient = (clientId) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    setDoc((d) => ({
      ...d,
      customer_name: c.name,
      customer_address: c.address,
      customer_gstin: c.gstin,
      customer_attention: c.attention,
    }));
  };

  const save = async (thenView) => {
    if (!doc.customer_name.trim()) {
      toast.error("Customer name is required");
      return;
    }
    setSaving(true);
    try {
      let result;
      if (editing) {
        result = (await api.put(`/documents/${id}`, doc)).data;
      } else {
        result = (await api.post("/documents", doc)).data;
      }
      toast.success("Saved");
      if (thenView) navigate(`/view/${result.id}`);
      else navigate(isBill ? "/bills" : isChallan ? "/challans" : "/quotations");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const heading = isBill ? "Bill / Invoice" : isChallan ? "Delivery Challan" : "Quotation";

  return (
    <div className="flex flex-col lg:flex-row min-h-screen">
      {/* FORM */}
      <div className="lg:w-[46%] xl:w-[42%] border-r border-slate-200 bg-white p-6 overflow-y-auto no-print">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4 transition-colors"
        >
          <ArrowLeft size={16} weight="bold" /> Back
        </button>
        <h1 className="font-head text-2xl font-black tracking-tight text-slate-900 mb-6">
          {editing ? "Edit" : "New"} {heading}
        </h1>

        {/* Customer */}
        <Section title="Customer">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">Details</Label>
            {clients.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button data-testid="pick-client-button" className="text-xs text-orange-600 font-semibold flex items-center gap-1 hover:underline">
                    Pick client <CaretDown size={12} weight="bold" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-1" align="end">
                  {clients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => pickClient(c.id)}
                      className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100 transition-colors"
                    >
                      {c.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
          <Field label="Name" value={doc.customer_name} onChange={(v) => set("customer_name", v)} testid="customer-name-input" />
          <FieldArea label="Address" value={doc.customer_address} onChange={(v) => set("customer_address", v)} testid="customer-address-input" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Party GST No." value={doc.customer_gstin} onChange={(v) => set("customer_gstin", v)} testid="customer-gstin-input" />
            <Field label="Kind Attn" value={doc.customer_attention} onChange={(v) => set("customer_attention", v)} testid="customer-attention-input" />
          </div>
        </Section>

        {/* Subject & Intro – quotation letter format only */}
        {isQuotation && (
          <Section title="Letter Details">
            <Field label="Subject" value={doc.subject} onChange={(v) => set("subject", v)} placeholder="e.g. Quotation for Filling Nozzle Auto Line" testid="subject-input" />
            <FieldArea label="Intro paragraph (optional)" value={doc.intro} onChange={(v) => set("intro", v)} testid="intro-input" />
            <FieldArea label="Closing paragraph (optional)" value={doc.closing} onChange={(v) => set("closing", v)} testid="closing-input" />
          </Section>
        )}

        {/* Meta */}
        <Section title="Document Info">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={isChallan ? "Challan No." : "Number (auto)"}
              value={doc.number}
              onChange={(v) => set("number", v)}
              placeholder={isChallan ? "Leave blank for auto" : "Auto-generated"}
              testid="number-input"
            />
            <Field label="Date" value={doc.date} onChange={(v) => set("date", v)} placeholder="dd/mm/yyyy" testid="date-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="P.O. No." value={doc.po_number} onChange={(v) => set("po_number", v)} testid="po-number-input" />
            <Field label="P.O. Date" value={doc.po_date} onChange={(v) => set("po_date", v)} placeholder="dd/mm/yyyy" testid="po-date-input" />
          </div>
          {isBill && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Challan No." value={doc.challan_number} onChange={(v) => set("challan_number", v)} testid="challan-number-input" />
              <Field label="Challan Date" value={doc.challan_date} onChange={(v) => set("challan_date", v)} placeholder="dd/mm/yyyy" testid="challan-date-input" />
            </div>
          )}
          {isChallan && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice No." value={doc.invoice_number} onChange={(v) => set("invoice_number", v)} testid="invoice-number-input" />
              <Field label="Invoice Date" value={doc.invoice_date} onChange={(v) => set("invoice_date", v)} placeholder="dd/mm/yyyy" testid="invoice-date-input" />
            </div>
          )}
        </Section>

        {/* Items */}
        <Section title="Line Items">
          <div className="space-y-3">
            {doc.items.map((it, i) => (
              <div key={i} className="border border-slate-200 rounded-md p-3 bg-slate-50" data-testid={`item-row-${i}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400">#{i + 1}</span>
                  <button
                    onClick={() => removeItem(i)}
                    data-testid={`remove-item-${i}`}
                    className="text-slate-400 hover:text-red-600 transition-colors"
                  >
                    <Trash size={15} weight="bold" />
                  </button>
                </div>
                <Textarea
                  data-testid={`item-desc-${i}`}
                  value={it.description}
                  onChange={(e) => setItem(i, "description", e.target.value)}
                  placeholder="Item description"
                  className="mb-2 border-slate-300 focus:ring-2 focus:ring-orange-500 min-h-[44px] text-sm"
                />
                {isChallan ? (
                  <div className="grid grid-cols-2 gap-2">
                    <MiniField label="Qty" type="number" value={it.qty} onChange={(v) => setItem(i, "qty", v)} testid={`item-qty-${i}`} />
                    <MiniField label="Unit" value={it.unit} onChange={(v) => setItem(i, "unit", v)} testid={`item-unit-${i}`} />
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    <MiniField label="HSN Code" value={it.hsn} onChange={(v) => setItem(i, "hsn", v)} testid={`item-hsn-${i}`} />
                    <MiniField label="Qty" type="number" value={it.qty} onChange={(v) => setItem(i, "qty", v)} testid={`item-qty-${i}`} />
                    <MiniField label="Unit" value={it.unit} onChange={(v) => setItem(i, "unit", v)} testid={`item-unit-${i}`} />
                    <MiniField label="Rate" type="number" value={it.rate} onChange={(v) => setItem(i, "rate", v)} testid={`item-rate-${i}`} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button
            onClick={addItem}
            data-testid="add-item-button"
            variant="outline"
            className="mt-3 w-full border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 rounded-md"
          >
            <Plus size={16} weight="bold" className="mr-2" /> Add Item
          </Button>
        </Section>

        {/* Tax + Discount – hidden for challan */}
        {!isChallan && (
          <Section title="Tax & Discount">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">GST Type</Label>
                <Select value={doc.gst_type} onValueChange={(v) => set("gst_type", v)}>
                  <SelectTrigger data-testid="gst-type-select" className="border-slate-300 focus:ring-2 focus:ring-orange-500">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cgst_sgst">CGST + SGST (intra-state)</SelectItem>
                    <SelectItem value="igst">IGST (inter-state)</SelectItem>
                    <SelectItem value="none">No Tax</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <MiniField label="GST Rate %" type="number" value={doc.gst_rate} onChange={(v) => set("gst_rate", v)} testid="gst-rate-input" />
            </div>
            <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
              <Label className="text-xs font-bold uppercase tracking-wider text-orange-700 mb-1.5 block">
                Discount %
              </Label>
              <Input
                data-testid="discount-percent-input"
                type="number"
                value={doc.discount_percent ?? 0}
                onChange={(e) => set("discount_percent", e.target.value)}
                placeholder="0"
                className="h-10 border-orange-300 focus:ring-2 focus:ring-orange-500 font-mono-num"
              />
              <p className="text-[11px] text-orange-700/80 mt-1">
                Applied on the total amount before GST (e.g. 10 = 10%). Shows as "Less: Discount" on the bill.
              </p>
            </div>
          </Section>
        )}

        {/* Terms – quotation letter format only; bill uses fixed legal terms, challan has none */}
        {isQuotation && (
          <Section title="Terms & Conditions">
            {["payment", "taxes", "delivery", "freight", "guarantee"].map((k) => (
              <Field key={k} label={k} value={doc.terms?.[k] || ""} onChange={(v) => setTerm(k, v)} testid={`term-${k}`} />
            ))}
          </Section>
        )}

        <div className="flex gap-3 mt-6 pb-8">
          <Button onClick={() => save(false)} disabled={saving} data-testid="save-button" className="flex-1 bg-orange-600 hover:bg-orange-700 text-white rounded-md">
            <FloppyDisk size={16} weight="bold" className="mr-2" /> {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={() => save(true)} disabled={saving} data-testid="save-view-button" variant="outline" className="flex-1 border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md">
            Save & Preview
          </Button>
        </div>
      </div>

      {/* PREVIEW */}
      <div className="flex-1 bg-slate-100 p-4 sm:p-6 overflow-x-auto no-print">
        <div className="doc-zoom mx-auto" style={{ width: "210mm" }}>
          <DocumentPreview doc={doc} company={company} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h3 className="font-head text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-1.5 mb-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, testid }) {
  return (
    <div>
      <Label className="text-xs font-medium text-slate-500 mb-1 block capitalize">{label}</Label>
      <Input data-testid={testid} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-10 border-slate-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500" />
    </div>
  );
}

function FieldArea({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="text-xs font-medium text-slate-500 mb-1 block">{label}</Label>
      <Textarea data-testid={testid} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        className="border-slate-300 focus:ring-2 focus:ring-orange-500 min-h-[60px] text-sm" />
    </div>
  );
}

function MiniField({ label, value, onChange, type = "text", testid }) {
  return (
    <div>
      <Label className="text-[10px] font-medium text-slate-400 mb-1 block">{label}</Label>
      <Input data-testid={testid} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        className="h-9 border-slate-300 focus:ring-2 focus:ring-orange-500 font-mono-num text-sm" />
    </div>
  );
}
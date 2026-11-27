import { Fragment, useEffect, useRef, useState, useCallback } from "react";
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
import { Plus, Trash, FloppyDisk, ArrowLeft, CaretDown, DotsSixVertical, TextT } from "@phosphor-icons/react";
import { toast } from "sonner";

const DEFAULT_TERMS = {
  payment: "After delivery.",
  taxes: "GST @ 18% as applicable.",
  delivery: "Within two weeks.",
  freight: "Extra to your account.",
  guarantee: "To your satisfaction.",
};

// Rows can be normal items or section headers. Each row gets a temporary "uid" so React keeps
// the right row when rows are moved around (the server ignores it).
let uidCounter = 0;
const newUid = () => `r${Date.now().toString(36)}${(uidCounter += 1)}`;
const blankItem = () => ({ uid: newUid(), kind: "item", description: "", hsn: "", qty: 1, unit: "Nos", rate: 0 });
const blankHeader = () => ({ uid: newUid(), kind: "header", description: "", hsn: "", qty: 0, unit: "", rate: 0 });
const withUids = (items) => (items || []).map((it) => ({ ...it, kind: it.kind || "item", uid: it.uid || newUid() }));

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
  items: [blankItem()],
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
  const [catalog, setCatalog] = useState([]);
  const [openSuggestFor, setOpenSuggestFor] = useState(null);
  const [drag, setDrag] = useState(null); // while dragging a row: { from, to, dy }
  const dragRef = useRef(null);
  const listRef = useRef(null);
  const editing = !!id;
  const isBill = doc.doc_type === "bill";
  const isChallan = doc.doc_type === "challan";
  const isQuotation = doc.doc_type === "quotation";

  useEffect(() => {
    api.get("/company").then((r) => setCompany(r.data));
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/items").then((r) => setCatalog(r.data)).catch(() => {});
    if (id) {
      api.get(`/documents/${id}`).then((r) => setDoc({ ...r.data, items: withUids(r.data.items) }));
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
  const selectCatalogItem = (i, catItem) => {
    setDoc((d) => ({
      ...d,
      items: d.items.map((it, idx) =>
        idx === i
          ? { ...it, description: catItem.description, hsn: catItem.hsn || it.hsn, unit: catItem.unit || it.unit, rate: catItem.rate || it.rate }
          : it
      ),
    }));
    setOpenSuggestFor(null);
  };
  // Insert a new item or section header at position `index` (default: the end)
  const insertRow = (kind, index) => {
    setOpenSuggestFor(null);
    setDoc((d) => {
      const at = index === undefined ? d.items.length : index;
      const items = [...d.items];
      items.splice(at, 0, kind === "header" ? blankHeader() : blankItem());
      return { ...d, items };
    });
  };
  const removeItem = (i) => setDoc((d) => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }));
  // Move the row at position `from` so that it ends up at position `to`
  const moveItem = (from, to) => {
    setOpenSuggestFor(null);
    setDoc((d) => {
      const target = Math.max(0, Math.min(d.items.length - 1, to));
      if (from === target || from < 0 || from >= d.items.length) return d;
      const items = [...d.items];
      const [row] = items.splice(from, 1);
      items.splice(target, 0, row);
      return { ...d, items };
    });
  };

  /* ---- Drag a row up or down by its handle (works with mouse AND finger) ----
     The row follows the pointer; nothing moves in the list until you let go, so the drag
     never gets interrupted. The orange line shows where the row will land. */
  const rowCards = () => Array.from(listRef.current?.querySelectorAll("[data-item-card]") || []);
  const scrollerOf = (node) => {
    for (let n = node && node.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = window.getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return null; // the whole page scrolls
  };
  const updateDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    const cards = rowCards();
    const el = cards[d.from];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const restingTop = rect.top - d.dy;                 // where the row sits without the drag offset
    const dy = d.pointerY - d.grab - restingTop;
    d.dy = dy;
    const centre = d.pointerY - d.grab + rect.height / 2;
    let to = 0;
    cards.forEach((c, idx) => {
      if (idx === d.from) return;
      const r = c.getBoundingClientRect();
      if (r.top + r.height / 2 < centre) to += 1;
    });
    d.to = to;
    setDrag({ from: d.from, to, dy });
  };
  const dragLoop = () => {
    // scroll the page/pane when the row is held near its top or bottom edge
    const d = dragRef.current;
    if (!d) return;
    const area = d.scroller ? d.scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const edge = 70;
    const max = 18;
    let v = 0;
    if (d.pointerY < area.top + edge) v = -max * (1 - Math.max(0, d.pointerY - area.top) / edge);
    else if (d.pointerY > area.bottom - edge) v = max * (1 - Math.max(0, area.bottom - d.pointerY) / edge);
    if (v) {
      if (d.scroller) d.scroller.scrollTop += v;
      else window.scrollBy(0, v);
      updateDrag();
    }
    d.raf = requestAnimationFrame(dragLoop);
  };
  const startDrag = (e, i) => {
    if (e.button !== undefined && e.button !== 0) return;
    const el = rowCards()[i];
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      from: i, to: i, dy: 0, pointerY: e.clientY,
      grab: e.clientY - el.getBoundingClientRect().top,
      scroller: scrollerOf(listRef.current), raf: 0,
    };
    setOpenSuggestFor(null);
    setDrag({ from: i, to: i, dy: 0 });
    dragRef.current.raf = requestAnimationFrame(dragLoop);
  };
  const moveDrag = (e) => {
    if (!dragRef.current) return;
    dragRef.current.pointerY = e.clientY;
    updateDrag();
  };
  const endDrag = (commit) => {
    const d = dragRef.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    dragRef.current = null;
    setDrag(null);
    if (commit && d.to !== d.from) moveItem(d.from, d.to);
  };
  useEffect(() => () => dragRef.current && cancelAnimationFrame(dragRef.current.raf), []);
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
      // drop empty section headers and the temporary row ids before saving
      const payload = {
        ...doc,
        items: doc.items
          .filter((it) => it.kind !== "header" || (it.description || "").trim())
          .map(({ uid, ...rest }) => rest),
      };
      let result;
      if (editing) {
        result = (await api.put(`/documents/${id}`, payload)).data;
      } else {
        result = (await api.post("/documents", payload)).data;
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

  // serial numbers only count real items, never section headers
  let serialCount = 0;
  const rowNumbers = doc.items.map((it) => (it.kind === "header" ? null : (serialCount += 1)));

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
            {!isQuotation && (
              <Field label="Party GST No." value={doc.customer_gstin} onChange={(v) => set("customer_gstin", v)} testid="customer-gstin-input" />
            )}
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
              label={isChallan ? "Challan No." : isQuotation ? "REF No." : "Number (auto)"}
              value={doc.number}
              onChange={(v) => set("number", v)}
              placeholder={isChallan ? "Leave blank for auto" : isQuotation ? "e.g. AMSS/25-26/012" : "Auto-generated"}
              testid="number-input"
            />
            <Field label="Date" value={doc.date} onChange={(v) => set("date", v)} placeholder="dd/mm/yyyy" testid="date-input" />
          </div>
          {!isQuotation && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="P.O. No." value={doc.po_number} onChange={(v) => set("po_number", v)} testid="po-number-input" />
              <Field label="P.O. Date" value={doc.po_date} onChange={(v) => set("po_date", v)} placeholder="dd/mm/yyyy" testid="po-date-input" />
            </div>
          )}
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
          <p className="text-xs text-slate-500 mb-3">
            Drag the <DotsSixVertical size={12} weight="bold" className="inline -mt-0.5" /> handle up or down to reorder rows.
            Use <b>+ Header</b> to add a section heading anywhere.
          </p>
          <div ref={listRef}>
            <InsertBar index={0} onItem={() => insertRow("item", 0)} onHeader={() => insertRow("header", 0)} />
            {doc.items.map((it, i) => {
              const isHeader = it.kind === "header";
              const last = i === doc.items.length - 1;
              return (
                <Fragment key={it.uid || i}>
                  <div
                    data-item-card
                    data-testid={`item-row-${i}`}
                    style={drag && drag.from === i ? { transform: `translateY(${drag.dy}px)`, transition: "none" } : undefined}
                    className={`border rounded-md p-3 ${drag ? "" : "transition-colors"} ${
                      isHeader ? "border-orange-200 bg-orange-50" : "border-slate-200 bg-slate-50"
                    } ${drag && drag.from === i ? "relative z-20 shadow-xl ring-2 ring-orange-400 opacity-95" : ""} ${
                      drag && drag.from !== i && drag.to !== drag.from && drag.to === i
                        ? drag.to > drag.from
                          ? "shadow-[0_4px_0_0_#f97316]"   // row will land just below this one
                          : "shadow-[0_-4px_0_0_#f97316]"  // row will land just above this one
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          data-testid={`drag-handle-${i}`}
                          title="Drag up or down to move"
                          onPointerDown={(e) => startDrag(e, i)}
                          onPointerMove={moveDrag}
                          onPointerUp={() => endDrag(true)}
                          onPointerCancel={() => endDrag(false)}
                          style={{ touchAction: "none" }}
                          className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 p-1.5 -m-1 select-none"
                        >
                          <DotsSixVertical size={20} weight="bold" />
                        </span>
                        {isHeader ? (
                          <span className="text-xs font-bold uppercase tracking-wider text-orange-700 flex items-center gap-1">
                            <TextT size={13} weight="bold" /> Section header
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-slate-400">#{rowNumbers[i]}</span>
                        )}
                      </div>
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          data-testid={`remove-item-${i}`}
                          title="Delete row"
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-white transition-colors"
                        >
                          <Trash size={15} weight="bold" />
                        </button>
                      </div>
                    </div>

                    {isHeader ? (
                      <Input
                        data-testid={`header-text-${i}`}
                        value={it.description}
                        onChange={(e) => setItem(i, "description", e.target.value)}
                        placeholder="Heading text, e.g. Spares for Filling Machine"
                        className="border-orange-300 bg-white font-semibold focus:ring-2 focus:ring-orange-500"
                      />
                    ) : (
                      <>
                        <div className="relative mb-2">
                          <Textarea
                            data-testid={`item-desc-${i}`}
                            value={it.description}
                            onChange={(e) => setItem(i, "description", e.target.value)}
                            onFocus={() => setOpenSuggestFor(i)}
                            onBlur={() => setTimeout(() => setOpenSuggestFor((cur) => (cur === i ? null : cur)), 150)}
                            placeholder="Item description"
                            className="border-slate-300 focus:ring-2 focus:ring-orange-500 min-h-[44px] text-sm"
                          />
                          {openSuggestFor === i && it.description && (() => {
                            const q = it.description.trim().toLowerCase();
                            const matches = catalog
                              .filter((c) => c.description.toLowerCase().includes(q) && c.description.toLowerCase() !== q)
                              .slice(0, 6);
                            if (matches.length === 0) return null;
                            return (
                              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto">
                                {matches.map((m, mi) => (
                                  <button
                                    key={mi}
                                    type="button"
                                    data-testid={`item-suggestion-${i}-${mi}`}
                                    onMouseDown={(e) => { e.preventDefault(); selectCatalogItem(i, m); }}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate">{m.description}</span>
                                    <span className="text-xs text-slate-400 shrink-0">₹{m.rate}</span>
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
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
                      </>
                    )}
                  </div>
                  <InsertBar index={i + 1} onItem={() => insertRow("item", i + 1)} onHeader={() => insertRow("header", i + 1)} />
                </Fragment>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Button
              onClick={() => insertRow("item")}
              data-testid="add-item-button"
              variant="outline"
              className="border-dashed border-slate-300 text-slate-600 hover:bg-slate-50 rounded-md"
            >
              <Plus size={16} weight="bold" className="mr-2" /> Add Item
            </Button>
            <Button
              onClick={() => insertRow("header")}
              data-testid="add-header-button"
              variant="outline"
              className="border-dashed border-orange-300 text-orange-700 hover:bg-orange-50 rounded-md"
            >
              <TextT size={16} weight="bold" className="mr-2" /> Add Header
            </Button>
          </div>
        </Section>

        {/* Tax + Discount – hidden for challan; quotation only gets Discount (GST is stated in its own Terms section) */}
        {!isChallan && (
          <Section title={isQuotation ? "Discount" : "Tax & Discount"}>
            {!isQuotation && (
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
            )}
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

function InsertBar({ index, onItem, onHeader }) {
  return (
    <div className="flex items-center gap-2 py-1 group" data-testid={`insert-bar-${index}`}>
      <div className="flex-1 border-t border-dashed border-slate-200 group-hover:border-orange-300" />
      <button type="button" onClick={onItem} data-testid={`insert-item-${index}`} className="text-[11px] font-semibold text-slate-400 hover:text-orange-700">+ Item</button>
      <button type="button" onClick={onHeader} data-testid={`insert-header-${index}`} className="text-[11px] font-semibold text-slate-400 hover:text-orange-700">+ Header</button>
      <div className="flex-1 border-t border-dashed border-slate-200 group-hover:border-orange-300" />
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
import { numberToWordsINR } from "@/lib/numberToWords";

const money = (n) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function computeTotals(doc) {
  const gross = (doc.items || []).reduce(
    (s, it) => (it.kind === "header" ? s : s + Number(it.qty || 0) * Number(it.rate || 0)),
    0
  );
  const discPct = Number(doc.discount_percent || 0);
  const discount = (gross * discPct) / 100;
  const subtotal = gross - discount;
  const rate = Number(doc.gst_rate || 0);
  let cgst = 0, sgst = 0, igst = 0;
  if (doc.gst_type === "cgst_sgst") {
    cgst = (subtotal * (rate / 2)) / 100;
    sgst = (subtotal * (rate / 2)) / 100;
  } else if (doc.gst_type === "igst") {
    igst = (subtotal * rate) / 100;
  }
  const total_tax = cgst + sgst + igst;
  return {
    gross, discount, subtotal, cgst, sgst, igst, total_tax,
    grand_total: subtotal + total_tax,
  };
}

// Split amount into rupees / paise columns
const split = (n) => {
  const [r, p = "00"] = Number(n || 0).toFixed(2).split(".");
  const rupees = Number(r).toLocaleString("en-IN");
  return { rupees, paise: p };
};

export default function DocumentPreview({ doc, company, showHeader = true }) {
  const t = computeTotals(doc);
  const isBill = doc.doc_type === "bill";
  const isChallan = doc.doc_type === "challan";
  const isQuotation = doc.doc_type === "quotation";
  const title = isBill ? "INVOICE" : isChallan ? "DELIVERY CHALLAN" : "QUOTATION";
  const rate = Number(doc.gst_rate || 0);

  const items = doc.items || [];
  // Section headers are not numbered: serial numbers only count real items
  let serial = 0;
  const numbered = items.map((it) => (it.kind === "header" ? { ...it, serial: 0 } : { ...it, serial: ++serial }));
  // Pad to at least 8 rows for consistent height
  const minRows = 10;
  const padded = [...numbered, ...Array.from({ length: Math.max(0, minRows - numbered.length) }, () => null)];

  return (
    <div
      id="print-area"
      data-testid="document-preview"
      className="bg-white text-slate-900 mx-auto"
      style={{ width: "210mm", minHeight: "297mm", padding: "10mm", fontFamily: "'Times New Roman', 'Liberation Serif', serif" }}
    >
      {/* Letterhead */}
      {showHeader && (
        <div className="pb-2">
          <div className="flex items-center gap-3 border-b-2 border-[#d9645b] pb-3">
            <div className="flex-1 text-center">
              <div
                className="italic font-black inline-block"
                style={{
                  fontFamily: "'Playfair Display', 'Times New Roman', serif",
                  color: "#d9645b",
                  fontSize: "40px",
                  lineHeight: 1,
                  textDecoration: "underline wavy #d9645b",
                  textDecorationThickness: "1.5px",
                  textUnderlineOffset: "8px",
                }}
              >
                {company?.name || "Auto~Mech Spares & Service"}
              </div>
              {company?.tagline ? (
                <div
                  className="italic font-bold mt-3"
                  style={{ fontFamily: "'Playfair Display', serif", color: "#3f6cae", fontSize: "13px" }}
                >
                  {company.tagline}
                </div>
              ) : null}
              {company?.address ? (
                <div
                  className="italic font-bold whitespace-pre-line leading-snug mt-0.5"
                  style={{ fontFamily: "'Playfair Display', serif", color: "#d9645b", fontSize: "12.5px" }}
                >
                  {company.address}
                </div>
              ) : null}
              {company?.email ? (
                <div
                  className="italic font-bold underline mt-0.5"
                  style={{ fontFamily: "'Playfair Display', serif", color: "#d9645b", fontSize: "12.5px" }}
                >
                  {company.email}
                </div>
              ) : null}
              {company?.phone ? (
                <div
                  className="font-bold mt-0.5"
                  style={{ fontFamily: "'Playfair Display', serif", color: "#1a1a1a", fontSize: "12.5px", letterSpacing: "0.5px" }}
                >
                  CONTACT NO: {company.phone}
                </div>
              ) : null}
              {company?.gstin && !isQuotation ? (
                <div className="text-[12px] font-semibold text-slate-900 mt-1">GSTIN: {company.gstin}</div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* When printing on pre-printed letterhead stationery, leave blank space
          at the top matching where the physical letterhead sits, so the
          printed content starts below it instead of overlapping it. */}
      {!showHeader && (
        <div style={{ height: "50mm" }} aria-hidden="true" />
      )}

      {isQuotation ? (
        <QuotationBody doc={doc} company={company} t={t} />
      ) : (
      <>
      {/* Title bar */}
      <div className={`mt-2 border border-slate-900 text-center py-1 font-bold text-[13px] tracking-[0.15em] ${showHeader ? "" : "mt-0"}`}>
        {title}
      </div>

      {/* Meta – Buyer + document details */}
      <div className={`grid grid-cols-2 border-x border-b border-slate-900 text-[13px]`}>
        {/* Buyer */}
        <div className="p-2 border-r border-slate-900 min-h-[130px]">
          <div className="leading-snug">
            <span className="font-semibold">M/s. </span>
            <span>{doc.customer_name || ""}</span>
          </div>
          {doc.customer_address ? (
            <div className="whitespace-pre-line leading-snug">{doc.customer_address}</div>
          ) : null}
          {doc.customer_attention ? (
            <div className="leading-snug">Kind Attn: {doc.customer_attention}</div>
          ) : null}
          {!isChallan && (
            <div className="mt-1 leading-snug">
              <span className="font-semibold">Party GST No.: </span>
              <span className="underline">{doc.customer_gstin || ""}</span>
            </div>
          )}
        </div>
        {/* Doc details */}
        <div className="p-2 text-[13px]">
          <MetaRow label={isChallan ? "CHALLAN NO." : "INVOICE NO."} value={doc.number} dateLabel="Date" dateValue={doc.date} />
          {isBill && (
            <MetaRow label="Challan No." value={doc.challan_number} dateLabel="Date" dateValue={doc.challan_date} />
          )}
          <MetaRow label="P. O. No." value={doc.po_number} dateLabel="Date" dateValue={doc.po_date} />
        </div>
      </div>

      {/* "Please receive..." note between meta and items – challan only */}
      {isChallan && (
        <div className="text-center italic py-1 text-[13px] border-x border-slate-900 bg-slate-50">
          Please receive the following goods in good order &amp; condition.
        </div>
      )}

      {/* Items table */}
      <table className="w-full border-x border-b border-slate-900 border-collapse text-[13px]">
        <thead>
          <tr className="text-center align-middle">
            <th className="border-r border-b border-slate-900 py-1 w-10 font-semibold">Sr.<br/>No.</th>
            <th className="border-r border-b border-slate-900 py-1 font-semibold">DESCRIPTION</th>
            {!isChallan && <th className="border-r border-b border-slate-900 py-1 w-14 font-semibold">HSN<br/>Code</th>}
            <th className="border-r border-b border-slate-900 py-1 w-16 font-semibold">QTY.</th>
            {!isChallan && (
              <>
                <th className="border-r border-b border-slate-900 py-1 w-24 font-semibold">Unit Rate<br/>Per Rs.</th>
                <th className="border-b border-slate-900 py-1 w-28 font-semibold">
                  <div className="grid grid-cols-[1fr_28px]">
                    <div className="border-r border-slate-900">Amount<br/>Rs.</div>
                    <div>P.</div>
                  </div>
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {padded.map((it, i) => {
            if (it && it.kind === "header") {
              return (
                <tr key={i} className="align-top">
                  <td className="border-r border-slate-900 px-1 h-[28px]"></td>
                  <td colSpan={isChallan ? 2 : 5} className="px-2 text-[14.5px] font-bold underline underline-offset-2 whitespace-pre-line">
                    {it.description}
                  </td>
                </tr>
              );
            }
            const amt = it ? Number(it.qty || 0) * Number(it.rate || 0) : null;
            const parts = amt !== null ? split(amt) : null;
            return (
              <tr key={i} className="align-top">
                <td className="border-r border-slate-900 px-1 text-center h-[28px]">
                  {it ? String(it.serial).padStart(2, "0") : ""}
                </td>
                <td className="border-r border-slate-900 px-2 text-[14.5px]">
                  {it ? it.description : ""}
                </td>
                {!isChallan && (
                  <td className="border-r border-slate-900 px-1 text-center">{it?.hsn || ""}</td>
                )}
                <td className="border-r border-slate-900 px-1 text-right">
                  {it ? `${it.qty || ""}${it.unit ? " " + it.unit : ""}` : ""}
                </td>
                {!isChallan && (
                  <>
                    <td className="border-r border-slate-900 px-1 text-right">
                      {it ? `${money(it.rate)}/-` : ""}
                    </td>
                    <td className="px-0">
                      <div className="grid grid-cols-[1fr_28px] h-full">
                        <div className="border-r border-slate-900 px-1 text-right">
                          {parts ? parts.rupees : ""}
                        </div>
                        <div className="text-center">{parts ? parts.paise : ""}</div>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          {/* Discount row */}
          {!isChallan && Number(doc.discount_percent || 0) > 0 && (
            <tr>
              <td className="border-r border-t border-slate-900 px-1"></td>
              <td className="border-r border-t border-slate-900 px-2 italic">
                Less: Discount {doc.discount_percent}%
              </td>
              <td className="border-r border-t border-slate-900"></td>
              <td className="border-r border-t border-slate-900"></td>
              <td className="border-r border-t border-slate-900"></td>
              <td className="border-t border-slate-900 px-0">
                <div className="grid grid-cols-[1fr_28px] h-full">
                  <div className="border-r border-slate-900 px-1 text-right">-{split(t.discount).rupees}</div>
                  <div className="text-center">{split(t.discount).paise}</div>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Footer grid – bills / quotations */}
      {!isChallan && (
      <div className="grid grid-cols-[1.6fr_1fr] border-x border-b border-slate-900 text-[13px]">
        {/* LEFT column */}
        <div className="border-r border-slate-900">
        <div className="border-b border-slate-900 px-2 py-1 font-semibold">
           GSTIN NO. : <span className="tracking-wider">{company?.gstin || "27AHOPR6367G1ZO"}</span>
          
          <div className="border-r border-slate-900">
            UDYAM REGISTRATION NO. : <span className="tracking-wider">{company?.udyam_number || "UDYAM-MH-33-0442147"}</span></div>
       
        </div>
          <div className="border-b border-slate-900 px-2 py-1 min-h-[48px]">
              <span className="font-semibold">Total Amount in Words : </span>
              <span className="italic">{numberToWordsINR(t.grand_total)}</span>
            </div>
          <div className="grid grid-cols-2">
            <div className="border-r border-slate-900 px-2 py-1 leading-snug">
              {company?.bank_name ? (
                <>
                  <div><span className="font-semibold">Bank Name</span> : {company.bank_name}</div>
                  <div><span className="font-semibold">A/c. No.</span> &nbsp;&nbsp;: {company.bank_account}</div>
                  <div><span className="font-semibold">IFSC Code</span> : {company.bank_ifsc}</div>
                </>
              ) : (
                <div className="text-slate-400">Bank details in Settings</div>
              )}
            </div>
            <div className="px-2 py-1" />
          </div>
          <div className="border-t border-slate-900 px-2 py-1 leading-snug">
            <div className="font-semibold">Terms and Conditions :</div>
            <ol className="list-decimal list-inside">
              <li>Goods once sold cannot be returned.</li>
              <li>Subject to Thane Dist. Jurisdiction.</li>
            </ol>
            <div className="text-[11px] mt-1">E. &amp; O. E.</div>
            <div className="text-right italic mt-2">
              Receiver&apos;s / Customer&apos;s Seal &amp; Sign.
            </div>
          </div>
        </div>

        {/* RIGHT column — totals + signature */}
        <div>
          <TotalRow label="Total Amount" value={t.subtotal} bold />
          <TotalRow label={`Add : CGST ${rate / 2}%`} value={t.cgst} hidden={doc.gst_type !== "cgst_sgst"} />
          <TotalRow label={`Add : SGST ${rate / 2}%`} value={t.sgst} hidden={doc.gst_type !== "cgst_sgst"} />
          <TotalRow label={`Add : IGST ${rate}%`} value={t.igst} hidden={doc.gst_type !== "igst"} />
          {doc.gst_type === "cgst_sgst" && (
            <div className="grid grid-cols-[1fr_1fr_28px] border-b border-slate-900 px-0 h-[24px] text-slate-300">
              <div className="border-r border-slate-900 px-2">Add : IGST %</div>
              <div className="border-r border-slate-900 text-right px-1">—</div>
              <div className="text-center">—</div>
            </div>
          )}
          <TotalRow label="Rounded (+)" value={0} muted />
          <TotalRow label="Grand Amount" value={t.grand_total} bold big />
          <div className="border-t border-slate-900 px-2 py-1">
            <div className="font-bold text-[13px]" style={{ color: "#d9645b", fontFamily: "'Playfair Display', serif" }}>
              For {company?.name || "Auto~Mech Spares & Service"}
            </div>
            <div className="min-h-[46px]" />
            <div className="text-right border-t border-slate-400 pt-0.5 text-[12px]">
              <span className="italic">Authorised Signatory</span>
            </div>
          </div>
        </div>
      </div>
      )}

      </>
      )}

      {/* Challan-only compact footer — matches physical challan book */}
      {isChallan && (
        <div className="border-x border-b border-slate-900">
          <div className="grid grid-cols-2 min-h-[130px]">
            <div className="border-r border-slate-900 p-3 flex flex-col justify-end">
              <div className="text-[12px] font-semibold">
                Total Qty : {items.reduce((s, it) => (it.kind === "header" ? s : s + Number(it.qty || 0)), 0)}
              </div>
              <div className="mt-8 border-t border-slate-500 pt-1 text-[13px] italic">
                Receiver&apos;s Signature
              </div>
            </div>
            <div className="p-3 flex flex-col justify-between text-right">
              <div
                className="font-bold text-[13px]"
                style={{ color: "#d9645b", fontFamily: "'Playfair Display', serif" }}
              >
                For {company?.name || "Auto~Mech Spares & Service"}
              </div>
              <div className="border-t border-slate-500 pt-0.5 text-[13px]">
                <span className="italic">Authorised Signatory</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuotationBody({ doc, company, t }) {
  const items = doc.items || [];
  const terms = doc.terms || {};
  const introText =
    (doc.intro && doc.intro.trim()) ||
    "This is with reference to your enquiry regarding the above mentioned subject. In this regard, please find herewith our best quote for the same.";
  const closingText =
    (doc.closing && doc.closing.trim()) ||
    "We now look forward to your valuable Purchase Order at the earliest.";

  return (
    <div className="text-[13px] leading-snug" style={{ fontFamily: "'Times New Roman', 'Liberation Serif', serif" }}>
      {/* Ref / Date */}
      <div className="flex justify-between mt-3 mb-4">
        <div><span className="font-semibold">REF :</span> {doc.number || ""}</div>
        <div><span className="font-semibold">DT :</span> {doc.date || ""}</div>
      </div>

      {/* Buyer */}
      <div className="mb-3">
        <div><span className="font-semibold">M/s. </span>{doc.customer_name || ""}</div>
        {doc.customer_address ? (
          <div className="whitespace-pre-line">{doc.customer_address}</div>
        ) : null}
      </div>

      {doc.customer_attention ? (
        <div className="font-bold mb-2">Kind Atten : {doc.customer_attention}</div>
      ) : null}
      {doc.subject ? (
        <div className="font-bold mb-3">Subject : {doc.subject}</div>
      ) : null}

      <div className="mb-2">Respected Sir,</div>
      <div className="mb-4 text-justify">{introText}</div>

      {/* Items table */}
      <table className="w-full border border-slate-900 border-collapse text-[13px] mb-4">
        <thead>
          <tr className="text-center">
            <th className="border border-slate-900 py-1 w-10 font-semibold">SL.</th>
            <th className="border border-slate-900 py-1 font-semibold">DESCRIPTION</th>
            <th className="border border-slate-900 py-1 w-24 font-semibold">UNIT RATE</th>
            <th className="border border-slate-900 py-1 w-20 font-semibold">QTY REQD.</th>
            <th className="border border-slate-900 py-1 w-28 font-semibold">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            let serial = 0;
            return items.map((it, i) => {
              if (it.kind === "header") {
                return (
                  <tr key={i}>
                    <td className="border border-slate-900 px-1"></td>
                    <td colSpan={4} className="border border-slate-900 px-2 text-[14.5px] font-bold underline underline-offset-2 whitespace-pre-line">
                      {it.description}
                    </td>
                  </tr>
                );
              }
              serial += 1;
              const amt = Number(it.qty || 0) * Number(it.rate || 0);
              return (
              <tr key={i}>
                <td className="border border-slate-900 px-1 text-center">{serial}.</td>
                <td className="border border-slate-900 px-2 text-[14.5px]">{it.description}</td>
                <td className="border border-slate-900 px-1 text-right">{it.rate ? `${money(it.rate)}/-` : ""}</td>
                <td className="border border-slate-900 px-1 text-center">
                  {it.qty}{it.unit ? " " + it.unit : ""}
                </td>
                <td className="border border-slate-900 px-1 text-right">{money(amt)}</td>
              </tr>
              );
            });
          })()}
          {Number(doc.discount_percent || 0) > 0 && (
            <tr>
              <td colSpan={4} className="border border-slate-900 px-2 text-right italic">
                Less: Discount {doc.discount_percent}%
              </td>
              <td className="border border-slate-900 px-1 text-right">-{money(t.discount)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={4} className="border border-slate-900 px-2 text-right font-semibold">Total</td>
            <td className="border border-slate-900 px-1 text-right font-semibold">{money(t.subtotal)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mb-4">{closingText}</div>
      <div>Thanking You,</div>
      <div className="mb-6">Yours truly,</div>
      <div className="font-bold" style={{ color: "#d9645b", fontFamily: "'Playfair Display', serif" }}>
        For, {company?.name || "Auto Mech Spares & Service"}
      </div>
      <div className="min-h-[50px]" />
      <div className="italic mb-6">Authorised Signatory</div>

      {/* Terms */}
      <div className="font-bold underline mb-1">TERMS AND CONDITIONS</div>
      <div className="space-y-0.5">
        <div><span className="font-semibold">PAYMENT</span> : {terms.payment || ""}</div>
        <div><span className="font-semibold">TAXES</span> : {terms.taxes || ""}</div>
        <div><span className="font-semibold">DELIVERY</span> : {terms.delivery || ""}</div>
        <div><span className="font-semibold">FREIGHT</span> : {terms.freight || ""}</div>
        <div><span className="font-semibold">GUARANTEE</span> : {terms.guarantee || ""}</div>
      </div>
    </div>
  );
}

function MetaRow({ label, value, dateLabel, dateValue }) {
  return (
    <div className="flex items-baseline gap-2 py-1 border-b border-dashed border-slate-300 last:border-0">
      <span className="font-semibold whitespace-nowrap">{label}:</span>
      <span className="flex-1 border-b border-slate-500 min-h-[19px] px-1">{value || ""}</span>
      <span className="whitespace-nowrap">{dateLabel}:</span>
      <span className="w-24 border-b border-slate-500 min-h-[19px] px-1">{dateValue || ""}</span>
    </div>
  );
}

function TotalRow({ label, value, bold, big, muted, hidden }) {
  if (hidden) return null;
  const parts = split(value);
  return (
    <div
      className={`grid grid-cols-[1fr_1fr_28px] border-b border-slate-900 h-[27px] ${
        big ? "bg-slate-50" : ""
      } ${muted ? "text-slate-400" : ""}`}
    >
      <div className={`border-r border-slate-900 px-2 flex items-center ${bold ? "font-semibold" : ""}`}>
        {label}
      </div>
      <div className={`border-r border-slate-900 text-right px-1 flex items-center justify-end ${bold ? "font-semibold" : ""}`}>
        {parts.rupees}
      </div>
      <div className="text-center flex items-center justify-center">{parts.paise}</div>
    </div>
  );
}
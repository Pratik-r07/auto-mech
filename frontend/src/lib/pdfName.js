// Builds a readable PDF file name: "<Client>_<Type>_<Number>"
// e.g. "Tata Motors_Bill_INV-2026-0001"

const TYPE_LABEL = {
  bill: "Bill",
  quotation: "Quotation",
  challan: "Challan",
};

// Remove characters that are not allowed in file names (and the "/" in numbers like INV/2026/0001)
export const cleanForFilename = (s) =>
  String(s || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

export function docFileName(doc) {
  const client = cleanForFilename(doc.customer_name) || "Client";
  const type = TYPE_LABEL[doc.doc_type] || "Document";
  const number = cleanForFilename(doc.number);
  return [client, type, number].filter(Boolean).join("_");
}

// For several documents downloaded together in one PDF
export function bulkFileName(docs, docType) {
  if (!docs.length) return "Documents";
  if (docs.length === 1) return docFileName(docs[0]);

  const clients = Array.from(
    new Set(docs.map((d) => cleanForFilename(d.customer_name)).filter(Boolean))
  );
  const client = clients.length === 1 ? clients[0] : "Multiple Clients";
  const type = (TYPE_LABEL[docType] || "Document") + "s";
  const numbers = docs.map((d) => cleanForFilename(d.number)).join("_");
  return `${client}_${type}_${numbers}`;
}

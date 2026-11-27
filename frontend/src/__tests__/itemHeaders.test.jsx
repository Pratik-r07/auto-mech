/* Section headers + reordering in the document editor and the printed preview. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatApiError: (d) => String(d),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import api from "@/lib/api";
import DocumentEditor from "@/pages/DocumentEditor";
import DocumentPreview from "@/components/DocumentPreview";

const ITEMS = [
  { kind: "header", description: "Spares for Filling Machine", qty: 0, rate: 0 },
  { kind: "item", description: "Valve", qty: 2, unit: "Nos", rate: 1000 },
  { kind: "header", description: "Spares for Capping Machine", qty: 0, rate: 0 },
  { kind: "item", description: "Cap seal", qty: 10, unit: "Nos", rate: 50 },
];

/* ---------------- printed document ---------------- */
describe("printed document", () => {
  const company = { name: "Auto-Mech" };
  const base = { customer_name: "Tata", items: ITEMS, gst_type: "none", gst_rate: 0, discount_percent: 0, terms: {}, date: "01/01/2026", number: "X-1" };

  test("bill: headers are bold rows and numbering skips them", () => {
    const html = renderToStaticMarkup(<DocumentPreview doc={{ ...base, doc_type: "bill" }} company={company} />);
    expect(html).toContain("Spares for Filling Machine");
    expect(html).toContain("Spares for Capping Machine");
    expect(html.indexOf("Spares for Filling")).toBeLessThan(html.indexOf("Valve"));
    expect(html.indexOf("Valve")).toBeLessThan(html.indexOf("Spares for Capping"));
    expect(html.indexOf("Spares for Capping")).toBeLessThan(html.indexOf("Cap seal"));
    expect(html).toContain(">01<");
    expect(html).toContain(">02<");
    expect(html).not.toContain(">03<");
    expect(html).toContain(">2,500<");                         // rupees part of the total: headers add nothing
    expect(html).toContain("Two Thousand Five Hundred Rupees Only");
  });

  test("quotation: numbering skips headers", () => {
    const html = renderToStaticMarkup(<DocumentPreview doc={{ ...base, doc_type: "quotation" }} company={company} />);
    expect(html).toContain("Spares for Filling Machine");
    expect(html).toContain(">1.<");
    expect(html).toContain(">2.<");
    expect(html).not.toContain(">3.<");
  });

  test("challan: total qty ignores headers", () => {
    const html = renderToStaticMarkup(<DocumentPreview doc={{ ...base, doc_type: "challan" }} company={company} />);
    expect(html).toContain("Spares for Capping Machine");
    expect(html.replace(/<!-- -->/g, "")).toContain("Total Qty : 12");
  });
});

/* ---------------- editor ---------------- */
let container, root;
const q = (sel) => container.querySelector(sel);
const rows = () => Array.from(container.querySelectorAll("[data-item-card]"));
const rowTexts = () => rows().map((r) => {
  const t = r.querySelector("input[data-testid^='header-text-'], textarea");
  return `${r.querySelector("input[data-testid^='header-text-']") ? "H:" : "I:"}${t.value}`;
});
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const setNative = (el, value) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const type = (el, v) => act(() => setNative(el, v));
// jsdom has no layout, so give every row a fake position: row n sits at top = n*100, height 80
// (plus whatever translateY the editor applies while a row is being dragged).
const realRect = window.HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute && this.hasAttribute("data-item-card")) {
      const idx = Array.from(document.querySelectorAll("[data-item-card]")).indexOf(this);
      const m = /translateY\((-?[\d.]+)px\)/.exec(this.style.transform || "");
      const top = idx * 100 + (m ? parseFloat(m[1]) : 0);
      return { top, bottom: top + 80, height: 80, left: 0, right: 300, width: 300, x: 0, y: top };
    }
    return realRect.call(this);
  };
});
afterAll(() => { window.HTMLElement.prototype.getBoundingClientRect = realRect; });

const pointer = (type_, el, y) => act(() => {
  const ev = new Event(type_, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clientY", { value: y });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  el.dispatchEvent(ev);
});
// grab row `from` by its handle (10px below the row's top) and drag the pointer to `toY`, then let go
const dragRow = (from, toY, { drop = true } = {}) => {
  const handle = q(`[data-testid=drag-handle-${from}]`);
  pointer("pointerdown", handle, from * 100 + 10);
  pointer("pointermove", handle, toY);
  if (drop) pointer("pointerup", handle, toY);
  return handle;
};

async function mountEditor({ id } = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/company") return Promise.resolve({ data: { default_terms: {} } });
    if (url === "/clients") return Promise.resolve({ data: [] });
    if (url === "/items") return Promise.resolve({ data: [] });
    if (url.startsWith("/documents/")) return Promise.resolve({ data: { id: "d1", doc_type: "bill", customer_name: "Tata", items: ITEMS, terms: {}, gst_type: "none" } });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: { id: "new1" } });
  api.put.mockResolvedValue({ data: { id: "d1" } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[id ? `/edit/${id}` : "/new/bill"]}>
        <Routes>
          <Route path="/new/:docType" element={<DocumentEditor />} />
          <Route path="/edit/:id" element={<DocumentEditor />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    );
  });
}
afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  root = container = null;
  jest.clearAllMocks();
});

describe("editor", () => {
  test("add headers/items at the top, in between and at the end", async () => {
    await mountEditor();
    expect(rows()).toHaveLength(1);                                   // starts with one blank item
    click(q("[data-testid=add-header-button]"));                      // header at the end
    expect(rowTexts()).toEqual(["I:", "H:"]);
    click(q("[data-testid=insert-header-0]"));                        // header at the very top
    expect(rowTexts()).toEqual(["H:", "I:", "H:"]);
    click(q("[data-testid=insert-item-2]"));                          // item in between (after row 2)
    expect(rowTexts()).toEqual(["H:", "I:", "I:", "H:"]);
    click(q("[data-testid=add-item-button]"));
    expect(rows()).toHaveLength(5);
  });

  test("serial numbers skip headers", async () => {
    await mountEditor({ id: "d1" });
    const labels = rows().map((r) => (r.textContent.match(/#(\d+)/) || [])[1] || "header");
    expect(labels).toEqual(["header", "1", "header", "2"]);
  });

  test("there are no arrow buttons or dropdowns: dragging is the only way to reorder", async () => {
    await mountEditor({ id: "d1" });
    expect(container.querySelector("[data-testid^=move-]")).toBeNull();
    expect(container.querySelector("select[aria-label='Move to position']")).toBeNull();
    expect(container.querySelectorAll("[data-testid^=drag-handle-]")).toHaveLength(4);
  });

  test("drag the last row up to the very top", async () => {
    await mountEditor({ id: "d1" });
    dragRow(3, 5);                                                     // pointer well above the first row's middle
    expect(rowTexts()).toEqual(["I:Cap seal", "H:Spares for Filling Machine", "I:Valve", "H:Spares for Capping Machine"]);
  });

  test("drag a row down, and a header into the middle", async () => {
    await mountEditor({ id: "d1" });
    dragRow(0, 130);                                                   // first row down by one place
    expect(rowTexts()).toEqual(["I:Valve", "H:Spares for Filling Machine", "H:Spares for Capping Machine", "I:Cap seal"]);
    dragRow(2, 100);                                                   // header from place 3 up to place 2
    expect(rowTexts()).toEqual(["I:Valve", "H:Spares for Capping Machine", "H:Spares for Filling Machine", "I:Cap seal"]);
  });

  test("a tiny drag, or a cancelled drag, changes nothing", async () => {
    await mountEditor({ id: "d1" });
    const before = rowTexts();
    dragRow(1, 120);                                                   // barely moves: same slot
    expect(rowTexts()).toEqual(before);
    const handle = dragRow(3, 5, { drop: false });                     // drag up, then the browser cancels it
    pointer("pointercancel", handle, 5);
    expect(rowTexts()).toEqual(before);
    expect(rows()[3].style.transform).toBe("");                        // row snaps back
  });

  test("while dragging, the row follows the pointer and an orange line shows where it will land", async () => {
    await mountEditor({ id: "d1" });
    dragRow(3, 5, { drop: false });
    expect(rows()[3].style.transform).toMatch(/translateY\(/);
    expect(rows()[0].className).toContain("shadow-[0_-4px_0_0_#f97316]"); // will land just above row 1
    pointer("pointerup", q("[data-testid=drag-handle-3]"), 5);
    expect(rows().every((r) => !r.style.transform)).toBe(true);
  });

  test("saving keeps order + headers, drops empty headers and temporary ids", async () => {
    await mountEditor({ id: "d1" });
    click(q("[data-testid=insert-header-0]"));                         // new EMPTY header at the top
    dragRow(4, 5);                                                     // drag the last item to the top
    click(q("[data-testid=save-button]"));
    await act(async () => {});
    expect(api.put).toHaveBeenCalledTimes(1);
    const [url, payload] = api.put.mock.calls[0];
    expect(url).toBe("/documents/d1");
    expect(payload.items.map((i) => `${i.kind}:${i.description}`)).toEqual([
      "item:Cap seal", "header:Spares for Filling Machine", "item:Valve", "header:Spares for Capping Machine",
    ]);
    expect(payload.items.some((i) => "uid" in i)).toBe(false);
  });
});

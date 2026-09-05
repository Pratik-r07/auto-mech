import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FileText, Receipt, Plus, TrendUp, CurrencyInr, Truck } from "@phosphor-icons/react";

const money = (n) =>
  "₹ " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api.get("/documents/stats").then((r) => setStats(r.data));
    api.get("/documents").then((r) => setRecent(r.data.slice(0, 6)));
  }, []);

  const cards = [
    { label: "Quotations", value: stats?.quotation_count ?? "—", icon: FileText, sub: money(stats?.quotation_value) },
    { label: "Bills / Invoices", value: stats?.bill_count ?? "—", icon: Receipt, sub: money(stats?.bill_value) },
    { label: "Delivery Challans", value: stats?.challan_count ?? "—", icon: Truck, sub: "Total issued" },
    { label: "Invoiced Value", value: money(stats?.bill_value), icon: CurrencyInr, sub: "Total billed" },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Overview</p>
          <h1 className="font-head text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 mt-1">
            Dashboard
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            data-testid="new-quotation-button"
            onClick={() => navigate("/new/quotation")}
            className="bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors duration-150"
          >
            <Plus size={16} weight="bold" className="mr-2" /> New Quotation
          </Button>
          <Button
            data-testid="new-bill-button"
            onClick={() => navigate("/new/bill")}
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md"
          >
            <Plus size={16} weight="bold" className="mr-2" /> New Bill
          </Button>
          <Button
            data-testid="new-challan-button"
            onClick={() => navigate("/new/challan")}
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md"
          >
            <Truck size={16} weight="bold" className="mr-2" /> New Challan
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 mb-10">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-md p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{c.label}</span>
              <c.icon size={20} weight="duotone" className="text-orange-600" />
            </div>
            <div className="font-head text-2xl font-black text-slate-900 mt-3 font-mono-num">{c.value}</div>
            <div className="text-[11px] text-slate-400 mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      <h2 className="font-head text-xl font-bold text-slate-800 mb-4">Recent Documents</h2>
      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto shadow-sm">
        {recent.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            No documents yet. Create your first quotation to get started.
          </div>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["Number", "Type", "Customer", "Date", "Amount"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr
                  key={d.id}
                  data-testid={`recent-doc-${d.id}`}
                  onClick={() => navigate(`/edit/${d.id}`)}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors duration-150"
                >
                  <td className="px-4 py-3 font-mono-num font-semibold text-slate-900">{d.number}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded ${
                        d.doc_type === "bill" ? "bg-slate-900 text-white" : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {d.doc_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{d.customer_name || "—"}</td>
                  <td className="px-4 py-3 font-mono-num text-slate-600">{d.date}</td>
                  <td className="px-4 py-3 font-mono-num text-right font-semibold text-slate-900">
                    {money(d.grand_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

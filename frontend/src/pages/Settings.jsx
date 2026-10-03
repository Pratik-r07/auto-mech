import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FloppyDisk, GearSix } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Settings() {
  const [c, setC] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/company").then((r) => setC({ default_terms: {}, ...r.data }));
  }, []);

  const set = (k, v) => setC((p) => ({ ...p, [k]: v }));
  const setTerm = (k, v) => setC((p) => ({ ...p, default_terms: { ...(p.default_terms || {}), [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/company", c);
      toast.success("Company profile saved");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!c)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Configuration</p>
        <h1 className="font-head text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 mt-1 flex items-center gap-3">
          <GearSix size={30} weight="duotone" className="text-orange-600" /> Company Settings
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          These details appear on every quotation and invoice you generate.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-6 shadow-sm space-y-6">
        <Group title="Business Identity">
          <F label="Company Name" value={c.name} onChange={(v) => set("name", v)} testid="company-name" />
          <F label="Tagline" value={c.tagline} onChange={(v) => set("tagline", v)} testid="company-tagline" />
          <div>
            <Label className="text-xs font-medium text-slate-500 mb-1 block">Address</Label>
            <Textarea data-testid="company-address" value={c.address} onChange={(e) => set("address", e.target.value)} className="border-slate-300 focus:ring-2 focus:ring-orange-500 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Phone" value={c.phone} onChange={(v) => set("phone", v)} testid="company-phone" />
            <F label="Email" value={c.email} onChange={(v) => set("email", v)} testid="company-email" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="GSTIN" value={c.gstin} onChange={(v) => set("gstin", v)} testid="company-gstin" />
            <F label="Udyam Registration No." value={c.udyam_number} onChange={(v) => set("udyam_number", v)} testid="company-udyam" />
          </div>
          <F label="Authorized Signatory" value={c.signatory} onChange={(v) => set("signatory", v)} testid="company-signatory" />
        </Group>

        <Group title="Bank Details">
          <div className="grid grid-cols-2 gap-3">
            <F label="Bank Name" value={c.bank_name} onChange={(v) => set("bank_name", v)} testid="bank-name" />
            <F label="Branch" value={c.bank_branch} onChange={(v) => set("bank_branch", v)} testid="bank-branch" />
            <F label="Account No." value={c.bank_account} onChange={(v) => set("bank_account", v)} testid="bank-account" />
            <F label="IFSC" value={c.bank_ifsc} onChange={(v) => set("bank_ifsc", v)} testid="bank-ifsc" />
          </div>
        </Group>

        <Group title="Default Terms">
          {["payment", "taxes", "delivery", "freight", "guarantee"].map((k) => (
            <F key={k} label={k} value={c.default_terms?.[k] || ""} onChange={(v) => setTerm(k, v)} testid={`default-term-${k}`} />
          ))}
        </Group>

        <Button onClick={save} disabled={saving} data-testid="save-settings-button" className="bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors duration-150">
          <FloppyDisk size={16} weight="bold" className="mr-2" /> {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div>
      <h3 className="font-head text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-1.5 mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function F({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="text-xs font-medium text-slate-500 mb-1 block capitalize">{label}</Label>
      <Input data-testid={testid} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="h-10 border-slate-300 focus:ring-2 focus:ring-orange-500" />
    </div>
  );
}
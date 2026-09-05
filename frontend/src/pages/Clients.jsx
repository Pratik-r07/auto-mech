import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, PencilSimple, Trash, UsersThree } from "@phosphor-icons/react";
import { toast } from "sonner";

const empty = { name: "", address: "", gstin: "", attention: "", phone: "", email: "" };

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const load = () => api.get("/clients").then((r) => setClients(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditId(null); setOpen(true); };
  const openEdit = (c) => { setForm(c); setEditId(c.id); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    try {
      if (editId) await api.put(`/clients/${editId}`, form);
      else await api.post("/clients", form);
      toast.success("Saved");
      setOpen(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    }
  };

  const remove = async () => {
    await api.delete(`/clients/${toDelete}`);
    setToDelete(null);
    toast.success("Deleted");
    load();
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Directory</p>
          <h1 className="font-head text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 mt-1 flex items-center gap-3">
            <UsersThree size={30} weight="duotone" className="text-orange-600" /> Clients
          </h1>
        </div>
        <Button
          data-testid="add-client-button"
          onClick={openNew}
          className="bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors duration-150"
        >
          <Plus size={16} weight="bold" className="mr-2" /> Add Client
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto shadow-sm">
        {clients.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No clients yet.</div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["Name", "GSTIN", "Attention", "Phone", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} data-testid={`client-row-${c.id}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-900">{c.name}</td>
                  <td className="px-4 py-3 font-mono-num text-slate-600">{c.gstin || "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{c.attention || "—"}</td>
                  <td className="px-4 py-3 font-mono-num text-slate-600">{c.phone || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(c)} data-testid={`edit-client-${c.id}`} className="p-2 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors">
                        <PencilSimple size={16} weight="bold" />
                      </button>
                      <button onClick={() => setToDelete(c.id)} data-testid={`delete-client-${c.id}`} className="p-2 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors">
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-head">{editId ? "Edit" : "Add"} Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <CField label="Name" value={form.name} onChange={(v) => set("name", v)} testid="client-name" />
            <div>
              <Label className="text-xs font-medium text-slate-500 mb-1 block">Address</Label>
              <Textarea data-testid="client-address" value={form.address} onChange={(e) => set("address", e.target.value)} className="border-slate-300 focus:ring-2 focus:ring-orange-500 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <CField label="GSTIN" value={form.gstin} onChange={(v) => set("gstin", v)} testid="client-gstin" />
              <CField label="Attention" value={form.attention} onChange={(v) => set("attention", v)} testid="client-attention" />
              <CField label="Phone" value={form.phone} onChange={(v) => set("phone", v)} testid="client-phone" />
              <CField label="Email" value={form.email} onChange={(v) => set("email", v)} testid="client-email" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-slate-300">Cancel</Button>
            <Button onClick={save} data-testid="save-client-button" className="bg-orange-600 hover:bg-orange-700 text-white">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} data-testid="confirm-delete-client" className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="text-xs font-medium text-slate-500 mb-1 block">{label}</Label>
      <Input data-testid={testid} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="h-10 border-slate-300 focus:ring-2 focus:ring-orange-500" />
    </div>
  );
}

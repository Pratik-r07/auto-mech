import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FolderSimple, FolderOpen, UploadSimple, DownloadSimple, Trash, ArrowLeft,
  MagnifyingGlass, FilePdf, FileImage, FileText, File as FileIcon, Receipt, Truck,
} from "@phosphor-icons/react";
import { toast } from "sonner";

const MAX_MB = 15;

// Sub-folders inside every client folder. "other" only appears when a client
// has older files that were uploaded before sub-folders existed.
const CATEGORIES = [
  { key: "bill", label: "Bills", icon: Receipt },
  { key: "challan", label: "Challans", icon: Truck },
  { key: "quotation", label: "Quotations", icon: FileText },
];
const OTHER = { key: "other", label: "Other files", icon: FileIcon };
const categoryOf = (key) => [...CATEGORIES, OTHER].find((c) => c.key === key);

const formatSize = (bytes) => {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

function fileIcon(type = "", name = "") {
  const n = name.toLowerCase();
  if (type.includes("pdf") || n.endsWith(".pdf")) return <FilePdf size={20} weight="duotone" className="text-red-500" />;
  if (type.startsWith("image/")) return <FileImage size={20} weight="duotone" className="text-sky-500" />;
  if (type.startsWith("text/") || /\.(docx?|xlsx?|csv|txt)$/.test(n))
    return <FileText size={20} weight="duotone" className="text-emerald-600" />;
  return <FileIcon size={20} weight="duotone" className="text-slate-400" />;
}

/* ------------------------------------------------------------------ */
/* All client folders                                                  */
/* ------------------------------------------------------------------ */
function FolderGrid() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    Promise.all([api.get("/clients"), api.get("/files/summary")])
      .then(([c, s]) => {
        setClients(c.data);
        setSummary(s.data);
      })
      .catch((e) => toast.error(formatApiError(e.response?.data?.detail) || e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => clients.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())),
    [clients, q]
  );

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Storage</p>
        <h1 className="font-head text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 mt-1 flex items-center gap-3">
          <FolderSimple size={30} weight="duotone" className="text-orange-600" /> Client Files
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          One folder per client. Open a folder to upload and keep that client's files together.
        </p>
      </div>

      <div className="relative mb-6 max-w-sm">
        <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          data-testid="folder-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search client folders…"
          className="pl-9 rounded-md"
        />
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400 text-sm">Loading folders…</div>
      ) : clients.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-md p-12 text-center text-slate-400 text-sm">
          No clients yet. Add a client first and its folder will appear here.
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm">No folder matches "{q}".</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((c) => {
            const info = summary[c.id] || { count: 0, size: 0 };
            return (
              <button
                key={c.id}
                data-testid={`folder-${c.id}`}
                onClick={() => navigate(`/files/${c.id}`)}
                className="text-left bg-white border border-slate-200 rounded-md p-4 shadow-sm hover:border-orange-300 hover:shadow transition-all duration-150 flex items-start gap-3"
              >
                <FolderSimple
                  size={38}
                  weight={info.count ? "fill" : "duotone"}
                  className={info.count ? "text-orange-500 shrink-0" : "text-slate-300 shrink-0"}
                />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {info.count === 0
                      ? "Empty"
                      : `${info.count} file${info.count === 1 ? "" : "s"} · ${formatSize(info.size)}`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One client's folder                                                 */
/* ------------------------------------------------------------------ */
function FolderView({ clientId, category }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [client, setClient] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [q, setQ] = useState("");
  const [toDelete, setToDelete] = useState(null);

  const load = async () => {
    try {
      const [cl, fl] = await Promise.all([api.get("/clients"), api.get(`/clients/${clientId}/files`, { params: { category } })]);
      setClient(cl.data.find((c) => c.id === clientId) || null);
      setFiles(fl.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [clientId, category]);

  const upload = async (fileList) => {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;

    const tooBig = picked.filter((f) => f.size > MAX_MB * 1024 * 1024);
    tooBig.forEach((f) => toast.error(`${f.name} is larger than ${MAX_MB} MB and was skipped`));
    const ok = picked.filter((f) => f.size <= MAX_MB * 1024 * 1024);
    if (ok.length === 0) return;

    const form = new FormData();
    form.append("category", category);
    ok.forEach((f) => form.append("files", f));
    setUploading(true);
    try {
      const { data } = await api.post(`/clients/${clientId}/files`, form);
      if (data.saved.length) toast.success(`${data.saved.length} file${data.saved.length === 1 ? "" : "s"} uploaded`);
      data.rejected.forEach((r) => toast.error(`Skipped: ${r}`));
      await load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (f) => {
    try {
      const res = await api.get(`/files/${f.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error("Could not download the file");
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/files/${toDelete.id}`);
      toast.success("File deleted");
      setToDelete(null);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    }
  };

  const shown = files.filter((f) => f.filename.toLowerCase().includes(q.trim().toLowerCase()));
  const totalSize = files.reduce((n, f) => n + f.size, 0);

  if (loading) return <div className="p-12 text-center text-slate-400 text-sm">Loading folder…</div>;

  if (!client)
    return (
      <div className="p-8">
        <button onClick={() => navigate("/files")} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} weight="bold" /> All folders
        </button>
        <div className="mt-8 text-slate-500 text-sm">This client no longer exists.</div>
      </div>
    );

  return (
    <div
      className="p-4 sm:p-8"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (category !== "other") upload(e.dataTransfer.files); }}
    >
      <button
        data-testid="back-to-folders"
        onClick={() => navigate(`/files/${clientId}`)}
        className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-4"
      >
        <ArrowLeft size={16} weight="bold" /> {client.name}
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-head text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 flex items-center gap-3">
            <FolderOpen size={32} weight="duotone" className="text-orange-600" />
            <span className="text-slate-400 font-bold">{client.name} /</span> {categoryOf(category).label}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {files.length} file{files.length === 1 ? "" : "s"} · {formatSize(totalSize)}
          </p>
        </div>
        {category !== "other" && (
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="file-input"
            onChange={(e) => upload(e.target.files)}
          />
          <Button
            data-testid="upload-button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="bg-orange-600 hover:bg-orange-700 text-white rounded-md"
          >
            <UploadSimple size={16} weight="bold" className="mr-2" />
            {uploading ? "Uploading…" : "Upload files"}
          </Button>
        </div>
        )}
      </div>

      {category !== "other" && (
      <div
        className={`mb-6 border-2 border-dashed rounded-md p-6 text-center text-sm transition-colors ${
          dragging ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-300 text-slate-500"
        }`}
      >
        Drag & drop files here, or use <span className="font-semibold">Upload files</span>
        <span className="block text-xs text-slate-400 mt-1">Up to {MAX_MB} MB per file</span>
      </div>
      )}

      {files.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search in this folder…"
            className="pl-9 rounded-md"
          />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-md overflow-x-auto shadow-sm">
        {files.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">This folder is empty.</div>
        ) : shown.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No file matches "{q}".</div>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["Name", "Size", "Uploaded", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {fileIcon(f.content_type, f.filename)}
                      <span className="font-medium text-slate-900 truncate max-w-[320px]" title={f.filename}>{f.filename}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatSize(f.size)}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(f.uploaded_at)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      data-testid={`download-${f.id}`}
                      onClick={() => download(f)}
                      className="p-2 rounded-md text-slate-500 hover:text-orange-700 hover:bg-orange-50"
                      title="Download"
                    >
                      <DownloadSimple size={18} weight="bold" />
                    </button>
                    <button
                      data-testid={`delete-${f.id}`}
                      onClick={() => setToDelete(f)}
                      className="p-2 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50"
                      title="Delete"
                    >
                      <Trash size={18} weight="bold" />
                    </button>
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
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.filename}" will be permanently removed from {client.name}'s folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-folders (Bills / Challans / Quotations) of one client           */
/* ------------------------------------------------------------------ */
function SubfolderGrid({ clientId }) {
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [info, setInfo] = useState({ count: 0, size: 0, categories: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get("/clients"), api.get("/files/summary")])
      .then(([c, s]) => {
        setClient(c.data.find((x) => x.id === clientId) || null);
        setInfo(s.data[clientId] || { count: 0, size: 0, categories: {} });
      })
      .catch((e) => toast.error(formatApiError(e.response?.data?.detail) || e.message))
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) return <div className="p-12 text-center text-slate-400 text-sm">Loading folder…</div>;

  if (!client)
    return (
      <div className="p-8">
        <button onClick={() => navigate("/files")} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} weight="bold" /> All folders
        </button>
        <div className="mt-8 text-slate-500 text-sm">This client no longer exists.</div>
      </div>
    );

  const folders = info.categories.other?.count ? [...CATEGORIES, OTHER] : CATEGORIES;

  return (
    <div className="p-4 sm:p-8">
      <button
        data-testid="back-to-folders"
        onClick={() => navigate("/files")}
        className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-4"
      >
        <ArrowLeft size={16} weight="bold" /> All folders
      </button>

      <div className="mb-6">
        <h1 className="font-head text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 flex items-center gap-3">
          <FolderOpen size={32} weight="duotone" className="text-orange-600" /> {client.name}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {info.count} file{info.count === 1 ? "" : "s"} · {formatSize(info.size)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {folders.map((f) => {
          const c = info.categories[f.key] || { count: 0, size: 0 };
          return (
            <button
              key={f.key}
              data-testid={`subfolder-${f.key}`}
              onClick={() => navigate(`/files/${clientId}/${f.key}`)}
              className="text-left bg-white border border-slate-200 rounded-md p-4 shadow-sm hover:border-orange-300 hover:shadow transition-all duration-150 flex items-start gap-3"
            >
              <div className="relative shrink-0">
                <FolderSimple size={40} weight={c.count ? "fill" : "duotone"} className={c.count ? "text-orange-500" : "text-slate-300"} />
                <f.icon size={14} weight="bold" className="absolute left-[13px] top-[17px] text-white" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{f.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {c.count === 0 ? "Empty" : `${c.count} file${c.count === 1 ? "" : "s"} · ${formatSize(c.size)}`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Files() {
  const { clientId, category } = useParams();
  if (!clientId) return <FolderGrid />;
  if (!category) return <SubfolderGrid clientId={clientId} />;
  if (!categoryOf(category)) return <SubfolderGrid clientId={clientId} />;
  return <FolderView clientId={clientId} category={category} />;
}

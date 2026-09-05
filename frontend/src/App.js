import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "sonner";
import Login from "@/pages/Login";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import DocumentList from "@/pages/DocumentList";
import DocumentEditor from "@/pages/DocumentEditor";
import DocumentView from "@/pages/DocumentView";
import Clients from "@/pages/Clients";
import Settings from "@/pages/Settings";

function ProtectedRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <Toaster position="top-right" richColors />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/quotations" element={<DocumentList docType="quotation" />} />
              <Route path="/bills" element={<DocumentList docType="bill" />} />
              <Route path="/challans" element={<DocumentList docType="challan" />} />
              <Route path="/new/:docType" element={<DocumentEditor />} />
              <Route path="/edit/:id" element={<DocumentEditor />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="/view/:id" element={<ProtectedRoute><DocumentView /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;

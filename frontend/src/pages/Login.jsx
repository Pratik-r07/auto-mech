import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GearSix, Lock } from "@phosphor-icons/react";
import { toast } from "sonner";

const BG = "https://images.unsplash.com/photo-1513828646384-e4d8ec30d2bb?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzB8MHwxfHNlYXJjaHwxfHxiZXZlcmFnZSUyMGJvdHRsaW5nJTIwcGxhbnQlMjBpbmR1c3RyaWFsJTIwbWFjaGluZXJ5fGVufDB8fHx8MTc4MzI1MDg5MXww&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      navigate("/");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden lg:block bg-slate-900 overflow-hidden">
        <img src={BG} alt="machinery" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-slate-900/60" />
        <div className="relative z-10 h-full flex flex-col justify-between p-12">
          <div className="flex items-center gap-3 text-white">
            <div className="h-10 w-10 bg-orange-600 flex items-center justify-center rounded-md">
              <GearSix size={24} weight="fill" className="text-white" />
            </div>
            <span className="font-head font-black text-xl tracking-tight">AUTO~MECH</span>
          </div>
          <div className="text-white max-w-md">
            <h1 className="font-head text-4xl sm:text-5xl font-black tracking-tighter leading-none">
              Quotations & Bills, engineered for precision.
            </h1>
            <p className="mt-4 text-slate-300 text-sm leading-relaxed">
              Create GST-ready quotations and tax invoices, manage clients, and print professional
              documents in seconds.
            </p>
          </div>
          <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Spares & Service Specialist</p>
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 sm:p-12 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 bg-orange-600 flex items-center justify-center rounded-md">
              <GearSix size={24} weight="fill" className="text-white" />
            </div>
            <span className="font-head font-black text-xl tracking-tight text-slate-900">AUTO~MECH</span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500 mb-2">Secure Login</p>
          <h2 className="font-head text-3xl font-black tracking-tight text-slate-900 mb-8">Sign in</h2>
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Email
              </Label>
              <Input
                id="email"
                data-testid="login-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="h-11 border-slate-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Password
              </Label>
              <Input
                id="password"
                data-testid="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="h-11 border-slate-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
            <Button
              type="submit"
              data-testid="login-submit-button"
              disabled={loading}
              className="w-full h-11 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-md transition-colors duration-150"
            >
              <Lock size={16} weight="bold" className="mr-2" />
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

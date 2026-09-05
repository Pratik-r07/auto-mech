import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  SquaresFour,
  FileText,
  Receipt,
  UsersThree,
  GearSix,
  SignOut,
  List,
  Truck,
} from "@phosphor-icons/react";

const nav = [
  { to: "/", label: "Dashboard", icon: SquaresFour, end: true },
  { to: "/quotations", label: "Quotations", icon: FileText },
  { to: "/bills", label: "Bills / Invoices", icon: Receipt },
  { to: "/challans", label: "Delivery Challans", icon: Truck },
  { to: "/clients", label: "Clients", icon: UsersThree },
  { to: "/settings", label: "Settings", icon: GearSix },
];

function SidebarContent({ user, logout, onNavigate }) {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-200">
        <div className="h-9 w-9 bg-orange-600 flex items-center justify-center rounded-md">
          <GearSix size={22} weight="fill" className="text-white" />
        </div>
        <div className="leading-none">
          <div className="font-head font-black text-sm tracking-tight text-slate-900">AUTO~MECH</div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400 mt-0.5">Spares & Service</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            data-testid={`nav-${item.label.split(" ")[0].toLowerCase()}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? "bg-orange-50 text-orange-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`
            }
          >
            <item.icon size={18} weight="bold" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-slate-200">
        <div className="px-3 py-2 mb-2">
          <div className="text-xs font-semibold text-slate-700 truncate">{user?.name || "Owner"}</div>
          <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
        </div>
        <button
          onClick={logout}
          data-testid="logout-button"
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors duration-150"
        >
          <SignOut size={18} weight="bold" />
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-slate-200 flex-col fixed h-screen z-30">
        <SidebarContent user={user} logout={logout} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <SidebarContent user={user} logout={logout} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-20 h-14 flex items-center justify-between px-4 bg-white border-b border-slate-200">
        <button
          onClick={() => setOpen(true)}
          data-testid="mobile-menu-button"
          className="p-2 -ml-2 rounded-md text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <List size={22} weight="bold" />
        </button>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 bg-orange-600 flex items-center justify-center rounded">
            <GearSix size={16} weight="fill" className="text-white" />
          </div>
          <span className="font-head font-black text-sm tracking-tight text-slate-900">AUTO~MECH</span>
        </div>
        <div className="w-8" />
      </header>

      {/* Main */}
      <main className="lg:ml-60 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}

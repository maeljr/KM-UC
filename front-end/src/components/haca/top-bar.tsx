import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CircleAlert,
  FileText,
  Info,
  LayoutDashboard,
  Library,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function HacaLogo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 select-none">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-fluent-sm">
        <span className="text-sm font-bold tracking-tight">H</span>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-tight text-foreground">
          HACA Partners
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">
          Projet 45 · Knowledge Assistant
        </span>
      </span>
    </Link>
  );
}

const navItems = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Knowledge Repository", to: "/repository", icon: Library },
  { label: "RegWatch", to: "/regwatch", icon: Bell },
  { label: "Génération", to: "/generation", icon: FileText },
  { label: "Audit Logs", to: "/audit", icon: ScrollText },
] as const;

type NotificationSeverity = "action" | "alert" | "info";

const notifications: {
  id: string;
  ref: string;
  severity: NotificationSeverity;
  text: string;
}[] = [
  {
    id: "cssf",
    ref: "CSSF 20/750 · Section 4.2 · Page 18",
    severity: "action",
    text: "Financial entities must implement a documented ICT and security risk management framework, reviewed at least once a year.",
  },
  {
    id: "eba",
    ref: "EBA/GL/2019/02 · Outsourcing Arrangements · Title IV · Para. 75",
    severity: "alert",
    text: "Institutions shall maintain a register of all outsourcing arrangements, distinguishing critical or important functions.",
  },
  {
    id: "crd6",
    ref: "CRD VI · Directive (EU) 2024/1619 · Article 74 · Internal Governance",
    severity: "info",
    text: "Robust governance arrangements include a clear organizational structure with well-defined, transparent, and consistent lines of responsibility.",
  },
];

const severityConfig: Record<
  NotificationSeverity,
  { icon: typeof AlertTriangle; label: string; className: string }
> = {
  action: {
    icon: AlertTriangle,
    label: "Action required",
    className: "text-destructive",
  },
  alert: {
    icon: CircleAlert,
    label: "Alert",
    className: "text-amber-600",
  },
  info: {
    icon: Info,
    label: "Information",
    className: "text-primary",
  },
};

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <HacaLogo />

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary data-[state=open]:text-foreground"
              aria-label="RegWatch Alerts"
            >
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-[380px] p-0">
              <div className="flex items-center justify-between px-3 pt-3">
                <DropdownMenuLabel className="p-0 text-[13px] font-semibold">
                  RegWatch Notifications
                </DropdownMenuLabel>
                <Badge
                  variant="secondary"
                  className="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wide"
                >
                  {notifications.length} New
                </Badge>
              </div>
              <DropdownMenuSeparator className="mb-0 mt-3" />
              <div className="max-h-[420px] overflow-y-auto p-1.5">
                {notifications.map((n) => {
                  const cfg = severityConfig[n.severity];
                  return (
                    <Link
                      key={n.id}
                      to="/regwatch"
                      className="group flex gap-2.5 rounded-md p-2.5 transition-colors hover:bg-secondary"
                    >
                      <cfg.icon
                        className={cn("mt-0.5 h-4 w-4 shrink-0", cfg.className)}
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground">
                            {n.ref}
                          </span>
                        </span>
                        <span className="text-[12px] leading-snug text-muted-foreground">
                          {n.text}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            cfg.className,
                          )}
                        >
                          {cfg.label}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
              <DropdownMenuSeparator className="my-0" />
              <Link
                to="/regwatch"
                className="flex items-center justify-center gap-1.5 p-2.5 text-[12px] font-semibold text-primary transition-colors hover:bg-secondary"
              >
                View all in RegWatch
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="flex flex-col items-end leading-none">
              <span className="text-[13px] font-semibold text-foreground">Camille Rousseau</span>
              <Badge
                variant="secondary"
                className="mt-1 h-4 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide"
              >
                Manager
              </Badge>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
              CR
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

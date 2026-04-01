import { LayoutDashboard, Users, AlertTriangle, BarChart3, Settings } from "lucide-react";
import { cn } from "@/utils/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NavLink } from "@/components/navigation/NavLink";

const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/admin/dashboard" },
    { id: "drivers", label: "Driver Monitoring", icon: Users, path: "/admin/drivers" },
    { id: "alerts", label: "Safety Alerts Panel", icon: AlertTriangle, path: "/admin/alerts" },
    { id: "analytics", label: "Analytics", icon: BarChart3, path: "/admin/analytics" },
    { id: "settings", label: "Settings", icon: Settings, path: "/admin/settings" },
];

export function Sidebar() {
    const user = JSON.parse(localStorage.getItem("optiride_user") || "{}");
    const nameParts = user.name?.split(" ") || ["Admin", "User"];
    const initials = nameParts.length >= 2
        ? nameParts[0][0] + nameParts[1][0]
        : (nameParts[0]?.[0] || "A");

    return (
        <aside className="w-64 bg-sidebar h-screen flex flex-col fixed left-0 top-0">
            {/* Logo */}
            <div className="p-6">
                <h1 className="text-xl font-bold text-sidebar-foreground">
                    Optiride
                </h1>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3">
                {menuItems.map((item) => {
                    const Icon = item.icon;
                    return (
                        <NavLink
                            key={item.id}
                            to={item.path}
                            end={item.path === "/admin"}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors mb-1 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            activeClassName="bg-sidebar-primary text-sidebar-primary-foreground"
                        >
                            <Icon className="w-5 h-5" />
                            <span className="truncate">{item.label}</span>
                        </NavLink>
                    );
                })}
            </nav>

            {/* User Profile */}
            <div className="p-4 border-t border-sidebar-border">
                <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 bg-primary">
                        <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-sidebar-foreground truncate">
                            {user.name}
                        </p>
                        <p className="text-xs text-sidebar-foreground/60 truncate">
                            {user.email}
                        </p>
                    </div>
                </div>
            </div>
        </aside>
    );
}

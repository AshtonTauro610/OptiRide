import { cn } from "@/utils/utils";

export function MetricCard({ title, value, subtitle, icon: Icon, trend, iconColor = "text-primary", className }) {
    return (
        <div className={cn("bg-card rounded-xl p-6 border border-border", className)}>
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg bg-secondary", iconColor)}>
                        <Icon className="w-5 h-5" />
                    </div>
                    {trend && (
                        <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            trend.isPositive
                                ? "bg-success/10 text-success"
                                : "bg-destructive/10 text-destructive"
                        )}>
                            {trend.value}
                        </span>
                    )}
                </div>
            </div>
            <div className="mt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{title}</p>
                <p className="text-2xl font-bold mt-1">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            </div>
        </div>
    );
}

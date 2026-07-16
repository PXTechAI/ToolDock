import type { LucideIcon } from "lucide-react";

export function ToolHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="tool-header">
      <div className="tool-heading">
        <span className="heading-icon">
          <Icon size={20} />
        </span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {action}
    </header>
  );
}

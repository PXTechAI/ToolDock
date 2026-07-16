import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type MenuPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
};

export function SelectMenu({
  value,
  options,
  onChange,
  icon,
  disabled = false,
  className = "",
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex] ?? options[0];

  function updatePosition() {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;

    const estimatedHeight = Math.min(options.length * 36 + 10, 260);
    const availableBelow = window.innerHeight - trigger.bottom - 10;
    const openAbove = availableBelow < estimatedHeight && trigger.top > availableBelow;
    const width = Math.max(180, trigger.width);
    const left = Math.min(Math.max(8, trigger.left), window.innerWidth - width - 8);

    setPosition(
      openAbove
        ? { left, bottom: window.innerHeight - trigger.top + 6, width }
        : { left, top: trigger.bottom + 6, width },
    );
  }

  function openMenu() {
    if (disabled || options.length === 0) return;
    setHighlighted(selectedIndex);
    updatePosition();
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  function moveHighlight(direction: 1 | -1) {
    if (!options.length) return;
    let next = highlighted;
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setHighlighted(next);
        return;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
      } else {
        moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(highlighted);
      else openMenu();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const reposition = () => updatePosition();
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      ref={rootRef}
      className={`select-menu${icon ? " has-icon" : ""}${open ? " open" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        className="select-menu-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        {icon && <span className="select-menu-icon">{icon}</span>}
        <span className="select-menu-value" title={selected?.label}>
          {selected?.label ?? ""}
        </span>
        <ChevronDown className="select-menu-chevron" size={16} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="select-menu-popup"
            role="listbox"
            style={position as CSSProperties}
          >
            {options.map((option, index) => (
              <button
                type="button"
                id={`${listboxId}-${index}`}
                className={`select-menu-option${option.value === value ? " selected" : ""}${index === highlighted ? " highlighted" : ""}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                title={option.label}
                onPointerMove={() => setHighlighted(index)}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={15} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Extra class for the wrapping relative container. */
  containerClassName?: string;
};

/**
 * Shared password field with show/hide. Hidden by default.
 * Visibility toggles input type only; the value is unchanged.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, containerClassName, disabled, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className={cn("relative", containerClassName)}>
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          disabled={disabled}
          className={cn("pr-11", className)}
          {...props}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setVisible((open) => !open)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-400 hover:text-gray-600 disabled:pointer-events-none disabled:opacity-50"
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={0}
        >
          {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

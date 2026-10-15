import { RESULT_CATEGORY_FILTERS } from "@/lib/patient-identity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DepartmentFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={`h-9 w-full min-w-[168px] rounded-lg border-[#DDE5E0] bg-white text-[13px] font-semibold text-[#17221D] shadow-none focus:ring-[#2F7D4A] sm:w-[210px] ${className ?? ""}`}
      >
        <SelectValue placeholder="Department" />
      </SelectTrigger>
      <SelectContent>
        {RESULT_CATEGORY_FILTERS.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

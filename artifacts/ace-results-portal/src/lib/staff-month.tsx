import { createContext, useContext, useState, type ReactNode } from "react";

const StaffMonthContext = createContext({
  month: new Date().getMonth(),
  setMonth: (_month: number) => {},
});

export function useStaffMonth() {
  return useContext(StaffMonthContext);
}

export function StaffMonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(() => new Date().getMonth());
  return (
    <StaffMonthContext.Provider value={{ month, setMonth }}>
      {children}
    </StaffMonthContext.Provider>
  );
}

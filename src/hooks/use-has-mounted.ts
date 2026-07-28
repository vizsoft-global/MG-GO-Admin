"use client";

import { useEffect, useState } from "react";

/** True only after the component has mounted on the client (avoids SSR/client UI drift). */
export function useHasMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}

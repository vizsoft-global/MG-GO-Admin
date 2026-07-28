"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const t = useTranslations("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "relative cursor-pointer",
        )}
      >
        <Sun className="h-4 w-4 scale-100 rotate-0 transition-[transform,opacity] duration-200 ease-out dark:scale-0 dark:-rotate-90" />
        <Moon className="absolute h-4 w-4 scale-0 rotate-90 transition-[transform,opacity] duration-200 ease-out dark:scale-100 dark:rotate-0" />
        <span className="sr-only">{t("theme")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="cursor-pointer" onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

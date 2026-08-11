import { useEffect, useState } from "react";

export type AppTheme = "dark" | "light" | "system";
export type ResolvedTheme = Exclude<AppTheme, "system">;

const STORAGE_KEY = "office-ide.theme";

function readInitialTheme(): AppTheme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" || stored === "system" ? stored : "dark";
}

function resolve(theme: AppTheme, media: MediaQueryList): ResolvedTheme {
  return theme === "system" ? media.matches ? "dark" : "light" : theme;
}

export function useAppTheme() {
  const [theme, setTheme] = useState<AppTheme>(readInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolve(readInitialTheme(), window.matchMedia("(prefers-color-scheme: dark)")),
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolvedTheme(resolve(theme, media));
    update();
    media.addEventListener("change", update);
    window.localStorage.setItem(STORAGE_KEY, theme);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return { theme, resolvedTheme, setTheme };
}

// Tipos do shell, iguais no dashboard e no admin.
import type { Icon } from "@tabler/icons-react";

export interface ShellItem { id: string; label: string; count?: number }
export interface ShellGroup { label: string; slug: string; items: ShellItem[] }
export interface Meta { icon: Icon; description: string }
export interface Catalog { groups: Record<string, Meta>; screens: Record<string, Meta> }
